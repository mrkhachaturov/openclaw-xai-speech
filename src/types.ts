// Minimal type stubs for OpenClaw plugin SDK.
// Mirrors the subset of openclaw/plugin-sdk/core used by speech providers.
// Kept local so the package has zero runtime dependencies on openclaw.

export type SpeechProviderId = string;

export type SpeechSynthesisTarget = "audio-file" | "voice-note";

export type SpeechProviderConfiguredContext = {
  cfg?: unknown;
  config: Record<string, unknown>;
};

export type SpeechSynthesisRequest = {
  text: string;
  cfg: Record<string, unknown>;
  config: Record<string, unknown>;
  target: SpeechSynthesisTarget;
  overrides?: Record<string, unknown>;
};

export type SpeechSynthesisResult = {
  audioBuffer: Buffer;
  outputFormat: string;
  fileExtension: string;
  voiceCompatible: boolean;
};

export type SpeechVoiceOption = {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  locale?: string;
  gender?: string;
};

export type SpeechListVoicesRequest = {
  cfg?: unknown;
  config?: Record<string, unknown>;
  apiKey?: string;
  baseUrl?: string;
};

export type SpeechProviderPlugin = {
  id: SpeechProviderId;
  label: string;
  aliases?: string[];
  models?: readonly string[];
  voices?: readonly string[];
  isConfigured: (ctx: SpeechProviderConfiguredContext) => boolean;
  synthesize: (req: SpeechSynthesisRequest) => Promise<SpeechSynthesisResult>;
  listVoices?: (req: SpeechListVoicesRequest) => Promise<SpeechVoiceOption[]>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Realtime voice provider (Talk mode, gateway-relay / browser transport).
// Mirrors src/talk/provider-types.ts in upstream OpenClaw EXACTLY.
// ─────────────────────────────────────────────────────────────────────────────

export type RealtimeVoiceRole = "user" | "assistant";
export type RealtimeVoiceCloseReason = "completed" | "error";

export type RealtimeVoiceAudioFormat =
  | { encoding: "g711_ulaw"; sampleRateHz: 8000; channels: 1 }
  | { encoding: "pcm16"; sampleRateHz: 24000; channels: 1 };

export const REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ: RealtimeVoiceAudioFormat = {
  encoding: "pcm16",
  sampleRateHz: 24000,
  channels: 1,
};

export type RealtimeVoiceTool = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type RealtimeVoiceToolCallEvent = {
  itemId: string;
  callId: string;
  name: string;
  args: unknown;
};

export type RealtimeVoiceToolResultOptions = {
  suppressResponse?: boolean;
  willContinue?: boolean;
};

export type RealtimeVoiceBridgeEvent = {
  direction: "client" | "server";
  type: string;
  detail?: string;
};

export type RealtimeVoiceBargeInOptions = {
  audioPlaybackActive?: boolean;
  force?: boolean;
};

export type RealtimeVoiceBridgeCallbacks = {
  onAudio: (audio: Buffer) => void;
  onClearAudio: () => void;
  onMark?: (markName: string) => void;
  onTranscript?: (role: RealtimeVoiceRole, text: string, isFinal: boolean) => void;
  onEvent?: (event: RealtimeVoiceBridgeEvent) => void;
  onToolCall?: (event: RealtimeVoiceToolCallEvent) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onClose?: (reason: RealtimeVoiceCloseReason) => void;
};

export type RealtimeVoiceProviderConfig = Record<string, unknown>;

export type RealtimeVoiceProviderCapabilities = {
  transports: Array<"webrtc" | "gateway-relay" | "provider-websocket" | "managed-room">;
  inputAudioFormats: RealtimeVoiceAudioFormat[];
  outputAudioFormats: RealtimeVoiceAudioFormat[];
  supportsBrowserSession?: boolean;
  supportsBargeIn?: boolean;
  supportsToolCalls?: boolean;
  supportsVideoFrames?: boolean;
  supportsSessionResumption?: boolean;
};

export type RealtimeVoiceProviderResolveConfigContext = {
  cfg?: unknown;
  rawConfig: RealtimeVoiceProviderConfig;
};

export type RealtimeVoiceProviderConfiguredContext = {
  cfg?: unknown;
  providerConfig: RealtimeVoiceProviderConfig;
};

export type RealtimeVoiceBridgeCreateRequest = RealtimeVoiceBridgeCallbacks & {
  cfg?: unknown;
  providerConfig: RealtimeVoiceProviderConfig;
  audioFormat?: RealtimeVoiceAudioFormat;
  instructions?: string;
  autoRespondToAudio?: boolean;
  interruptResponseOnInputAudio?: boolean;
  tools?: RealtimeVoiceTool[];
};

export type RealtimeVoiceBridge = {
  supportsToolResultContinuation?: boolean;
  connect(): Promise<void>;
  sendAudio(audio: Buffer): void;
  setMediaTimestamp(ts: number): void;
  sendUserMessage?(text: string): void;
  triggerGreeting?(instructions?: string): void;
  handleBargeIn?(options?: RealtimeVoiceBargeInOptions): void;
  submitToolResult(callId: string, result: unknown, options?: RealtimeVoiceToolResultOptions): void;
  acknowledgeMark(): void;
  close(): void;
  isConnected(): boolean;
};

export type RealtimeVoiceProviderPlugin = {
  id: string;
  label: string;
  aliases?: string[];
  defaultModel?: string;
  autoSelectOrder?: number;
  capabilities?: RealtimeVoiceProviderCapabilities;
  resolveConfig?: (ctx: RealtimeVoiceProviderResolveConfigContext) => RealtimeVoiceProviderConfig;
  isConfigured: (ctx: RealtimeVoiceProviderConfiguredContext) => boolean;
  createBridge: (req: RealtimeVoiceBridgeCreateRequest) => RealtimeVoiceBridge;
};

export type OpenClawPluginAPI = {
  registerSpeechProvider: (provider: SpeechProviderPlugin) => void;
  registerRealtimeVoiceProvider?: (provider: RealtimeVoiceProviderPlugin) => void;
};

export type OpenClawPluginDefinition = {
  id: string;
  name: string;
  description: string;
  register: (api: OpenClawPluginAPI) => void;
};
