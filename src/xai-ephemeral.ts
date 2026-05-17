/**
 * Mints a short-lived ephemeral token for direct client→xAI realtime WebSocket
 * connections. Used by `createBrowserSession` so the browser/iOS can open the
 * realtime WS itself without the server OAuth bearer ever leaving the gateway.
 *
 * Endpoint: POST https://api.x.ai/v1/realtime/client_secrets
 * Body: { "expires_after": { "seconds": N } }   (default 300, doc max ~600)
 * Response: { "value": "xai-client-secret.<...>", "expires_at": <unix-ts-sec> }
 */

import { forceRefreshXaiAuth, resolveXaiAuth, type XaiAuth } from "./xai-oauth.js";

const ENDPOINT = "https://api.x.ai/v1/realtime/client_secrets";

export type MintEphemeralParams = {
  agentId: string;
  apiKeyOverride?: string;
  expiresAfterSeconds?: number;
  timeoutMs?: number;
};

export type EphemeralToken = {
  value: string;
  expiresAt: number;
};

async function postMint(auth: XaiAuth, body: unknown, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function mintXaiEphemeralToken(params: MintEphemeralParams): Promise<EphemeralToken> {
  const timeoutMs = params.timeoutMs ?? 15_000;
  const seconds = Math.max(60, Math.min(params.expiresAfterSeconds ?? 300, 600));
  const body = { expires_after: { seconds } };

  let auth = await resolveXaiAuth({
    agentId: params.agentId,
    apiKeyOverride: params.apiKeyOverride,
    timeoutMs,
  });

  let res = await postMint(auth, body, timeoutMs);
  if (res.status === 401 && auth.source === "oauth") {
    auth = await forceRefreshXaiAuth({ agentId: params.agentId, timeoutMs });
    res = await postMint(auth, body, timeoutMs);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`xAI ephemeral token mint failed: ${res.status} ${res.statusText} ${text}`.trim());
  }
  const payload = (await res.json()) as { value?: string; expires_at?: number };
  if (!payload?.value) {
    throw new Error("xAI ephemeral token mint returned no value");
  }
  return {
    value: payload.value,
    expiresAt: typeof payload.expires_at === "number" ? payload.expires_at : Math.floor(Date.now() / 1000) + seconds,
  };
}
