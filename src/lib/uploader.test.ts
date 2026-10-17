import { describe, it, expect } from "vitest";
import { chunkSize, MAX_UPLOAD_BYTES } from "./uploader";
const GB = 1024 ** 3;
describe("upload part planning", () => {
  it("a 30 GB video fits in R2's 10,000 part limit with parts under 90 MB", () => {
    const s = chunkSize(30 * GB);
    expect(Math.ceil((30 * GB) / s)).toBeLessThanOrEqual(10000);
    expect(s).toBeLessThanOrEqual(90 * 1024 * 1024);
  });
  it("allows files well beyond 30 GB", () => {
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(500 * GB);
    expect(Math.ceil((800 * GB) / chunkSize(800 * GB))).toBeLessThanOrEqual(10000);
  });
});

import { MAX_VIDEO_BYTES, DIRECT_UPLOAD_BYTES } from "./uploader";
describe("video limits", () => {
  it("allows 30 GB videos in under 10,000 parts and keeps direct uploads under 95 MB", () => {
    expect(MAX_VIDEO_BYTES).toBe(30 * 1024 ** 3);
    expect(Math.ceil(MAX_VIDEO_BYTES / chunkSize(MAX_VIDEO_BYTES))).toBeLessThanOrEqual(10000);
    expect(DIRECT_UPLOAD_BYTES).toBeLessThan(95 * 1024 ** 2);
  });
});
