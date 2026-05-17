#!/usr/bin/env node
/**
 * Live smoke test for xAI Voice Agent API (realtime WebSocket).
 * Verifies that our OAuth Bearer (read from main agent auth-profiles.json)
 * is accepted by `wss://api.x.ai/v1/realtime`.
 *
 * If this passes, we know we can register an OpenClaw RealtimeVoiceProvider
 * that reuses the same SuperGrok OAuth (no per-minute metered billing).
 *
 * Sends one text message and waits for audio.delta + audio.done events.
 */

import { resolveXaiAuth } from "../dist/xai-oauth.js";
import { writeFile } from "node:fs/promises";

const MODEL = "grok-voice-think-fast-1.0";
const VOICE = "rex";
const URL = `wss://api.x.ai/v1/realtime?model=${MODEL}`;
const TEXT = "Скажи короткое приветствие на русском, не больше десяти слов.";

console.log(`url:   ${URL}`);
console.log(`voice: ${VOICE}`);
console.log(`text:  ${TEXT}\n`);

console.log("[1/4] Resolving xAI OAuth from main agent...");
const auth = await resolveXaiAuth({ agentId: "main" });
console.log(`  source:  ${auth.source}`);
console.log(`  bearer:  ${auth.bearer.slice(0, 16)}...${auth.bearer.slice(-8)}\n`);

console.log("[2/4] Opening WebSocket with Authorization: Bearer ...");
const ws = new WebSocket(URL, {
  headers: { Authorization: `Bearer ${auth.bearer}` },
});

const audioChunks = [];
let receivedAny = false;
let timeline = [];

const start = Date.now();
const log = (label) => {
  const t = Date.now() - start;
  timeline.push(`  [+${String(t).padStart(5)}ms] ${label}`);
};

const done = new Promise((resolve, reject) => {
  ws.addEventListener("open", () => {
    log("WebSocket open");
    console.log("[3/4] WebSocket open — sending session.update + message + response.create");
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        voice: VOICE,
        instructions: "Отвечай кратко на русском.",
        turn_detection: null,
        audio: {
          output: { format: { type: "audio/pcm", rate: 24000 } },
        },
      },
    }));
    ws.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: TEXT }],
      },
    }));
    ws.send(JSON.stringify({ type: "response.create" }));
  });

  ws.addEventListener("message", (evt) => {
    receivedAny = true;
    let parsed;
    try { parsed = JSON.parse(evt.data.toString()); } catch { return; }
    const type = parsed.type ?? "unknown";

    if (type === "response.audio.delta" || type === "response.output_audio.delta") {
      audioChunks.push(Buffer.from(parsed.delta, "base64"));
    } else {
      log(type);
    }

    if (type === "response.done" || type === "response.audio.done" || type === "response.output_audio.done") {
      if (audioChunks.length > 0) {
        setTimeout(() => ws.close(1000, "test done"), 200);
      }
    }

    if (type === "error") {
      console.error("  xAI error:", JSON.stringify(parsed.error ?? parsed, null, 2));
      ws.close(1000, "error");
      reject(new Error("xAI error event"));
    }
  });

  ws.addEventListener("close", (evt) => {
    log(`close code=${evt.code} reason=${evt.reason || "(none)"}`);
    if (!receivedAny) reject(new Error(`closed before any message (code=${evt.code})`));
    else resolve();
  });

  ws.addEventListener("error", (err) => reject(err));

  setTimeout(() => {
    ws.close(1000, "timeout");
    reject(new Error("30s timeout"));
  }, 30_000);
});

await done.catch((err) => {
  console.error("\n✗ FAIL:", err.message);
  console.error("Timeline:");
  console.error(timeline.join("\n"));
  process.exit(1);
});

console.log("\n[4/4] Done. Event timeline:");
console.log(timeline.join("\n"));

if (audioChunks.length > 0) {
  const pcm = Buffer.concat(audioChunks);
  const path = "/tmp/openclaw-xai-realtime-test.pcm";
  await writeFile(path, pcm);
  console.log(`\n✓ Received ${audioChunks.length} audio chunks (${pcm.length} bytes PCM @ 24kHz).`);
  console.log(`  Saved → ${path}`);
  console.log(`  Play: ffplay -f s16le -ar 24000 -ac 1 ${path}`);
}

console.log("\n✓ OAuth Bearer accepted by xAI realtime endpoint.");
