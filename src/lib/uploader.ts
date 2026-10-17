// Browser-side resumable uploader. Splits the file into chunks, sends each through the
// server to R2 multipart, retries failed chunks, supports cancel, and resumes after reload
// (progress is remembered per file in localStorage and verified against R2's part list).
export type Progress = { sent: number; total: number };
import { fetchWithDeadline, PERFORMANCE } from "./performance";
type Saved = { key: string; uploadId: string; url: string };

const MB = 1024 * 1024;
/** Part size: 32 MB normally, growing for huge files so we stay under R2's 10,000-part cap (max ~880 GB). */
export const chunkSize = (size: number) => Math.min(88 * MB, Math.max(32 * MB, Math.ceil(size / 9500)));
export const MAX_UPLOAD_BYTES = 88 * MB * 10000;
/** Per-video limit: 30 GB. */
export const MAX_VIDEO_BYTES = 30 * 1024 * MB;
/** Files up to this size use the single-request direct upload (/api/upload, 95 MB server cap). */
export const DIRECT_UPLOAD_BYTES = 90 * MB;

async function directUpload(token: string, file: File, kind: "video" | "thumb" | "image", type: string, signal: AbortSignal) {
  const res = await fetch(`/api/upload?kind=${kind}`, {
    method: "POST",
    body: file,
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": type },
  });
  const j = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
  if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status})`);
  return j as { key: string; url: string };
}
const PARALLEL = 6;
// Direct-to-R2 mode: the browser PUTs chunks straight to storage with a short-lived signed URL,
// skipping the app server. Falls back to the server relay automatically if the bucket rejects it.
let direct = true;
async function directPart(url: string, chunk: Blob, signal: AbortSignal) {
  const res = await fetch(url, { method: "PUT", body: chunk, signal });
  const etag = res.headers.get("etag");
  if (!res.ok || !etag) throw new Error(`direct ${res.status}`);
  return etag;
}

async function call(token: string, qs: string, init: RequestInit = {}) {
  const res = await fetchWithDeadline(`/api/upload-part?${qs}`, {
    method: "POST",
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  }, PERFORMANCE.uploadTimeoutMs);
  const j = await res.json().catch(() => ({ error: `Upload error (${res.status})` }));
  if (!res.ok) throw new Error(j.error ?? `Upload error (${res.status})`);
  return j;
}

export async function uploadResumable(
  getToken: () => Promise<string>,
  file: File,
  kind: "video" | "thumb" | "image" | "audio" | "doc" | "sub",
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<{ key: string; url: string }> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is larger than the 880 GB storage limit.");
  if (kind === "video" && file.size > MAX_VIDEO_BYTES) throw new Error("Videos can be up to 30 GB.");
  const type = file.type || ({ video: "video/mp4", audio: "audio/mpeg", doc: "application/pdf", sub: "text/vtt" } as Record<string, string>)[kind] || "image/jpeg";
  // Prefer straight-to-storage uploads for every size; only use the server relay once storage has refused the browser.
  if (!direct && (kind === "video" || kind === "thumb" || kind === "image") && file.size > 0 && file.size <= DIRECT_UPLOAD_BYTES) {
    const r = await directUpload(await getToken(), file, kind, type, signal);
    onProgress({ sent: file.size, total: file.size });
    return r;
  }
  const memo = `lg-up:${kind}:${file.name}:${file.size}:${file.lastModified}`;
  const size = chunkSize(file.size);
  const count = Math.max(1, Math.ceil(file.size / size));
  let token = await getToken();
  let s: Saved | null = null;
  try { s = JSON.parse(localStorage.getItem(memo) ?? "null") as Saved | null; } catch { localStorage.removeItem(memo); }
  let done = new Map<number, string>();
  if (s) {
    try {
      const { parts } = await call(token, `op=list&key=${s.key}&uploadId=${encodeURIComponent(s.uploadId)}`, { signal });
      for (const p of parts) done.set(p.n, p.etag);
    } catch (e) {
      if (signal.aborted) throw e;
      s = null;
      done = new Map();
    }
  }
  if (!s) {
    s = await call(token, `op=create&kind=${kind}`, { signal, headers: { "Content-Type": type } });
    localStorage.setItem(memo, JSON.stringify(s));
  }
  if (!s) throw new Error("Upload could not be started.");
  const saved = s;
  const bytesFor = (n: number) => Math.min(size, file.size - (n - 1) * size);
  let sent = [...done.keys()].reduce((a, n) => a + bytesFor(n), 0);
  onProgress({ sent, total: file.size });

  const queue: number[] = [];
  for (let n = 1; n <= count; n++) if (!done.has(n)) queue.push(n);
  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      const chunk = file.slice((n - 1) * size, n * size);
      for (let attempt = 1; ; attempt++) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        try {
          token = await getToken();
          const qs = `key=${saved.key}&uploadId=${encodeURIComponent(saved.uploadId)}&n=${n}`;
          if (direct) {
            try {
              const { url } = await call(token, `op=sign&${qs}`, { signal });
              done.set(n, await directPart(url, chunk, signal));
              break;
            } catch (e) {
              if (signal.aborted) throw e;
              direct = false; // bucket blocks browser uploads: use the server relay from now on
            }
          }
          const r = await call(token, `op=part&key=${saved.key}&uploadId=${encodeURIComponent(saved.uploadId)}&n=${n}`, {
            body: chunk,
            signal,
            headers: { "Content-Type": "application/octet-stream" },
          });
          done.set(n, r.etag);
          break;
        } catch (e) {
          if (signal.aborted || attempt >= 6) throw e;
          await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** attempt)));
        }
      }
      sent += chunk.size;
      onProgress({ sent, total: file.size });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length || 1) }, worker));
  await call(await getToken(), `op=complete&key=${saved.key}&uploadId=${encodeURIComponent(saved.uploadId)}`, {
    signal,
    body: JSON.stringify({ parts: [...done].map(([n, etag]) => ({ n, etag })) }),
    headers: { "Content-Type": "application/json" },
  });
  localStorage.removeItem(memo);
  return { key: saved.key, url: saved.url };
}

export async function cancelUpload(getToken: () => Promise<string>, file: File, kind: string) {
  const memo = `lg-up:${kind}:${file.name}:${file.size}:${file.lastModified}`;
  const s: Saved | null = JSON.parse(localStorage.getItem(memo) ?? "null");
  localStorage.removeItem(memo);
  if (s) await call(await getToken(), `op=abort&key=${s.key}&uploadId=${encodeURIComponent(s.uploadId)}`).catch(() => {});
}

/** Seek through a few points and return the first frame that isn't (nearly) black. Works for any length: only one frame is decoded per try. */
function grabFrame(src: string, cors: boolean, timeoutMs: number): Promise<File | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let settled = false;
    let tries: number[] = [];
    let best: Blob | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const done = (f: File | null) => { if (settled) return; settled = true; clearTimeout(timeout); v.onloadedmetadata = null; v.onseeked = null; v.onerror = null; v.removeAttribute("src"); v.load(); resolve(f); };
    const finish = () => done(best ? new File([best], "thumb.jpg", { type: "image/jpeg" }) : null);
    const next = () => { const t = tries.shift(); if (t === undefined) return finish(); v.currentTime = t; };
    if (cors) v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = src;
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 4;
      tries = [1, 3, d * 0.1, d * 0.25, d * 0.5].map((t) => Math.min(t, Math.max(0, d - 0.1)));
      next();
    };
    v.onseeked = () => {
      try {
        const w = 640, h = Math.round((v.videoHeight / v.videoWidth) * 640) || 360;
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(v, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        let sum = 0, n = 0;
        for (let i = 0; i < px.length; i += 4 * 97) { sum += px[i]! + px[i + 1]! + px[i + 2]!; n++; }
        const bright = sum / (n * 3);
        c.toBlob((b) => {
          if (b && !best) best = b;
          if (b && bright > 18) { best = b; return finish(); }
          next();
        }, "image/jpeg", 0.8);
      } catch { finish(); }
    };
    v.onerror = () => done(null);
    timeout = setTimeout(finish, timeoutMs);
  });
}

/** Grab a real (non-black) frame from the video file to use as its thumbnail. */
export async function captureThumbnail(file: File): Promise<File | null> {
  const url = URL.createObjectURL(file);
  try { return await grabFrame(url, false, 30000); } finally { URL.revokeObjectURL(url); }
}

/** Grab a frame from an already-uploaded video (via the same-origin /api/media proxy). */
export function captureThumbnailFromUrl(videoUrl: string): Promise<File | null> {
  const m = /\/(videos\/[\w-]+)$/.exec(videoUrl);
  if (!m) return Promise.resolve(null);
  return grabFrame(`/api/media/${m[1]}`, true, 45000);
}

/** True when a saved thumbnail is (nearly) black, so it should be rebuilt from the video. Reads it through the same-origin proxy. */
export function isDarkThumb(thumbUrl: string): Promise<boolean> {
  const m = /\/(thumbs\/[\w-]+)$/.exec(thumbUrl);
  if (!m) return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 64; c.height = 36;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, 64, 36);
        const px = ctx.getImageData(0, 0, 64, 36).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += px[i]! + px[i + 1]! + px[i + 2]!;
        resolve(sum / ((px.length / 4) * 3) <= 18);
      } catch { resolve(false); }
    };
    img.onerror = () => resolve(true); // broken thumbnail: rebuild it too
    setTimeout(() => resolve(false), 15000);
    img.src = `/api/media/${m[1]}`;
  });
}
