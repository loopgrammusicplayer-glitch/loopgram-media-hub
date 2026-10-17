import { describe, expect, it, vi } from "vitest";
import { executeMediaDeletion, mediaDeletionPlan, postThumbnail } from "./media.core";

const old = "https://old.r2.dev", current = "https://cdn.example.com";
const post = (id: string, mediaUrl: string | null, coverUrl: string | null = null) => ({ id, mediaUrl, coverUrl, gallery: [], body: "" });
describe("media deletion", () => {
  it("removes linked posts using either old or current storage address", () => {
    const plan = mediaDeletionPlan("audio/song", [post("song", `${old}/audio/song`, `${old}/images/cover`), post("other", `${current}/audio/other`)], [], [old, current]);
    expect(plan.posts.map((p) => p.id)).toEqual(["song"]);
    expect(plan.files).toEqual(["audio/song", "images/cover"]);
  });
  it("removes gallery and body-image posts when their image is deleted", () => {
    const p = post("gallery", null); p.gallery = [];
    const plan = mediaDeletionPlan("images/photo", [{ ...p, gallery: [{ url: `${old}/images/photo` }] }, { ...post("body", null), body: `${current}/images/photo` }], [], [old, current]);
    expect(plan.posts.map((p) => p.id)).toEqual(["gallery", "body"]);
  });
  it("preserves covers shared with surviving posts", () => {
    const plan = mediaDeletionPlan("audio/song", [post("song", `${old}/audio/song`, `${old}/images/shared`), post("keep", null, `${current}/images/shared`)], [], [old, current]);
    expect(plan.files).toEqual(["audio/song"]);
  });
  it("removes linked videos and their exclusive thumbnails", () => {
    const plan = mediaDeletionPlan("videos/clip", [], [{ id: "v", sk: "sk", videoUrl: `${old}/videos/clip`, thumbUrl: `${old}/thumbs/cover` }], [old]);
    expect(plan.videos.map((v) => v.id)).toEqual(["v"]);
    expect(plan.files).toEqual(["videos/clip", "thumbs/cover"]);
  });
  it("does not match files hosted by unrelated services", () => {
    expect(mediaDeletionPlan("images/photo", [post("keep", null, "https://external.example/images/photo")], [], [old]).posts).toEqual([]);
  });
  it("deletes database records and storage then invalidates caches", async () => {
    const plan = mediaDeletionPlan("audio/song", [post("song", `${old}/audio/song`)], [], [old]);
    const calls: string[] = [];
    await executeMediaDeletion(plan, { removePost: async (id) => { calls.push(`post:${id}`); }, removeVideo: vi.fn(), removeFile: async (key) => { calls.push(`file:${key}`); }, invalidate: async () => { calls.push("cache"); } });
    expect(calls).toEqual(["post:song", "file:audio/song", "cache"]);
  });
  it("invalidates caches and reports storage failure instead of false success", async () => {
    const invalidate = vi.fn(async () => {});
    const plan = mediaDeletionPlan("audio/song", [], [], [old]);
    await expect(executeMediaDeletion(plan, { removePost: vi.fn(), removeVideo: vi.fn(), removeFile: async () => { throw new Error("Storage failed"); }, invalidate })).rejects.toThrow("Storage failed");
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
describe("post thumbnails", () => {
  it("uses an uploaded cover for every post type", () => { expect(postThumbnail(post("audio", `${old}/audio/song`, `${old}/images/cover`))).toBe(`${old}/images/cover`); });
  it("uses the first gallery image without a separate cover", () => { expect(postThumbnail({ coverUrl: null, gallery: [{ url: `${old}/images/photo` }], body: "" })).toBe(`${old}/images/photo`); });
  it("uses an inserted article image when no cover is selected", () => { expect(postThumbnail({ coverUrl: null, gallery: [], body: `Story\n${old}/images/photo\n` })).toBe(`${old}/images/photo`); });
});