import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { buildScriptPrompt } from "../src/services/prompt-builder.js";

describe("prompt builder", () => {
  it("enforces strong opening hook instruction", () => {
    const style = DEFAULT_SETTINGS.styles[0];
    if (!style) {
      throw new Error("Style default tidak ditemukan.");
    }

    const prompt = buildScriptPrompt({
      settings: DEFAULT_SETTINGS,
      style,
      title: "Serum pencerah wajah",
      description: "Serum dengan niacinamide untuk bantu mencerahkan kulit kusam.",
      videoDurationSec: 20
    });

    expect(prompt).toContain("Kalimat pembuka wajib menjadi hook kuat");
    expect(prompt).toContain("Instruksi style:");
  });
});
