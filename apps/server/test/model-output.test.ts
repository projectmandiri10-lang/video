import { describe, expect, it } from "vitest";
import {
  ensureSocialMetadata,
  extractAudioFromResponse,
  extractSocialMetadata,
  extractScriptText
} from "../src/utils/model-output.js";

describe("model output parser", () => {
  it("extracts script from code fence json", () => {
    const response = {
      text: "```json\n{\"script\":\"Halo ini script.\"}\n```"
    };
    expect(extractScriptText(response)).toBe("Halo ini script.");
  });

  it("extracts script from candidates text", () => {
    const response = {
      candidates: [
        {
          content: {
            parts: [{ text: "Script langsung dari candidates." }]
          }
        }
      ]
    };
    expect(extractScriptText(response)).toContain("Script langsung");
  });

  it("extracts base64 audio", () => {
    const base64 = Buffer.from("test-audio").toString("base64");
    const response = {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: base64, mimeType: "audio/wav" } }]
          }
        }
      ]
    };
    const audio = extractAudioFromResponse(response);
    expect(audio.data.toString("utf8")).toBe("test-audio");
    expect(audio.mimeType).toBe("audio/wav");
  });

  it("extracts social metadata from json", () => {
    const response = {
      text: '{"caption":"Produk praktis buat harian kamu. Klik untuk lihat detail!","hashtags":["#reelsfacebook","#affiliate","#produkviral"]}'
    };
    const social = extractSocialMetadata(response);
    expect(social.caption).toContain("Produk praktis");
    expect(social.hashtags).toContain("#affiliate");
  });

  it("falls back to default metadata if hashtags empty", () => {
    const candidate = {
      caption: "Caption saja tanpa hashtag",
      hashtags: []
    };
    const social = ensureSocialMetadata(candidate, "Fallback caption", [
      "#reelsfacebook",
      "#affiliate"
    ]);
    expect(social.caption).toContain("Caption saja");
    expect(social.hashtags.length).toBeGreaterThan(0);
  });
});
