import { describe, expect, it } from "vitest";
import { buildSrt, buildTimedCues, formatSrtTimestamp } from "../src/utils/srt.js";

describe("srt utils", () => {
  it("formats timestamp correctly", () => {
    expect(formatSrtTimestamp(3723456)).toBe("01:02:03,456");
  });

  it("builds cues inside total duration", () => {
    const script =
      "Produk ini bantu rutinitas harian lebih praktis, cepat, dan nyaman dipakai kapan saja. Cocok untuk pengguna yang butuh solusi simpel tanpa ribet.";
    const cues = buildTimedCues(script, 12);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0]?.startMs).toBe(0);
    expect(cues[cues.length - 1]?.endMs).toBe(12000);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) {
        expect(line.length).toBeLessThanOrEqual(42);
      }
      expect(cue.endMs - cue.startMs).toBeGreaterThan(0);
    }
  });

  it("outputs valid srt blocks", () => {
    const srt = buildSrt("Tes singkat untuk subtitle.", 4);
    expect(srt).toContain("1");
    expect(srt).toContain("-->");
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3}/);
  });
});
