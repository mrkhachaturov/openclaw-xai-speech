/**
 * Smart truncation at sentence/word boundary.
 *
 * xAI /v1/tts caps input at ~15,000 chars per request. We trim politely:
 *   1. Already short → return as-is.
 *   2. Cut at last sentence end (.!?) within the limit.
 *   3. Fallback: cut at last whitespace within the limit.
 *   4. Last resort: hard slice.
 */

const SENTENCE_BOUNDARY = /[.!?…](\s|$)/g;

export function truncateForTTS(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };

  const slice = text.slice(0, maxChars);

  // Try last sentence end inside the window.
  let lastEnd = -1;
  SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_BOUNDARY.exec(slice)) !== null) {
    lastEnd = match.index + 1;
  }
  if (lastEnd > maxChars * 0.5) {
    return { text: slice.slice(0, lastEnd).trim(), truncated: true };
  }

  // Fallback: last whitespace.
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.5) {
    return { text: slice.slice(0, lastSpace).trim(), truncated: true };
  }

  // Last resort: hard cut.
  return { text: slice, truncated: true };
}
