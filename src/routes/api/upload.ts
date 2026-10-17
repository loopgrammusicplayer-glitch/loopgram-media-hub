import { createFileRoute } from "@tanstack/react-router";

// Uploads go through the server so the browser never talks to R2 directly (no bucket CORS needed).
export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const b = await import("@/lib/backend.server");
        try {
          const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
          const u = await b.verifyUser(token).catch(() => null);
          if (!u) return Response.json({ error: "Please sign in again" }, { status: 401 });
          if (u.role !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
          const kind = new URL(request.url).searchParams.get("kind");
          const type = request.headers.get("content-type") ?? "";
          const ok = (kind === "video" && type.startsWith("video/")) || ((kind === "thumb" || kind === "image") && type.startsWith("image/"))
            || (kind === "sub" && (type.startsWith("text/") || type === "application/x-subrip" || type === "application/octet-stream"));
          if (!ok) return Response.json({ error: "Unsupported file type" }, { status: 400 });
          const len = Number(request.headers.get("content-length") ?? 0);
          if (len > 95 * 1024 * 1024) return Response.json({ error: "File too large (max 95 MB)" }, { status: 413 });
          const body = await request.arrayBuffer();
          if (body.byteLength > 95 * 1024 * 1024) return Response.json({ error: "File too large (max 95 MB)" }, { status: 413 });
          if (!body.byteLength) return Response.json({ error: "Empty file" }, { status: 400 });
          const key = `${kind === "video" ? "videos" : kind === "thumb" ? "thumbs" : kind === "sub" ? "subs" : "images"}/${crypto.randomUUID()}`;
          await b.r2Put(key, body, type);
          return Response.json({ key, url: b.publicUrl(key) });
        } catch (e) {
          console.error("upload failed", e);
          return Response.json({ error: "Upload could not be completed. Please retry." }, { status: 500 });
        }
      },
    },
  },
});
