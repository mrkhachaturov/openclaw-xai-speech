import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintXaiEphemeralToken } from "./xai-ephemeral.js";

const ORIGINAL_FETCH = globalThis.fetch;

describe("mintXaiEphemeralToken", () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = "test-api-key";
  });
  afterEach(() => {
    delete process.env.XAI_API_KEY;
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("POSTs the documented body and returns value/expiresAt", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({ value: "xai-client-secret.abc123", expires_at: 1_900_000_000 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const token = await mintXaiEphemeralToken({ agentId: "main" });

    expect(token.value).toBe("xai-client-secret.abc123");
    expect(token.expiresAt).toBe(1_900_000_000);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.x.ai/v1/realtime/client_secrets");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ expires_after: { seconds: 300 } });
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-api-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("clamps expiresAfterSeconds to [60, 600]", async () => {
    const captured: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ value: "x", expires_at: 1 }), { status: 200 });
    }) as typeof fetch;

    await mintXaiEphemeralToken({ agentId: "main", expiresAfterSeconds: 10 });
    await mintXaiEphemeralToken({ agentId: "main", expiresAfterSeconds: 9999 });

    expect(captured).toEqual([
      { expires_after: { seconds: 60 } },
      { expires_after: { seconds: 600 } },
    ]);
  });

  it("throws with body text on non-2xx", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 403, statusText: "Forbidden" })) as typeof fetch;
    await expect(mintXaiEphemeralToken({ agentId: "main" })).rejects.toThrow(/403/);
  });

  it("synthesizes expiresAt when API omits it", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ value: "xai-client-secret.zzz" }), { status: 200 }),
    ) as typeof fetch;
    const before = Math.floor(Date.now() / 1000);
    const token = await mintXaiEphemeralToken({ agentId: "main", expiresAfterSeconds: 120 });
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 120 - 1);
  });
});
