import { describe, expect, it } from "vitest";
import { truncateForTTS } from "./truncate.js";

describe("truncateForTTS", () => {
  it("returns text unchanged when under the limit", () => {
    const r = truncateForTTS("hello", 100);
    expect(r).toEqual({ text: "hello", truncated: false });
  });

  it("cuts at the last sentence boundary inside the window", () => {
    const text = "First sentence. Second one. Third still fits. Fourth overflows the cap badly.";
    const r = truncateForTTS(text, 45);
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith(".")).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(45);
    expect(r.text).toBe("First sentence. Second one. Third still fits.");
  });

  it("falls back to last whitespace when no sentence boundary is in the upper half", () => {
    const text = "word ".repeat(100);
    const r = truncateForTTS(text, 47);
    expect(r.truncated).toBe(true);
    expect(r.text).not.toContain(".");
    expect(r.text).toMatch(/\S$/);
    expect(r.text.length).toBeLessThanOrEqual(47);
  });

  it("hard cuts when there's no whitespace or sentence within the window", () => {
    const text = "a".repeat(200);
    const r = truncateForTTS(text, 50);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(50);
  });

  it("handles empty string", () => {
    expect(truncateForTTS("", 100)).toEqual({ text: "", truncated: false });
  });

  it("respects xAI's 15000 char production limit on typical assistant reply", () => {
    const para = "Текст ответа, состоящий из нескольких предложений. ".repeat(400);
    const r = truncateForTTS(para, 15_000);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(15_000);
    expect(r.text.endsWith(".")).toBe(true);
  });
});
