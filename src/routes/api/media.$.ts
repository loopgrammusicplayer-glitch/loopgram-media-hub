import { createFileRoute } from "@tanstack/react-router";

// Same-origin read-only proxy for already-public video files, so the Studio can grab
// a frame for a thumbnail (the public R2 URL sends no CORS headers). Supports Range.
const KEY_RE = /^(videos|thumbs)\/[\w-]+$/;

export const Route = createFileRoute("/api/media/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const key = (params as { _splat?: string })._splat ?? "";
        if (!KEY_RE.test(key)) return new Response("Not found", { status: 404 });
        const b = await import("@/lib/backend.server");
        const r = await b.r2Get(key, request.headers.get("range"));
        if (!r.ok && r.status !== 206) return new Response("Not found", { status: r.status === 404 ? 404 : 502 });
        const h = new Headers();
        for (const n of ["content-type", "content-length", "content-range", "accept-ranges", "etag"]) {
          const v = r.headers.get(n);
          if (v) h.set(n, v);
        }
        // Longer edge/browser caching; not "immutable" because the studio can rebuild thumbnails.
        h.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
        h.set("x-content-type-options", "nosniff");
        return new Response(r.body, { status: r.status, headers: h });
      },
    },
  },
});
