import { describe, expect, it } from "vitest";
import { sanitizeWindowsFilenameBase } from "../src/utils/filename.js";

describe("sanitizeWindowsFilenameBase", () => {
  it("removes illegal chars and trims", () => {
    expect(sanitizeWindowsFilenameBase('Produk / Baru: "A"*?')).toBe("Produk Baru A");
  });

  it("removes trailing dots/spaces", () => {
    expect(sanitizeWindowsFilenameBase("Judul....   ")).toBe("Judul");
  });

  it("falls back when empty", () => {
    expect(sanitizeWindowsFilenameBase("   ")).toBe("video");
  });

  it("avoids reserved windows names", () => {
    expect(sanitizeWindowsFilenameBase("CON")).toBe("CON-video");
    expect(sanitizeWindowsFilenameBase("lpt9")).toBe("lpt9-video");
  });

  it("truncates to max length", () => {
    const long = "A".repeat(500);
    expect(sanitizeWindowsFilenameBase(long, { maxLength: 80 }).length).toBeLessThanOrEqual(80);
  });
});

