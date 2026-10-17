type PostMedia = { id: string; title?: string; coverUrl: string | null; mediaUrl: string | null; gallery: { url: string }[]; body: string };
type VideoMedia = { id: string; title?: string; sk: string; videoUrl: string; thumbUrl: string | null };

export function storedMediaKey(url: string | null, bases: string[]): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    for (const base of bases) {
      const b = new URL(base.replace(/\/$/, "") + "/");
      if (u.origin === b.origin && u.pathname.startsWith(b.pathname)) {
        const key = decodeURIComponent(u.pathname.slice(b.pathname.length));
        if (/^[\w.-]+(?:\/[\w.-]+)*$/.test(key) && !key.split("/").some((p) => p === "." || p === "..")) return key;
      }
    }
  } catch { /* Not a stored media URL. */ }
  return null;
}

export const postMediaUrls = (p: PostMedia) => [p.coverUrl, p.mediaUrl, ...p.gallery.map((g) => g.url), ...(p.body.match(/https?:\/\/[^\s)"'<>]+/g) ?? [])];
export function postThumbnail(p: Pick<PostMedia, "coverUrl" | "gallery" | "body">): string | null {
  return p.coverUrl || p.gallery[0]?.url || p.body.match(/https?:\/\/[^\s)"'<>]+\/(?:images|thumbs)\/[\w.-]+/)?.[0] || null;
}

/** Remove entire linked content; preserve files shared with surviving content. */
export function mediaDeletionPlan(key: string, posts: PostMedia[], videos: VideoMedia[], bases: string[]) {
  const keys = (urls: (string | null)[]) => urls.flatMap((url) => { const k = storedMediaKey(url, bases); return k ? [k] : []; });
  const postKeys = (p: PostMedia) => keys(postMediaUrls(p));
  const videoKeys = (v: VideoMedia) => keys([v.videoUrl, v.thumbUrl]);
  const removedPosts = posts.filter((p) => postKeys(p).includes(key));
  const removedVideos = videos.filter((v) => videoKeys(v).includes(key));
  const shared = new Set([...posts.filter((p) => !removedPosts.includes(p)).flatMap(postKeys), ...videos.filter((v) => !removedVideos.includes(v)).flatMap(videoKeys)]);
  const files = [...new Set([key, ...removedPosts.flatMap(postKeys), ...removedVideos.flatMap(videoKeys)])].filter((k) => !shared.has(k));
  return { posts: removedPosts, videos: removedVideos, files };
}

export async function executeMediaDeletion(plan: ReturnType<typeof mediaDeletionPlan>, ops: {
  removePost: (id: string) => Promise<void>;
  removeVideo: (v: VideoMedia) => Promise<void>;
  removeFile: (key: string) => Promise<void>;
  invalidate: () => Promise<void>;
}) {
  try {
    for (const p of plan.posts) await ops.removePost(p.id);
    for (const v of plan.videos) await ops.removeVideo(v);
    for (const key of plan.files) await ops.removeFile(key);
  } finally {
    // Even partial failures must stop deleted records being served from cache.
    await ops.invalidate();
  }
}