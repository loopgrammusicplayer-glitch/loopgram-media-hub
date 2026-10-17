import { createFileRoute, Link } from "@tanstack/react-router";
import { infiniteQueryOptions, useSuspenseInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { VideoCard } from "@/components/VideoCard";
import { getContent, getFeaturedVideo, listCategories, listVideos } from "@/lib/api.functions";

const videosQuery = (c: string) =>
  infiniteQueryOptions({
    queryKey: ["videos", c],
    queryFn: ({ pageParam }) => listVideos({ data: { category: c, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.next ?? undefined,
    staleTime: 30_000,
  });

export const Route = createFileRoute("/")({
  validateSearch: z.object({ c: z.string().optional() }),
  loaderDeps: ({ search: { c } }) => ({ c: c ?? "all" }),
  // Prime the first page on the server so the feed renders with the HTML instead of after a client round-trip.
  loader: async ({ context, deps }) => {
    const qc = context.queryClient;
    // Fetch feed, categories and banner together so the browser needs no follow-up requests.
    await Promise.all([
      qc.ensureInfiniteQueryData(videosQuery(deps.c)),
      qc.ensureQueryData({ queryKey: ["featured"], queryFn: () => getFeaturedVideo(), staleTime: 60_000 }).catch(() => null),
      qc.ensureQueryData({ queryKey: ["cats"], queryFn: () => listCategories(), staleTime: 300_000 }).catch(() => null),
      qc.ensureQueryData({ queryKey: ["page", "settings"], queryFn: () => getContent({ data: { slug: "settings" } }), staleTime: 300_000 }).catch(() => null),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Loopgram Channel — Watch videos" },
      { name: "description", content: "Watch music, gaming, news, sports and more on Loopgram Channel." },
      { property: "og:title", content: "Loopgram Channel — Watch videos" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:description", content: "Watch music, gaming, news, sports and more on Loopgram Channel." },
    ],
  }),
  errorComponent: ({ error }) => (
    <div role="alert" className="p-8 text-center text-sm text-muted-foreground">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ),
  component: Home,
});

function Home() {
  const { c = "all" } = Route.useSearch();
  const { data: cats = [] } = useQuery({ queryKey: ["cats"], queryFn: () => listCategories(), staleTime: 300_000 });
  const { data: site } = useQuery({ queryKey: ["page", "settings"], queryFn: () => getContent({ data: { slug: "settings" } }), staleTime: 300_000 });
  const { data: featured } = useQuery({ queryKey: ["featured"], queryFn: () => getFeaturedVideo(), staleTime: 60_000 });
  const q = useSuspenseInfiniteQuery(videosQuery(c));
  const seen = new Set<string>();
  const videos = (q.data?.pages.flatMap((p) => p.videos) ?? []).filter((v) => !seen.has(v.id) && !!seen.add(v.id));
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && q.hasNextPage && !q.isFetchingNextPage && !q.isFetchNextPageError) q.fetchNextPage();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.isFetchNextPageError, q.fetchNextPage]);
  const name = (id: string) => cats.find((x) => x.id === id)?.name ?? id;
  const chips = [{ id: "all", name: "All" }, ...cats];
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      {(site?.title || site?.body) && (
        <div className="border-b border-border px-4 py-2 text-center text-sm">
          {site.title && <b>{site.title}</b>} {site.body && <span className="text-muted-foreground">{site.body}</span>}
        </div>
      )}
      <nav className="sticky top-14 z-10 flex gap-2 overflow-x-auto border-b border-border bg-background px-4 py-3 [scrollbar-width:none]">
        {chips.map((cat) => (
          <Link key={cat.id} to="/" search={{ c: cat.id }} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${cat.id === c ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}>
            {cat.name}
          </Link>
        ))}
      </nav>
      <main className="mx-auto grid w-full max-w-3xl flex-1 grid-cols-1 content-start gap-y-8 p-4">
        {featured && c === "all" && (
          <section aria-label="Featured video" className="rounded-2xl border border-primary/40 bg-card p-3">
            <span className="mb-2 inline-block rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-foreground">★ Featured</span>
            <VideoCard v={featured} categoryName={name(featured.category)} />
          </section>
        )}
        {q.isLoading && Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-video animate-pulse rounded-xl bg-secondary" />)}
        {videos.filter((v) => !(featured && c === "all" && v.id === featured.id)).map((v) => <VideoCard key={v.id} v={v} categoryName={name(v.category)} />)}
        {q.data && !videos.length && (
          <p className="col-span-full py-20 text-center text-muted-foreground">{q.data.pages[0]?.error ?? "No videos in this category yet."}</p>
        )}
        <div ref={sentinel} className="col-span-full flex justify-center py-4 text-sm text-muted-foreground">
          {q.isFetchingNextPage && "Loading more…"}
          {q.isFetchNextPageError && (
            <button onClick={() => q.fetchNextPage()} className="rounded-full border border-border px-5 py-2 hover:bg-accent">Couldn't load more — Retry</button>
          )}
          {q.data && videos.length > 0 && !q.hasNextPage && "You've reached the end."}
        </div>
      </main>
      <Footer />
    </div>
  );
}
