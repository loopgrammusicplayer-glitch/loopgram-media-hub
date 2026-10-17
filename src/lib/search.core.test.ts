import { describe, expect, it } from "vitest";
import { isValidCursor, score, searchCacheKey, tokenize } from "./search.core";

describe("search core", () => {
  it("caps query terms at 6 and drops 1-letter terms", () => {
    expect(tokenize("a bb cc dd ee ff gg hh")).toEqual(["bb", "cc", "dd", "ee", "ff", "gg"]);
  });
  it("requires every term to match", () => {
    expect(score(["vogue", "paris"], "Vogue in Milan", "fashion")).toBe(0);
    expect(score(["vogue", "paris"], "Vogue", "Paris week")).toBe(4);
  });
  it("cache key changes when the catalogue version changes", () => {
    expect(searchCacheKey(1, ["b", "a"], 0)).not.toBe(searchCacheKey(2, ["a", "b"], 0));
    expect(searchCacheKey(1, ["b", "a"], 0)).toBe(searchCacheKey(1, ["a", "b"], 0));
  });
  it("rejects malformed cursors", () => {
    expect(isValidCursor("2026-10-15T04:17:39.000Z#0b0e1c2a-1111-4222-8333-444455556666")).toBe(true);
    expect(isValidCursor("24")).toBe(true);
    expect(isValidCursor("VIDEO#x' OR 1")).toBe(false);
  });
});
