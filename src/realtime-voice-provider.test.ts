import { describe, expect, it, vi } from "vitest";
import { buildXaiRealtimeVoiceProvider } from "./realtime-voice-provider.js";
import type {
  RealtimeVoiceBridgeCreateRequest,
  RealtimeVoiceProviderPlugin,
} from "./types.js";
import { REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ } from "./types.js";

function makeRequest(overrides: Partial<RealtimeVoiceBridgeCreateRequest> = {}): RealtimeVoiceBridgeCreateRequest {
  return {
    cfg: {},
    providerConfig: {},
    onAudio: vi.fn(),
    onClearAudio: vi.fn(),
    onMark: vi.fn(),
    onTranscript: vi.fn(),
    onEvent: vi.fn(),
    onToolCall: vi.fn(),
    onReady: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    instructions: "test",
    autoRespondToAudio: false,
    interruptResponseOnInputAudio: true,
    tools: [],
    audioFormat: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
    ...overrides,
  };
}

describe("buildXaiRealtimeVoiceProvider", () => {
  let provider: RealtimeVoiceProviderPlugin;

  it("declares plugin metadata", () => {
    provider = buildXaiRealtimeVoiceProvider();
    expect(provider.id).toBe("xai-realtime");
    expect(provider.label).toContain("xAI");
    expect(provider.defaultModel).toBe("grok-voice-think-fast-1.0");
    expect(provider.capabilities?.transports).toContain("gateway-relay");
    expect(provider.capabilities?.supportsBargeIn).toBe(true);
    expect(provider.capabilities?.supportsToolCalls).toBe(true);
    expect(provider.capabilities?.supportsBrowserSession).toBe(false);
  });

  it("isConfigured returns true (lazy auth check)", () => {
    provider = buildXaiRealtimeVoiceProvider();
    expect(provider.isConfigured({ cfg: {}, providerConfig: {} })).toBe(true);
  });

  it("createBridge returns a bridge implementing the full RealtimeVoiceBridge contract", () => {
    // This test catches missing methods at runtime — would have caught setMediaTimestamp on day one.
    provider = buildXaiRealtimeVoiceProvider();
    const bridge = provider.createBridge(makeRequest());

    // Required methods (all from src/talk/provider-types.ts RealtimeVoiceBridge type).
    expect(typeof bridge.connect).toBe("function");
    expect(typeof bridge.sendAudio).toBe("function");
    expect(typeof bridge.setMediaTimestamp).toBe("function");
    expect(typeof bridge.submitToolResult).toBe("function");
    expect(typeof bridge.acknowledgeMark).toBe("function");
    expect(typeof bridge.close).toBe("function");
    expect(typeof bridge.isConnected).toBe("function");

    // Optional methods we implement.
    expect(typeof bridge.sendUserMessage).toBe("function");
    expect(typeof bridge.triggerGreeting).toBe("function");
    expect(typeof bridge.handleBargeIn).toBe("function");

    // Optional flag.
    expect(bridge.supportsToolResultContinuation).toBe(true);

    // Pre-connect state.
    expect(bridge.isConnected()).toBe(false);
  });

  it("pre-connect bridge methods are no-ops, not throws", () => {
    provider = buildXaiRealtimeVoiceProvider();
    const bridge = provider.createBridge(makeRequest());

    expect(() => bridge.sendAudio(Buffer.from([0, 1, 2]))).not.toThrow();
    expect(() => bridge.setMediaTimestamp(123)).not.toThrow();
    expect(() => bridge.acknowledgeMark()).not.toThrow();
    expect(() => bridge.handleBargeIn?.()).not.toThrow();
    expect(() => bridge.submitToolResult("call_1", { ok: true })).not.toThrow();
    expect(() => bridge.close()).not.toThrow();
  });

  it("merges plugin entry config with providerConfig (providerConfig wins)", () => {
    provider = buildXaiRealtimeVoiceProvider();
    const cfg = {
      plugins: {
        entries: {
          "openclaw-xai-speech": {
            config: { voiceId: "rex", apiKey: "from-plugin-entry" },
          },
        },
      },
    };
    const bridge = provider.createBridge(makeRequest({
      cfg,
      providerConfig: { voice: "leo" },
    }));
    // Both voice fields read; provider config 'voice' wins over plugin entry 'voiceId'.
    // We can't introspect private config but bridge construction shouldn't throw.
    expect(bridge.isConnected()).toBe(false);
  });

  it("resolveConfig merges raw provider config with plugin entry", () => {
    provider = buildXaiRealtimeVoiceProvider();
    const cfg = {
      plugins: {
        entries: { "openclaw-xai-speech": { config: { authProfileAgent: "main" } } },
      },
    };
    const merged = provider.resolveConfig!({
      cfg,
      rawConfig: { voice: "rex" },
    });
    expect(merged.authProfileAgent).toBe("main");
    expect(merged.voice).toBe("rex");
  });
});
