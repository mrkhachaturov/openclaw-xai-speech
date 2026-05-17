/**
 * ffmpeg-driven MP3 → Ogg/Opus conversion for Telegram voice bubbles.
 *
 * Spawns ffmpeg via stdio pipes so no temp files are required.
 */

import { spawn } from "node:child_process";

export type EncodeOpusParams = {
  mp3: Buffer;
  ffmpegPath: string;
  bitrate?: string;
  sampleRate?: number;
};

/**
 * Convert MP3 bytes to Ogg/Opus bytes (Telegram-compatible voice note).
 * Bitrate default 48k (matches Telegram's voice-note expectation).
 */
export async function encodeOpus(params: EncodeOpusParams): Promise<Buffer> {
  const bitrate = params.bitrate ?? "48k";
  const sampleRate = params.sampleRate ?? 48_000;

  return await new Promise<Buffer>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-vn",
      "-c:a", "libopus",
      "-b:a", bitrate,
      "-ar", String(sampleRate),
      "-ac", "1",
      "-f", "ogg",
      "pipe:1",
    ];
    const proc = spawn(params.ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c: Buffer) => errChunks.push(c));
    proc.on("error", (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString("utf8").trim();
        reject(new Error(`ffmpeg MP3→Opus failed (exit ${code}): ${msg.slice(0, 300)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    proc.stdin.on("error", (err) => reject(new Error(`ffmpeg stdin error: ${err.message}`)));
    proc.stdin.end(params.mp3);
  });
}
