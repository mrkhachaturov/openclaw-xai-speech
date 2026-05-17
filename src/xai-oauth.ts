/**
 * Reads and refreshes xAI OAuth tokens from an OpenClaw agent auth-profiles.json.
 *
 * Auth source: profile id starting with "xai:" inside
 *   ~/.openclaw/agents/<agentId>/agent/auth-profiles.json
 * (created by `openclaw models auth login --provider xai`).
 *
 * Refresh flow: on 401 or when `expires` is within REFRESH_LEAD_MS, POST to
 * the stored tokenEndpoint with grant_type=refresh_token and the saved refresh
 * token, then write the new tokens back to disk.
 */

import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const REFRESH_LEAD_MS = 60_000;
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";

type OauthProfile = {
  type: "oauth";
  provider: string;
  access: string;
  refresh: string;
  expires: number;
  tokenEndpoint?: string;
  issuer?: string;
  email?: string;
  accountId?: string;
  idToken?: string;
};

type AuthProfileStore = {
  version: number;
  profiles: Record<string, OauthProfile | Record<string, unknown>>;
};

function resolveStatePath(agentId: string): string {
  // Honor OPENCLAW_STATE_DIR > OPENCLAW_AGENT_DIR > $HOME/.openclaw.
  const stateDir =
    process.env.OPENCLAW_STATE_DIR ||
    process.env.HOME && join(process.env.HOME, ".openclaw") ||
    join(homedir(), ".openclaw");
  // Astromech layout puts state under the project dir, mounted via env.
  // OPENCLAW_AGENT_DIR (if set) points at a specific agent dir; we still
  // resolve from the agents/ root because the plugin needs to address an
  // arbitrary agent id.
  return join(stateDir, "agents", agentId, "agent", "auth-profiles.json");
}

async function loadStore(path: string): Promise<AuthProfileStore | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as AuthProfileStore;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

function pickXaiProfile(
  store: AuthProfileStore | undefined,
): { id: string; profile: OauthProfile } | undefined {
  if (!store?.profiles) return undefined;
  for (const [id, entry] of Object.entries(store.profiles)) {
    if (!id.startsWith("xai:")) continue;
    const profile = entry as OauthProfile;
    if (profile.type === "oauth" && profile.access && profile.refresh) {
      return { id, profile };
    }
  }
  return undefined;
}

async function persistProfile(
  path: string,
  store: AuthProfileStore,
  profileId: string,
  updated: OauthProfile,
): Promise<void> {
  store.profiles[profileId] = updated;
  await writeFile(path, JSON.stringify(store, null, 2), "utf8");
  try {
    await chmod(path, 0o600);
  } catch {
    // best-effort permission lockdown
  }
}

async function refreshToken(
  profile: OauthProfile,
  timeoutMs: number,
): Promise<OauthProfile> {
  const endpoint = profile.tokenEndpoint || "https://auth.x.ai/oauth2/token";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: profile.refresh,
    client_id: XAI_CLIENT_ID,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`xAI token refresh failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const payload = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };

  const expiresInMs = (payload.expires_in ?? 3600) * 1000;
  return {
    ...profile,
    access: payload.access_token,
    refresh: payload.refresh_token ?? profile.refresh,
    expires: Date.now() + expiresInMs,
    idToken: payload.id_token ?? profile.idToken,
  };
}

export type XaiAuth = {
  bearer: string;
  expires: number;
  source: "env" | "oauth";
};

export type ResolveXaiAuthParams = {
  agentId: string;
  apiKeyOverride?: string;
  timeoutMs?: number;
};

/**
 * Resolve a usable xAI Bearer token. Priority:
 *   1. explicit apiKey override (plugin config)
 *   2. XAI_API_KEY env var
 *   3. xAI OAuth profile from <agentId>/agent/auth-profiles.json (refreshed if near expiry)
 */
export async function resolveXaiAuth(params: ResolveXaiAuthParams): Promise<XaiAuth> {
  const timeoutMs = params.timeoutMs ?? 15_000;

  const explicit = params.apiKeyOverride?.trim();
  if (explicit) {
    return { bearer: explicit, expires: Number.POSITIVE_INFINITY, source: "env" };
  }
  const envKey = process.env.XAI_API_KEY?.trim();
  if (envKey) {
    return { bearer: envKey, expires: Number.POSITIVE_INFINITY, source: "env" };
  }

  const path = resolveStatePath(params.agentId);
  const store = await loadStore(path);
  const found = pickXaiProfile(store);
  if (!found || !store) {
    throw new Error(
      `xAI OAuth profile not found in ${path}. Run \`openclaw models auth login --provider xai --method oauth\` first, or set XAI_API_KEY.`,
    );
  }

  let { profile } = found;
  if (profile.expires - Date.now() < REFRESH_LEAD_MS) {
    profile = await refreshToken(profile, timeoutMs);
    await persistProfile(path, store, found.id, profile);
  }
  return { bearer: profile.access, expires: profile.expires, source: "oauth" };
}

/**
 * Force-refresh on a 401. Returns a fresh Bearer or throws if refresh fails.
 */
export async function forceRefreshXaiAuth(params: ResolveXaiAuthParams): Promise<XaiAuth> {
  const timeoutMs = params.timeoutMs ?? 15_000;
  const path = resolveStatePath(params.agentId);
  const store = await loadStore(path);
  const found = pickXaiProfile(store);
  if (!found || !store) {
    throw new Error(`xAI OAuth profile not found in ${path}.`);
  }
  const refreshed = await refreshToken(found.profile, timeoutMs);
  await persistProfile(path, store, found.id, refreshed);
  return { bearer: refreshed.access, expires: refreshed.expires, source: "oauth" };
}
