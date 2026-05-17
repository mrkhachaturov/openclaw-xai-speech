import type {
  SpeechProviderPlugin,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from "./types.js";
import { xaiTTS, type XaiTTSCodec } from "./xai-client.js";
import { encodeOpus } from "./opus-encode.js";
import { truncateForTTS } from "./truncate.js";

const PLUGIN_ID = "openclaw-xai-speech";
const DEFAULT_AGENT_ID = "main";
const DEFAULT_MAX_TEXT = 15_000;
const DEFAULT_TIMEOUT_MS = 60_000;

type ResolvedConfig = {
  voiceId: string;
  language: string;
  codec: XaiTTSCodec;
  sampleRate: number;
  bitRate: number;
  baseUrl: string;
  authProfileAgent: string;
  apiKey?: string;
  ffmpegPath: string;
  voiceNoteEncoding: "opus" | "mp3";
  timeoutMs: number;
  maxTextLength: number;
};

function readPluginConfig(req: { cfg: unknown }): Record<string, unknown> {
  const cfg = req.cfg as Record<string, unknown> | undefined;
  const plugins = cfg?.plugins as Record<string, unknown> | undefined;
  const entries = plugins?.entries as Record<string, Record<string, unknown>> | undefined;
  const entry = entries?.[PLUGIN_ID];
  return (entry?.config as Record<string, unknown>) ?? {};
}

function resolveConfig(req: SpeechSynthesisRequest): ResolvedConfig {
  const plugin = readPluginConfig(req);
  const inline = ((req.config as Record<string, unknown>)?.xai as Record<string, unknown>) ?? {};
  // Plugin config wins over inline tts.xai if both ever exist.
  const merged = { ...inline, ...plugin };

  return {
    voiceId: (merged.voiceId as string)?.trim() ?? "",
    language: ((merged.language as string)?.trim()) || "ru-RU",
    codec: ((merged.codec as XaiTTSCodec) || "mp3"),
    sampleRate: typeof merged.sampleRate === "number" ? merged.sampleRate : 24_000,
    bitRate: typeof merged.bitRate === "number" ? merged.bitRate : 64_000,
    baseUrl: ((merged.baseUrl as string)?.trim()) || "https://api.x.ai/v1",
    authProfileAgent: ((merged.authProfileAgent as string)?.trim()) || DEFAULT_AGENT_ID,
    apiKey: (merged.apiKey as string)?.trim() || undefined,
    ffmpegPath: ((merged.ffmpegPath as string)?.trim()) || "ffmpeg",
    voiceNoteEncoding: ((merged.voiceNoteEncoding as "opus" | "mp3") || "opus"),
    timeoutMs: typeof merged.timeoutMs === "number" ? merged.timeoutMs : DEFAULT_TIMEOUT_MS,
    maxTextLength: typeof merged.maxTextLength === "number" ? merged.maxTextLength : DEFAULT_MAX_TEXT,
  };
}

export function buildXaiSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "xai-speech",
    label: "xAI Grok TTS",
    aliases: ["grok", "grok-tts", "xai-grok-tts"],

    isConfigured: ({ cfg }): boolean => {
      // Configured if: plugin apiKey override, XAI_API_KEY env, OR a readable xai:* OAuth
      // profile exists for the configured agent. Cheapest check first.
      const plugin = readPluginConfig({ cfg });
      if ((plugin.apiKey as string)?.trim()) return true;
      if (process.env.XAI_API_KEY?.trim()) return true;
      // We can't readFile sync-cheaply here; assume true and let synthesize raise a
      // clear error if no profile exists. Same approach as Yandex provider.
      return true;
    },

    synthesize: async (req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> => {
      const resolved = resolveConfig(req);

      const { text, truncated } = truncateForTTS(req.text, resolved.maxTextLength);
      if (truncated) {
        console.warn(
          `[openclaw-xai-speech] input truncated: ${req.text.length} → ${text.length} chars (max=${resolved.maxTextLength})`,
        );
      }

      const nativeAudio = await xaiTTS({
        text,
        agentId: resolved.authProfileAgent,
        apiKeyOverride: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        voiceId: resolved.voiceId || undefined,
        language: resolved.language,
        codec: resolved.codec,
        sampleRate: resolved.sampleRate,
        bitRate: resolved.bitRate,
        timeoutMs: resolved.timeoutMs,
      });

      // Voice-note target = Telegram/Discord native voice bubble → needs Opus.
      // xAI doesn't emit Opus directly, so convert MP3 via ffmpeg.
      if (req.target === "voice-note" && resolved.voiceNoteEncoding === "opus") {
        if (resolved.codec !== "mp3") {
          throw new Error(
            `voice-note Opus encoding requires xai codec=mp3 (got ${resolved.codec}); set plugin config codec=mp3 or voiceNoteEncoding=mp3.`,
          );
        }
        const opus = await encodeOpus({ mp3: nativeAudio, ffmpegPath: resolved.ffmpegPath });
        return {
          audioBuffer: opus,
          outputFormat: "oggopus",
          fileExtension: ".opus",
          voiceCompatible: true,
        };
      }

      // Otherwise ship the native codec as a file attachment.
      const ext =
        resolved.codec === "wav" ? ".wav" :
        resolved.codec === "mp3" ? ".mp3" :
        resolved.codec === "pcm" ? ".pcm" :
        ".bin";
      return {
        audioBuffer: nativeAudio,
        outputFormat: resolved.codec,
        fileExtension: ext,
        voiceCompatible: false,
      };
    },
  };
}
