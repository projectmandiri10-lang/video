import { describe, expect, it } from "vitest";
import {
  AUTO_RETRY_DELAYS_SEC,
  classifyGeminiError,
  getAutoRetryDelaySec
} from "../src/utils/gemini-retry.js";

describe("gemini retry utils", () => {
  it("classifies unavailable from JSON payload", () => {
    const error = new Error(
      '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}'
    );
    expect(classifyGeminiError(error)).toBe("UNAVAILABLE");
  });

  it("classifies unavailable from raw text", () => {
    expect(classifyGeminiError(new Error("Request failed with status code 503"))).toBe(
      "UNAVAILABLE"
    );
  });

  it("classifies resource exhausted from status", () => {
    expect(
      classifyGeminiError({
        status: "RESOURCE_EXHAUSTED",
        code: 429
      })
    ).toBe("RESOURCE_EXHAUSTED");
  });

  it("maps retry attempt to configured delay", () => {
    expect(getAutoRetryDelaySec(1)).toBe(AUTO_RETRY_DELAYS_SEC[0]);
    expect(getAutoRetryDelaySec(2)).toBe(AUTO_RETRY_DELAYS_SEC[1]);
    expect(getAutoRetryDelaySec(6)).toBe(AUTO_RETRY_DELAYS_SEC[5]);
    expect(getAutoRetryDelaySec(7)).toBeNull();
  });
});
