import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forceRefreshXaiAuth, resolveXaiAuth } from "./xai-oauth.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;
const ORIGINAL_API_KEY = process.env.XAI_API_KEY;

async function seedAuthProfile(agentId: string, profile: Record<string, unknown>) {
  const stateDir = process.env.OPENCLAW_STATE_DIR!;
  const dir = join(stateDir, "agents", agentId, "agent");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "auth-profiles.json");
  await writeFile(path, JSON.stringify({ version: 1, profiles: { "xai:test@example.com": profile } }, null, 2));
  return path;
}

describe("resolveXaiAuth", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "xai-oauth-test-"));
    process.env.OPENCLAW_STATE_DIR = dir;
    delete process.env.XAI_API_KEY;
  });

  afterEach(() => {
    process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
    process.env.XAI_API_KEY = ORIGINAL_API_KEY;
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("prefers explicit apiKeyOverride", async () => {
    const auth = await resolveXaiAuth({ agentId: "main", apiKeyOverride: "sk-explicit" });
    expect(auth.source).toBe("env");
    expect(auth.bearer).toBe("sk-explicit");
  });

  it("falls back to XAI_API_KEY env when no override and no profile", async () => {
    process.env.XAI_API_KEY = "sk-from-env";
    const auth = await resolveXaiAuth({ agentId: "main" });
    expect(auth.source).toBe("env");
    expect(auth.bearer).toBe("sk-from-env");
  });

  it("reads OAuth bearer from agent auth-profiles.json", async () => {
    await seedAuthProfile("main", {
      type: "oauth",
      provider: "xai",
      access: "fresh-token",
      refresh: "refresh-token",
      expires: Date.now() + 60 * 60 * 1000,
      tokenEndpoint: "https://auth.x.ai/oauth2/token",
    });
    const auth = await resolveXaiAuth({ agentId: "main" });
    expect(auth.source).toBe("oauth");
    expect(auth.bearer).toBe("fresh-token");
  });

  it("auto-refreshes when token is near expiry", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const path = await seedAuthProfile("main", {
      type: "oauth",
      provider: "xai",
      access: "stale-token",
      refresh: "refresh-token",
      expires: Date.now() + 5_000, // < REFRESH_LEAD_MS (60s)
      tokenEndpoint: "https://auth.x.ai/oauth2/token",
    });

    const auth = await resolveXaiAuth({ agentId: "main" });
    expect(auth.bearer).toBe("rotated-access");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Persisted back to disk.
    const reread = JSON.parse(await readFile(path, "utf8"));
    expect(reread.profiles["xai:test@example.com"].access).toBe("rotated-access");
    expect(reread.profiles["xai:test@example.com"].refresh).toBe("rotated-refresh");
  });

  it("throws a clear error when no profile and no env key", async () => {
    await expect(resolveXaiAuth({ agentId: "main" })).rejects.toThrow(/xAI OAuth profile not found/);
  });

  it("forceRefreshXaiAuth bumps the token even if not near expiry", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        access_token: "forced-new",
        refresh_token: "rt2",
        expires_in: 3600,
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await seedAuthProfile("main", {
      type: "oauth",
      provider: "xai",
      access: "old",
      refresh: "rt1",
      expires: Date.now() + 60 * 60 * 1000, // far from expiry
      tokenEndpoint: "https://auth.x.ai/oauth2/token",
    });

    const auth = await forceRefreshXaiAuth({ agentId: "main" });
    expect(auth.bearer).toBe("forced-new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
