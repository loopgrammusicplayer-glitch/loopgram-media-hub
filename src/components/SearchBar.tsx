import { VideoThumb } from "./VideoCard";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { searchContent, type SearchResult } from "@/lib/api.functions";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { latestRequest, PERFORMANCE } from "@/lib/performance";
import { Button } from "@/components/ui/button";

const empty: SearchResult = { videos: [], posts: [], next: null };

export function SearchBar() {
  const [open, setOpen] = useState(false); // mobile field
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult>(empty);
  const [loading, setLoading] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const requests = useRef(latestRequest());
  const queryClient = useQueryClient();
  const search = useServerFn(searchContent);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requests.current.invalidate();
    const query = q.trim();
    setRes(empty);
    setLoading(!!query);
    if (!query) return;
    const t = setTimeout(async () => {
      try {
        const r = await queryClient.fetchQuery({ queryKey: ["search", query.toLowerCase(), 0], queryFn: () => search({ data: { q: query } }), staleTime: 10_000 });
        if (requests.current.isCurrent(id)) setRes({ ...r, videos: r.videos.slice(0, 8), posts: r.posts.slice(0, Math.max(0, 8 - r.videos.length)) });
      } catch {
        if (requests.current.isCurrent(id)) setRes(empty);
      } finally {
        if (requests.current.isCurrent(id)) setLoading(false);
      }
    }, PERFORMANCE.searchDebounceMs);
    return () => { clearTimeout(t); requests.current.invalidate(); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setShowDrop(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (query: string) => {
    if (!query.trim()) return;
    setShowDrop(false);
    setOpen(false);
    navigate({ to: "/search", search: { q: query.trim(), type: "all", offset: 0 } });
  };

  const suggestions = [
    ...res.videos.map((v) => ({ kind: "video" as const, id: v.id, title: v.title, meta: `${v.category} • ${v.views} views`, thumb: v.thumbUrl, videoUrl: v.videoUrl })),
    ...res.posts.map((p) => ({ kind: "post" as const, id: p.slug, title: p.title, meta: p.category || "Post", thumb: p.coverUrl })),
  ].slice(0, 8);

  const field = (
    <div ref={boxRef} className="relative w-full">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); go(q); }}
      >
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setShowDrop(true); }}
          onFocus={() => setShowDrop(true)}
          placeholder="Search Loopgram Channel"
          aria-label="Search"
          className="w-full rounded-full border border-input bg-card px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {q && (
          <Button variant="ghost" size="icon" type="button" aria-label="Clear search" onClick={() => { setQ(""); setRes(empty); }}
            className="shrink-0 rounded-full p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </Button>
        )}
      </form>
      {showDrop && q.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          {loading && <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>}
          {!loading && !suggestions.length && <p className="px-4 py-3 text-sm text-muted-foreground">No results for “{q.trim()}”</p>}
          {!loading && suggestions.map((s) =>
            s.kind === "video" ? (
              <Link key={`v-${s.id}`} to="/watch/$id" params={{ id: s.id }} onClick={() => { setShowDrop(false); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 hover:bg-accent">
                <VideoThumb v={{ thumbUrl: s.thumb ?? null, videoUrl: (s as any).videoUrl ?? "" }} className="h-9 w-16 shrink-0 rounded" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{s.meta}</span>
                </span>
              </Link>
            ) : (
              <Link key={`p-${s.id}`} to="/posts/$slug" params={{ slug: s.id }} onClick={() => { setShowDrop(false); setOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 hover:bg-accent">
                {s.thumb ? <img src={s.thumb} alt="" className="h-9 w-16 rounded object-cover" /> : <div className="flex h-9 w-16 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">Post</div>}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{s.meta}</span>
                </span>
              </Link>
            ),
          )}
          {!loading && (
            <Button variant="ghost" onClick={() => go(q)} className="block w-full border-t border-border px-4 py-2.5 text-left text-sm font-medium hover:bg-accent">
              See all results for “{q.trim()}”
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop bar */}
      <div className="hidden w-full max-w-md md:block">{field}</div>
      {/* Mobile icon + expandable field */}
      <Button variant="ghost" size="icon" aria-label="Open search" onClick={() => setOpen((o) => !o)} className="rounded-full p-2 hover:bg-accent md:hidden">
        <Search className="h-5 w-5" />
      </Button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 border-b border-border bg-background p-3 md:hidden">{field}</div>
      )}
    </>
  );
}
