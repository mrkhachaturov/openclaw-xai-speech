#!/usr/bin/env node
/**
 * Live smoke test against real xAI /v1/tts.
 * Reads OAuth from main agent auth-profiles.json, hits the API, writes output.
 *
 * Usage:
 *   node scripts/live-test.mjs [text] [voice] [language]
 *
 * Defaults: text="Привет, это тестовое сообщение.", voice="rex", language="auto"
 */

import { resolveXaiAuth } from "../dist/xai-oauth.js";
import { xaiTTS } from "../dist/xai-client.js";
import { encodeOpus } from "../dist/opus-encode.js";
import { writeFile } from "node:fs/promises";

const text = process.argv[2] || "Привет, это тестовое сообщение от плагина OpenClaw xAI Speech.";
const voiceId = process.argv[3] || "rex";
const language = process.argv[4] || "auto";

console.log(`text:     ${text}`);
console.log(`voice:    ${voiceId}`);
console.log(`language: ${language}`);
console.log("");

// 1. Resolve auth
console.log("[1/4] Resolving xAI OAuth from main agent...");
const auth = await resolveXaiAuth({ agentId: "main" });
console.log(`  source:  ${auth.source}`);
console.log(`  expires: ${new Date(auth.expires).toISOString()}`);
console.log(`  bearer:  ${auth.bearer.slice(0, 16)}...${auth.bearer.slice(-8)}`);
console.log("");

// 2. Call xAI TTS
console.log("[2/4] Calling https://api.x.ai/v1/tts ...");
const t0 = Date.now();
const mp3 = await xaiTTS({
  text,
  agentId: "main",
  voiceId,
  language,
});
const t1 = Date.now();
console.log(`  ok: ${mp3.length} bytes in ${t1 - t0}ms`);
console.log("");

// 3. Save MP3
const mp3Path = "/tmp/openclaw-xai-test.mp3";
await writeFile(mp3Path, mp3);
console.log(`[3/4] Wrote MP3 → ${mp3Path}`);
console.log("");

// 4. Convert to Opus via ffmpeg
console.log("[4/4] Converting MP3 → Opus via ffmpeg...");
const opus = await encodeOpus({ mp3, ffmpegPath: "ffmpeg" });
const opusPath = "/tmp/openclaw-xai-test.opus";
await writeFile(opusPath, opus);
console.log(`  ok: ${opus.length} bytes → ${opusPath}`);
console.log("");
console.log("✓ All steps passed. Files:");
console.log(`  ${mp3Path}`);
console.log(`  ${opusPath}`);
