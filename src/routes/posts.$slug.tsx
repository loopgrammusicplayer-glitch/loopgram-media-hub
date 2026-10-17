import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PostBody } from "@/components/PostBody";
import { ContentMedia } from "@/components/ContentView";
import { getPost } from "@/lib/api.functions";
import { useState } from "react";
import { ArrowLeft, Share2 } from "lucide-react";
import logoSrc from "@/assets/logo.png";
import { KIND_LABEL, formatPostDate } from "@/lib/content.core";
import { postThumbnail } from "@/lib/media.core";

export const Route = createFileRoute("/posts/$slug")({
  loader: async ({ params }) => {
    const p = await getPost({ data: { slug: params.slug } });
    if (!p) throw notFound();
    return p;
  },
  head: ({ loaderData: p }) => {
    if (!p) return { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] };
    const t = p.seoTitle || `${p.title} — Loopgram Channel`;
    const d = p.seoDescription || p.excerpt || p.body.slice(0, 150);
    const image = postThumbnail(p);
    return {
      meta: [
        { title: t }, { name: "description", content: d },
        { property: "og:title", content: t }, { property: "og:description", content: d }, { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(image?.startsWith("https://") ? [{ property: "og:image", content: image }, { name: "twitter:image", content: image }] : []),
      ],
    };
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      Post not found. <Link to="/posts" className="ml-1 underline">All posts</Link>
    </div>
  ),
  component: PostPage,
});

function PostPage() {
  const p = Route.useLoaderData();
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.title, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch { /* user cancelled */ }
  };
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <article className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 sm:px-6">
        <Link to="/posts" className="flex h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} aria-hidden /> Back to posts
        </Link>
        {postThumbnail(p) && (p.kind !== "images" || p.coverUrl) && <img src={postThumbnail(p) ?? ""} alt={p.title} className="aspect-video w-full rounded-xl object-cover" />}
        <h1 className="mt-4 text-2xl font-bold leading-tight sm:text-3xl">{p.title}</h1>
        <div className="mt-3 flex items-center gap-3">
          <img src={logoSrc} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">Loopgram Channel</p>
            <p className="truncate text-xs text-muted-foreground">{KIND_LABEL[p.kind]} · {formatPostDate(p.createdAt)}</p>
          </div>
          <button onClick={share} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-semibold hover:bg-accent">
            <Share2 size={16} aria-hidden /> {copied ? "Copied" : "Share"}
          </button>
        </div>
        {p.excerpt && <p className="mt-4 text-muted-foreground">{p.excerpt}</p>}
        <ContentMedia p={p} />
        <PostBody body={p.body} />
        {p.tags.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">{p.tags.map((t) => <span key={t} className="rounded-full bg-secondary px-3 py-1 text-xs">#{t}</span>)}</div>
        )}
      </article>
      <Footer />
    </div>
  );
}
