/**
 * xAI Grok Voice Agent realtime provider for OpenClaw Talk mode.
 *
 * Wraps `wss://api.x.ai/v1/realtime` as a `RealtimeVoiceProviderPlugin`.
 * Reuses SuperGrok OAuth bearer from `<authProfileAgent>/agent/auth-profiles.json`.
 *
 * Protocol mirrors OpenAI Realtime API; see docs/voice-agent-api.md for events.
 */

import type {
  RealtimeVoiceAudioFormat,
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCreateRequest,
  RealtimeVoiceProviderConfig,
  RealtimeVoiceProviderConfiguredContext,
  RealtimeVoiceProviderPlugin,
  RealtimeVoiceToolResultOptions,
  RealtimeVoiceBargeInOptions,
} from "./types.js";
import { REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ } from "./types.js";
import { forceRefreshXaiAuth, resolveXaiAuth } from "./xai-oauth.js";

const PLUGIN_ID = "openclaw-xai-speech";
const DEFAULT_MODEL = "grok-voice-think-fast-1.0";
const DEFAULT_VOICE = "eve";
const REALTIME_URL = "wss://api.x.ai/v1/realtime";

type XaiRealtimeConfig = {
  model: string;
  voice: string;
  authProfileAgent: string;
  apiKey?: string;
  audioFormat: RealtimeVoiceAudioFormat;
  vadThreshold?: number;
  silenceDurationMs?: number;
  prefixPaddingMs?: number;
  timeoutMs: number;
};

function readPluginEntryConfig(cfg: unknown): Record<string, unknown> {
  const root = cfg as Record<string, unknown> | undefined;
  const plugins = root?.plugins as Record<string, unknown> | undefined;
  const entries = plugins?.entries as Record<string, Record<string, unknown>> | undefined;
  return (entries?.[PLUGIN_ID]?.config as Record<string, unknown>) ?? {};
}

function mergeProviderConfig(req: { cfg?: unknown; providerConfig: RealtimeVoiceProviderConfig }): Record<string, unknown> {
  const pluginCfg = readPluginEntryConfig(req.cfg);
  // providerConfig (talk.realtime.providers.xai-realtime.*) wins over plugin entry config.
  return { ...pluginCfg, ...(req.providerConfig ?? {}) };
}

function resolveConfig(req: RealtimeVoiceBridgeCreateRequest): XaiRealtimeConfig {
  const merged = mergeProviderConfig(req);
  return {
    model: ((merged.model as string)?.trim()) || ((merged.realtimeModel as string)?.trim()) || DEFAULT_MODEL,
    voice: ((merged.voice as string)?.trim()) || ((merged.voiceId as string)?.trim()) || DEFAULT_VOICE,
    authProfileAgent: ((merged.authProfileAgent as string)?.trim()) || "main",
    apiKey: ((merged.apiKey as string)?.trim()) || undefined,
    audioFormat: req.audioFormat ?? REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
    vadThreshold: typeof merged.vadThreshold === "number" ? (merged.vadThreshold as number) : undefined,
    silenceDurationMs: typeof merged.silenceDurationMs === "number" ? (merged.silenceDurationMs as number) : undefined,
    prefixPaddingMs: typeof merged.prefixPaddingMs === "number" ? (merged.prefixPaddingMs as number) : undefined,
    timeoutMs: typeof merged.timeoutMs === "number" ? (merged.timeoutMs as number) : 60_000,
  };
}

function xaiAudioFormat(fmt: RealtimeVoiceAudioFormat): { type: string; rate?: number } {
  if (fmt.encoding === "g711_ulaw") return { type: "audio/pcmu" };
  return { type: "audio/pcm", rate: fmt.sampleRateHz };
}

class XaiRealtimeVoiceBridge implements RealtimeVoiceBridge {
  supportsToolResultContinuation = true;

  private ws: WebSocket | null = null;
  private closed = false;
  private connected = false;
  private mediaTimestampMs = 0;
  private deliveredToolCalls = new Set<string>();
  private toolCallBuffers = new Map<string, { name: string; argsChunks: string[]; itemId?: string }>();

  constructor(
    private readonly req: RealtimeVoiceBridgeCreateRequest,
    private readonly cfg: XaiRealtimeConfig,
  ) {}

  isConnected(): boolean { return this.connected; }

