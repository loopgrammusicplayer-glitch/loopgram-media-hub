import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useState } from "react";
import { z } from "zod";
import { listCategories, listPosts } from "@/lib/api.functions";
import { CONTENT_KINDS, KIND_LABEL, formatPostDate, type ContentKind } from "@/lib/content.core";
import { FileText, Headphones, Images, Link2, Newspaper, Play, type LucideIcon } from "lucide-react";
import logoSrc from "@/assets/logo.png";
import { postThumbnail } from "@/lib/media.core";

const KIND_ICON: Record<ContentKind, LucideIcon> = { article: Newspaper, link: Link2, audio: Headphones, images: Images, document: FileText };

export const Route = createFileRoute("/posts/")({
  validateSearch: z.object({ c: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Posts — Loopgram Channel" },
      { name: "description", content: "Read the latest stories and updates from Loopgram Channel." },
      { property: "og:title", content: "Posts — Loopgram Channel" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:description", content: "Read the latest stories and updates from Loopgram Channel." },
    ],
  }),
  component: Posts,
});

function Posts() {
  const { c = "all" } = Route.useSearch();
  const [kind, setKind] = useState<ContentKind | "">("");
  const [limit, setLimit] = useState(24);
  const { data, isLoading } = useQuery({ queryKey: ["posts", c, kind, limit], queryFn: () => listPosts({ data: { limit: limit + 1, ...(kind ? { kind } : {}), ...(c !== "all" ? { category: c } : {}) } }), staleTime: 60_000, placeholderData: (x) => x });
  const more = (data?.length ?? 0) > limit;
  const { data: cats = [] } = useQuery({ queryKey: ["cats"], queryFn: () => listCategories(), staleTime: 300_000 });
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <nav aria-label="Categories" className="sticky top-14 z-10 flex gap-2 overflow-x-auto border-b border-border bg-background px-4 py-3 [scrollbar-width:none]">
        {[{ id: "all", name: "All" }, ...cats].map((cat) => (
          <Link key={cat.id} to="/posts" search={{ c: cat.id }} onClick={() => setLimit(24)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${cat.id === c ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}>
            {cat.name}
          </Link>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Posts</h1>
          <select value={kind} onChange={(e) => { setKind(e.target.value as ContentKind | ""); setLimit(24); }} aria-label="Filter by type"
            className="h-9 rounded-full border border-border bg-secondary px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-ring">
            <option value="">All types</option>
            {CONTENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        {isLoading && <p className="mt-6 text-muted-foreground">Loading…</p>}
        {data && !data.length && <p className="mt-6 text-muted-foreground">{(() => { const cn = c !== "all" ? (cats.find((x) => x.id === c)?.name ?? c).toLowerCase() + " " : ""; const kn = kind ? KIND_LABEL[kind].toLowerCase() + " " : ""; return cn || kn ? `No ${cn}${kn}posts found.` : "No posts yet."; })()}</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.slice(0, limit).map((p) => {
            const img = postThumbnail(p);
            const I = KIND_ICON[p.kind];
            const catName = cats.find((x) => x.id === p.category)?.name;
            return (
              <Link key={p.id} to="/posts/$slug" params={{ slug: p.slug }} className="group flex flex-col rounded-xl border border-border bg-card p-3 hover:bg-accent/40">
                <div className="flex items-center gap-2">
                  <img src={logoSrc} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-sm font-semibold">Loopgram Channel</p>
                    <p className="truncate text-xs text-muted-foreground">{formatPostDate(p.createdAt)}</p>
                  </div>
                  {p.featured && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">Featured</span>}
                </div>
                <h2 className="mt-3 line-clamp-2 font-semibold group-hover:underline">{p.title}</h2>
                {p.excerpt && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.excerpt}</p>}
                {img ? (
                  <div className="relative mt-3 aspect-video overflow-hidden rounded-lg bg-secondary">
                    <img src={img} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-3 rounded-lg bg-secondary p-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      {p.kind === "audio" ? <Play size={16} aria-hidden /> : <I size={18} aria-hidden />}
                    </span>
                    <span className="text-sm font-medium">{p.kind === "audio" ? "Listen now" : KIND_LABEL[p.kind]}</span>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">{KIND_LABEL[p.kind]}</span>
                  {catName && <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">{catName}</span>}
                </div>
              </Link>
            );
          })}
        </div>
        {more && <button onClick={() => setLimit((l) => l + 24)} className="mx-auto mt-8 block rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Load more</button>}
      </main>
      <Footer />
    </div>
  );
}
