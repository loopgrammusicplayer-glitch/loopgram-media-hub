import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { searchContent, listCategories } from "@/lib/api.functions";
import { VideoCard } from "@/components/VideoCard";

type SearchParams = { q: string; type: string; offset: number };

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    q: typeof s["q"] === "string" ? (s["q"] as string).slice(0, 100) : "",
    type: typeof s["type"] === "string" ? (s["type"] as string) : "all",
    offset: typeof s["offset"] === "number" && Number.isFinite(s["offset"]) ? Math.max(0, Math.floor(s["offset"] as number)) : 0,
  }),
  head: () => ({
    meta: [
      { title: "Search — Loopgram Channel" },
      { name: "description", content: "Search videos and posts on Loopgram Channel." },
      { property: "og:title", content: "Search — Loopgram Channel" },
      { property: "og:description", content: "Search videos and posts on Loopgram Channel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

const TABS = [
  { id: "all", label: "All" },
  { id: "videos", label: "Videos" },
  { id: "posts", label: "Posts" },
];

function SearchPage() {
  const { q, type, offset } = Route.useSearch();
  const navigate = Route.useNavigate();
  const safeType = TABS.some((t) => t.id === type) ? type : "all";
  const safeOffset = Math.max(0, offset);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["search", q, safeOffset],
    queryFn: () => searchContent({ data: { q, offset: safeOffset } }),
    enabled: !!q.trim(),
  });
  const { data: cats } = useQuery({ queryKey: ["cats"], queryFn: () => listCategories() });
  const catName = (id: string) => cats?.find((c) => c.id === id)?.name ?? id;

  const videos = safeType === "posts" ? [] : (data?.videos ?? []);
  const posts = safeType === "videos" ? [] : (data?.posts ?? []);
  const set = (patch: Partial<{ q: string; type: string; offset: number }>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }) });

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-bold">
        {q.trim() ? <>Results for “{q.trim()}”</> : "Search"}
      </h1>

      <div className="mt-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => set({ type: t.id, offset: 0 })}
            className={`rounded-full px-4 py-1.5 text-sm ${safeType === t.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!q.trim() && <p className="mt-8 text-sm text-muted-foreground">Type in the search bar above to find videos and posts.</p>}
      {isLoading && q.trim() && <p className="mt-8 text-sm text-muted-foreground">Searching…</p>}
      {isError && <p className="mt-8 text-sm text-muted-foreground">Search is temporarily unavailable. Please try again.</p>}
      {data && !videos.length && !posts.length && (
        <p className="mt-8 text-sm text-muted-foreground">No results found. Try different keywords.</p>
      )}

      {!!videos.length && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Videos</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((v) => <VideoCard key={v.id} v={v} categoryName={catName(v.category)} />)}
          </div>
        </section>
      )}

      {!!posts.length && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Posts</h2>
          <div className="space-y-3">
            {posts.map((p) => (
              <Link key={p.id} to="/posts/$slug" params={{ slug: p.slug }} className="flex gap-4 rounded-xl border border-border p-3 hover:bg-accent">
                {p.coverUrl ? <img src={p.coverUrl} alt="" className="h-20 w-32 rounded-lg object-cover" /> : <div className="flex h-20 w-32 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">Post</div>}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.title}</span>
                  <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.excerpt}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data && (safeOffset > 0 || data.next !== null) && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            disabled={safeOffset === 0}
            onClick={() => set({ offset: Math.max(0, safeOffset - 12) })}
            className="rounded-full border border-border px-4 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
          >
            Previous
          </button>
          <button
            disabled={data.next === null}
            onClick={() => set({ offset: data.next ?? safeOffset })}
            className="rounded-full border border-border px-4 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </main>
  );
}