  async connect(): Promise<void> {
    const auth = await resolveXaiAuth({
      agentId: this.cfg.authProfileAgent,
      apiKeyOverride: this.cfg.apiKey,
      timeoutMs: this.cfg.timeoutMs,
    });
    await this.openSocket(auth.bearer, auth.source);
  }

  private async openSocket(bearer: string, source: "env" | "oauth"): Promise<void> {
    const url = `${REALTIME_URL}?model=${encodeURIComponent(this.cfg.model)}`;
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${bearer}` },
    } as unknown as string[]);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(1000, "open timeout"); } catch { /* noop */ }
        reject(new Error(`xAI realtime open timeout (${this.cfg.timeoutMs}ms)`));
      }, this.cfg.timeoutMs);

      ws.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connected = true;
        this.sendSessionUpdate();
        this.req.onReady?.();
        resolve();
      });

      ws.addEventListener("close", async (rawEvt: Event) => {
        const evt = rawEvt as Event & { code?: number; reason?: string };
        this.connected = false;
        const reason: "completed" | "error" = settled ? "completed" : "error";
        if (!settled && (evt.code === 4401 || evt.code === 1008) && source === "oauth") {
          settled = true;
          clearTimeout(timer);
          try {
            const fresh = await forceRefreshXaiAuth({
              agentId: this.cfg.authProfileAgent,
              timeoutMs: this.cfg.timeoutMs,
            });
            await this.openSocket(fresh.bearer, "oauth");
            resolve();
            return;
          } catch (err) {
            this.req.onError?.(err as Error);
            reject(err as Error);
            return;
          }
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`xAI realtime closed before open (code=${evt.code} reason=${evt.reason || ""})`));
        }
        this.req.onClose?.(reason);
      });

      ws.addEventListener("error", (err: Event) => {
        const wrapped = err instanceof Error ? err : new Error("xAI realtime websocket error");
        this.req.onError?.(wrapped);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(wrapped);
      });

      ws.addEventListener("message", (rawEvt: Event) => {
        const evt = rawEvt as Event & { data?: unknown };
        this.handleMessage(evt.data);
      });
    });
  }

  private sendSessionUpdate(): void {
    const turnDetection: Record<string, unknown> = { type: "server_vad" };
    if (this.cfg.vadThreshold !== undefined) turnDetection.threshold = this.cfg.vadThreshold;
    if (this.cfg.silenceDurationMs !== undefined) turnDetection.silence_duration_ms = this.cfg.silenceDurationMs;
    if (this.cfg.prefixPaddingMs !== undefined) turnDetection.prefix_padding_ms = this.cfg.prefixPaddingMs;

    const fmt = xaiAudioFormat(this.cfg.audioFormat);
    const session: Record<string, unknown> = {
      voice: this.cfg.voice,
      turn_detection: turnDetection,
      audio: {
        input: { format: fmt },
        output: { format: fmt },
      },
    };
    if (this.req.instructions) session.instructions = this.req.instructions;
    if (Array.isArray(this.req.tools) && this.req.tools.length > 0) {
      session.tools = this.req.tools.map((tool) => ({
        type: tool.type,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    }
    this.sendJson({ type: "session.update", session }, "session.update");
  }

  private sendJson(payload: unknown, label?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
    if (label) this.req.onEvent?.({ direction: "client", type: label });
  }

  private handleMessage(raw: unknown): void {
    let evt: Record<string, unknown>;
    try {
      const text = typeof raw === "string" ? raw : (raw as { toString(): string } | undefined)?.toString?.() ?? "{}";
      evt = JSON.parse(text);
    } catch (err) {
      this.req.onError?.(new Error(`xAI realtime: malformed event: ${(err as Error).message}`));
      return;
    }
    const type = evt.type as string | undefined;
    if (!type) return;
    this.req.onEvent?.({ direction: "server", type });

    switch (type) {
      case "response.output_audio.delta":
      case "response.audio.delta": {
        const b64 = evt.delta as string | undefined;
        if (b64) this.req.onAudio(Buffer.from(b64, "base64"));
        return;
      }
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const text = evt.delta as string | undefined;
        if (text) this.req.onTranscript?.("assistant", text, false);
        return;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const text = evt.transcript as string | undefined;
        if (text) this.req.onTranscript?.("assistant", text, true);
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = evt.transcript as string | undefined;
        if (text) this.req.onTranscript?.("user", text, true);
        return;
      }
      case "input_audio_buffer.speech_started":
      case "response.cancel": {
        // User started speaking or response cancelled → assistant should stop playing.
        this.req.onClearAudio();
        return;
      }
      case "response.function_call_arguments.delta": {
        const callId = evt.call_id as string;
        if (!callId) return;
        const itemId = evt.item_id as string | undefined;
        const name = evt.name as string | undefined;
        const delta = (evt.delta as string) ?? "";
        const buf = this.toolCallBuffers.get(callId) ?? { name: name ?? "unknown", argsChunks: [], itemId };
        if (name && buf.name === "unknown") buf.name = name;
        if (itemId && !buf.itemId) buf.itemId = itemId;
        buf.argsChunks.push(delta);
        this.toolCallBuffers.set(callId, buf);
        return;
      }
      case "response.function_call_arguments.done": {
        const callId = evt.call_id as string;
        if (!callId || this.deliveredToolCalls.has(callId)) return;
        this.deliveredToolCalls.add(callId);
        const buf = this.toolCallBuffers.get(callId);
        const argsRaw = (evt.arguments as string | undefined) ?? buf?.argsChunks.join("") ?? "";
        let parsed: unknown = argsRaw;
        try { parsed = JSON.parse(argsRaw); } catch { /* keep raw */ }
        this.req.onToolCall?.({
          itemId: (evt.item_id as string) ?? buf?.itemId ?? callId,
          callId,
          name: (evt.name as string) ?? buf?.name ?? "unknown",
          args: parsed,
        });
        return;
      }
      case "error": {
        const message = (evt.error as { message?: string } | undefined)?.message ?? "xAI realtime error event";
        this.req.onError?.(new Error(message));
        return;
      }
      default:
        return;
    }
  }

  sendAudio(audio: Buffer): void {
    this.sendJson({ type: "input_audio_buffer.append", audio: audio.toString("base64") });
  }

  setMediaTimestamp(ts: number): void {
    this.mediaTimestampMs = ts;
  }

  acknowledgeMark(): void {
    // xAI realtime doesn't emit playback marks today; nothing to ack server-side.
  }

  handleBargeIn(_options?: RealtimeVoiceBargeInOptions): void {
    this.sendJson({ type: "response.cancel" }, "response.cancel");
    this.req.onClearAudio();
  }

  sendUserMessage(text: string): void {
    this.sendJson({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }, "conversation.item.create");
    this.sendJson({ type: "response.create" }, "response.create");
  }

  triggerGreeting(instructions?: string): void {
    const payload: Record<string, unknown> = { type: "response.create" };
    if (instructions) payload.response = { instructions };
    this.sendJson(payload, "response.create");
  }

  submitToolResult(callId: string, result: unknown, options?: RealtimeVoiceToolResultOptions): void {
    const output = typeof result === "string" ? result : JSON.stringify(result);
    this.sendJson({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output },
    }, "conversation.item.create");
    if (!options?.suppressResponse && !options?.willContinue) {
      this.sendJson({ type: "response.create" }, "response.create");
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.ws?.close(1000, "client closed"); } catch { /* noop */ }
    this.connected = false;
  }
}

export function buildXaiRealtimeVoiceProvider(): RealtimeVoiceProviderPlugin {
  return {
    id: "xai-realtime",
    label: "xAI Grok Voice Agent",
    aliases: ["xai", "grok-realtime", "grok-voice"],
    defaultModel: DEFAULT_MODEL,
    autoSelectOrder: 30,
    capabilities: {
      transports: ["gateway-relay"],
      inputAudioFormats: [REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ],
      outputAudioFormats: [REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ],
      // Browser sessions route through gateway-relay (gateway holds the xAI
      // WebSocket; browser talks to gateway). xAI has no ephemeral-token
      // endpoint, so we cannot do client-owned WebRTC.
      supportsBrowserSession: true,
      supportsBargeIn: true,
      supportsToolCalls: true,
    },
    resolveConfig: (ctx) => {
      const pluginCfg = readPluginEntryConfig(ctx.cfg);
      return { ...pluginCfg, ...(ctx.rawConfig ?? {}) };
    },
    isConfigured: (ctx): boolean => {
      const merged = mergeProviderConfig({ cfg: ctx.cfg, providerConfig: ctx.providerConfig });
      if ((merged.apiKey as string)?.trim()) return true;
      if (process.env.XAI_API_KEY?.trim()) return true;
      // Assume xAI OAuth profile exists; bridge connect() will surface a clear error if not.
      return true;
    },
    createBridge: (req) => new XaiRealtimeVoiceBridge(req, resolveConfig(req)),
  };
}
