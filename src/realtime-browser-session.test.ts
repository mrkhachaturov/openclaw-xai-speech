import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildXaiRealtimeVoiceProvider } from "./realtime-voice-provider.js";

const ORIGINAL_FETCH = globalThis.fetch;

describe("xai-realtime createBrowserSession", () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = "test-api-key";
  });
  afterEach(() => {
    delete process.env.XAI_API_KEY;
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("mints an ephemeral token and returns a provider-websocket session shape", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ value: "xai-client-secret.tok", expires_at: 1234 }), { status: 200 }),
    ) as typeof fetch;

    const provider = buildXaiRealtimeVoiceProvider();
    const session = await provider.createBrowserSession!({
      cfg: {},
      providerConfig: { voice: "rex" },
      model: "grok-voice-think-fast-1.0",
    });

    expect(session.provider).toBe("xai-realtime");
    expect(session.transport).toBe("provider-websocket");
    if (session.transport !== "provider-websocket") return; // type guard
    expect(session.clientSecret).toBe("xai-client-secret.tok");
    expect(session.protocol).toBe("xai-client-secret.xai-client-secret.tok");
    expect(session.websocketUrl).toBe(
      "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0",
    );
    expect(session.audio).toEqual({
      inputEncoding: "pcm16",
      inputSampleRateHz: 24000,
      outputEncoding: "pcm16",
      outputSampleRateHz: 24000,
    });
    expect(session.voice).toBe("rex");
    expect(session.expiresAt).toBe(1234);
  });

  it("falls back to defaults when no model/voice supplied", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ value: "xai-client-secret.tok", expires_at: 1 }), { status: 200 }),
    ) as typeof fetch;

    const provider = buildXaiRealtimeVoiceProvider();
    const session = await provider.createBrowserSession!({
      cfg: {},
      providerConfig: {},
    });
    if (session.transport !== "provider-websocket") return;
    expect(session.model).toBe("grok-voice-think-fast-1.0");
    expect(session.voice).toBe("eve");
    expect(session.websocketUrl).toContain("model=grok-voice-think-fast-1.0");
  });

  it("URL-encodes the model name", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ value: "x", expires_at: 1 }), { status: 200 }),
    ) as typeof fetch;

    const provider = buildXaiRealtimeVoiceProvider();
    const session = await provider.createBrowserSession!({
      cfg: {},
      providerConfig: {},
      model: "weird model/with chars",
    });
    if (session.transport !== "provider-websocket") return;
    expect(session.websocketUrl).toBe(
      "wss://api.x.ai/v1/realtime?model=weird%20model%2Fwith%20chars",
    );
  });
});
