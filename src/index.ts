import type { OpenClawPluginDefinition } from "./types.js";
import { buildXaiSpeechProvider } from "./speech-provider.js";
import { buildXaiRealtimeVoiceProvider } from "./realtime-voice-provider.js";

export { buildXaiSpeechProvider } from "./speech-provider.js";
export { buildXaiRealtimeVoiceProvider } from "./realtime-voice-provider.js";
export { xaiTTS, type XaiTTSParams, type XaiTTSCodec } from "./xai-client.js";
export { resolveXaiAuth, forceRefreshXaiAuth, type XaiAuth } from "./xai-oauth.js";
export { encodeOpus } from "./opus-encode.js";

const plugin: OpenClawPluginDefinition = {
  id: "openclaw-xai-speech",
  name: "xAI Grok Speech + Voice Agent",
  description:
    "xAI Grok speech synthesis (batch TTS) and realtime Voice Agent for OpenClaw. Reuses SuperGrok OAuth bearer from main agent auth-profiles.json; falls back to XAI_API_KEY. ffmpeg MP3→Opus for Telegram voice bubbles. WebSocket gateway-relay for browser Talk mode.",
  register(api) {
    api.registerSpeechProvider(buildXaiSpeechProvider());
    if (api.registerRealtimeVoiceProvider) {
      api.registerRealtimeVoiceProvider(buildXaiRealtimeVoiceProvider());
    }
  },
};

export default plugin;
