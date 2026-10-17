import { describe, it, expect } from "vitest";
import { allowedUpload, safeLink, kindOf, parseGallery, formatDuration } from "./content.core";

describe("content rules", () => {
  it("refuses unsafe link schemes", () => {
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("data:text/html,hi")).toBeNull();
    expect(safeLink("https://example.com/a")).toBe("https://example.com/a");
  });
  it("accepts audio, PDFs and images but refuses SVG and HTML", () => {
    expect(allowedUpload("audio", "audio/mpeg")).toBe(true);
    expect(allowedUpload("doc", "application/pdf")).toBe(true);
    expect(allowedUpload("doc", "text/html")).toBe(false);
    expect(allowedUpload("image", "image/svg+xml")).toBe(false);
    expect(allowedUpload("audio", "video/mp4")).toBe(false);
  });
  it("old posts without a type are articles", () => {
    expect(kindOf(undefined)).toBe("article");
    expect(kindOf("audio")).toBe("audio");
  });
  it("broken gallery data is ignored safely", () => {
    expect(parseGallery("not json")).toEqual([]);
  });
  it("shows durations over 7 hours", () => {
    expect(formatDuration(7 * 3600 + 5 * 60 + 9)).toBe("7:05:09");
  });
});
