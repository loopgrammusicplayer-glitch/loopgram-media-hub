import { createFileRoute } from "@tanstack/react-router";
import { allowedUpload, KEY_PREFIX, MEDIA_KEY_RE, type UploadKind } from "@/lib/content.core";

// Resumable multipart upload, proxied through the server (bucket has no browser CORS).
// POST ?op=create&kind=video|thumb|image  (Content-Type header = file type) -> { key, uploadId, url }
// POST ?op=part&key=&uploadId=&n=          (body = chunk)                   -> { n, etag }
// POST ?op=list&key=&uploadId=                                               -> { parts }
// POST ?op=complete&key=&uploadId=         (body = JSON {parts})             -> { url }
// POST ?op=abort&key=&uploadId=
const KEY_RE = MEDIA_KEY_RE;

export const Route = createFileRoute("/api/upload-part")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const b = await import("@/lib/backend.server");
        const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
        const u = await b.verifyUser(token).catch(() => null);
        if (!u) return Response.json({ error: "Please sign in again" }, { status: 401 });
        if (u.role !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
        const q = new URL(request.url).searchParams;
        const op = q.get("op");
        try {
          if (op === "create") {
            const kind = q.get("kind");
            const type = request.headers.get("content-type") ?? "";
            if (!kind || !(kind in KEY_PREFIX) || !allowedUpload(kind, type)) return Response.json({ error: "Unsupported file type" }, { status: 400 });
            const key = `${KEY_PREFIX[kind as UploadKind]}/${crypto.randomUUID()}`;
            const uploadId = await b.mpCreate(key, type);
            return Response.json({ key, uploadId, url: b.publicUrl(key) });
          }
          const key = q.get("key") ?? "";
          const uploadId = q.get("uploadId") ?? "";
          if (!KEY_RE.test(key) || !uploadId || uploadId.length > 1024) return Response.json({ error: "Bad upload" }, { status: 400 });
          if (op === "part") {
            const n = Number(q.get("n"));
            if (!Number.isInteger(n) || n < 1 || n > 10000) return Response.json({ error: "Bad part" }, { status: 400 });
            const body = await request.arrayBuffer();
            if (!body.byteLength || body.byteLength > 90 * 1024 * 1024) return Response.json({ error: "Bad chunk size" }, { status: 400 });
            return Response.json({ n, etag: await b.mpPart(key, uploadId, n, body) });
          }
          if (op === "sign") {
            const n = Number(q.get("n"));
            if (!Number.isInteger(n) || n < 1 || n > 10000) return Response.json({ error: "Bad part" }, { status: 400 });
            return Response.json({ url: await b.mpSignPart(key, uploadId, n) });
          }
          if (op === "list") return Response.json({ parts: await b.mpList(key, uploadId) });
          if (op === "complete") {
            const { parts } = (await request.json()) as { parts: { n: number; etag: string }[] };
            if (!Array.isArray(parts) || !parts.length || parts.length > 10000 || new Set(parts.map(p => p?.n)).size !== parts.length || parts.some(p => !p || !Number.isInteger(p.n) || p.n < 1 || p.n > 10000 || typeof p.etag !== "string" || !/^[a-zA-Z0-9"-]{1,128}$/.test(p.etag))) return Response.json({ error: "Invalid upload parts" }, { status: 400 });
            await b.mpComplete(key, uploadId, parts);
            return Response.json({ url: b.publicUrl(key) });
          }
          if (op === "abort") {
            await b.mpAbort(key, uploadId);
            return Response.json({ ok: true });
          }
          return Response.json({ error: "Unknown op" }, { status: 400 });
        } catch (e) {
          console.error("multipart failed", e);
          return Response.json({ error: "Upload could not be completed. Please retry." }, { status: 500 });
        }
      },
    },
  },
});
