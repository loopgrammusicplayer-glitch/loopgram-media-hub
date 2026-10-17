// Pure rules for multimedia content (unit-tested). Shared by browser and server.
export const CONTENT_KINDS = ["article", "link", "audio", "images", "document"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export const KIND_LABEL: Record<ContentKind, string> = {
  article: "Article", link: "External link", audio: "Audio", images: "Images", document: "Document",
};

export type UploadKind = "video" | "thumb" | "image" | "audio" | "doc" | "sub";
export const KEY_PREFIX: Record<UploadKind, string> = { video: "videos", thumb: "thumbs", image: "images", audio: "audio", doc: "docs", sub: "subs" };
export const MEDIA_KEY_RE = /^(videos|thumbs|images|audio|docs|subs)\/[\w-]+$/;
export const MEDIA_URL_RE = /\/(videos|thumbs|images|audio|docs|subs)\/[\w-]+$/;

const DOC_TYPES = new Set([
  "application/pdf", "text/plain", "text/csv", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/epub+zip",
]);
/** Server-side check that a file type is allowed for an upload kind. Scriptable types (SVG, HTML) are refused. */
export function allowedUpload(kind: string, type: string): boolean {
  const t = type.toLowerCase().split(";")[0]!.trim();
  if (kind === "video") return t.startsWith("video/");
  if (kind === "thumb" || kind === "image") return t.startsWith("image/") && t !== "image/svg+xml";
  if (kind === "audio") return t.startsWith("audio/");
  if (kind === "doc") return DOC_TYPES.has(t);
  if (kind === "sub") return t === "text/vtt" || t === "application/x-subrip" || t === "text/plain" || t === "";
  return false;
}

/** Only plain http(s) links with a real host may be published. */
export function safeLink(u: string): string | null {
  try {
    const url = new URL(u.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type GalleryItem = { url: string; alt: string; caption: string };
/** Old records have no kind: treat them as articles. */
export const kindOf = (k: unknown): ContentKind => (CONTENT_KINDS as readonly string[]).includes(k as string) ? (k as ContentKind) : "article";
export function parseGallery(raw: unknown): GalleryItem[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.filter((x) => x && typeof x.url === "string").map((x) => ({ url: x.url, alt: String(x.alt ?? ""), caption: String(x.caption ?? "") })) : [];
  } catch {
    return [];
  }
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60), m = Math.floor((sec / 60) % 60), h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Extract an 11-char YouTube video id from common link forms; null when not a YouTube video link. */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})(?:[?&#/].*)?$/.exec(s);
  return m ? m[1]! : null;
}
export const isYoutube = (url: string) => /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(url);

/** Friendly post date, e.g. "16 Oct 2026". */
export const formatPostDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
