/**
 * xAI Text-to-Speech REST client.
 *
 * Endpoint: POST {baseUrl}/tts
 * Docs:     https://docs.x.ai/developers/rest-api-reference/inference/voice
 *
 * Auth: Bearer token (SuperGrok OAuth access token, or XAI_API_KEY).
 * Body shape mirrors xAI's documented minimal payload:
 *   { text, voice_id, language, output_format?: { codec, sample_rate, bit_rate } }
 *
 * Returns raw audio bytes in the requested codec.
 */

import { forceRefreshXaiAuth, resolveXaiAuth } from "./xai-oauth.js";

export type XaiTTSCodec = "mp3" | "wav" | "pcm" | "mulaw" | "alaw";

export type XaiTTSParams = {
  text: string;
  agentId: string;
  apiKeyOverride?: string;
  baseUrl?: string;
  voiceId?: string;
  language?: string;
  codec?: XaiTTSCodec;
  sampleRate?: number;
  bitRate?: number;
  timeoutMs?: number;
};

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_CODEC: XaiTTSCodec = "mp3";
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_BIT_RATE = 128_000;

function buildPayload(params: XaiTTSParams): Record<string, unknown> {
  const codec = params.codec ?? DEFAULT_CODEC;
  const sampleRate = params.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const bitRate = params.bitRate ?? DEFAULT_BIT_RATE;

  // xAI /v1/tts requires `language` (HTTP 422 otherwise). Accepts short BCP-47
  // codes (`en`, `ru`, `zh`, `pt-BR`, etc.) or `auto` for automatic detection.
  const raw = params.language?.trim() ?? "";
  const language = !raw || raw === "multi" ? "auto" : raw;
  const payload: Record<string, unknown> = { text: params.text, language };
  if (params.voiceId?.trim()) payload.voice_id = params.voiceId.trim();

  // Match Hermes' behavior: only send output_format when it differs from xAI defaults.
  const needsFormat =
    codec !== DEFAULT_CODEC ||
    sampleRate !== DEFAULT_SAMPLE_RATE ||
    (codec === "mp3" && bitRate !== DEFAULT_BIT_RATE);
  if (needsFormat) {
    const format: Record<string, unknown> = { codec };
    if (sampleRate) format.sample_rate = sampleRate;
    if (codec === "mp3" && bitRate) format.bit_rate = bitRate;
    payload.output_format = format;
  }

  return payload;
}

async function postOnce(
  url: string,
  bearer: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        "User-Agent": "openclaw-xai-speech/0.1.1",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthesize speech via xAI. Auto-refreshes the OAuth token on 401 once.
 */
export async function xaiTTS(params: XaiTTSParams): Promise<Buffer> {
  const baseUrl = (params.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/tts`;
  const body = buildPayload(params);
  const timeoutMs = params.timeoutMs ?? 30_000;

  let auth = await resolveXaiAuth({
    agentId: params.agentId,
    apiKeyOverride: params.apiKeyOverride,
    timeoutMs,
  });

  let res = await postOnce(url, auth.bearer, body, timeoutMs);

  if (res.status === 401 && auth.source === "oauth") {
    auth = await forceRefreshXaiAuth({ agentId: params.agentId, timeoutMs });
    res = await postOnce(url, auth.bearer, body, timeoutMs);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`xAI TTS failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
