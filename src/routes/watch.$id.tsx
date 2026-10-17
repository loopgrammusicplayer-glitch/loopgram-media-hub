import { createFileRoute, Link } from "@tanstack/react-router";
import { copyText, shareLink } from "@/lib/share";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { VideoThumb, UPLOADER, formatViews, formatDate } from "@/components/VideoCard";
import { countView, getVideo, listCategories, listRelated } from "@/lib/api.functions";
import { LikeButton } from "@/components/LikeButton";
import { YoutubePlayer } from "@/components/YoutubePlayer";
import { CustomVideoPlayer } from "@/components/CustomVideoPlayer";
import { CommentsPreview } from "@/components/Comments";
import { youtubeId } from "@/lib/content.core";
import { ArrowLeft, Share2, MoreHorizontal, Link2, ExternalLink } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const videoQuery = (id: string) => ({
  queryKey: ["video", id],
  queryFn: () => getVideo({ data: { id } }),
  staleTime: 30_000,
});

export const Route = createFileRoute("/watch/$id")({
  // Prime the video on the server so direct links and refreshes render instantly.
  loader: async ({ context, params }) => {
    const qc = context.queryClient;
    // Video, category chips and suggestions load together in one go.
    await Promise.all([
      qc.ensureQueryData(videoQuery(params.id)),
      qc.ensureQueryData({ queryKey: ["cats"], queryFn: () => listCategories(), staleTime: 300_000 }).catch(() => null),
      qc.ensureQueryData({ queryKey: ["related", params.id], queryFn: () => listRelated({ data: { id: params.id } }), staleTime: 60_000 }).catch(() => null),
    ]);
  },
  errorComponent: ({ error }) => (
    <div role="alert" className="p-8 text-center text-sm text-muted-foreground">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ),
  head: () => ({
    meta: [
      { title: "Watch — Loopgram Channel" },
      { name: "description", content: "Watch this video on Loopgram Channel." },
      { property: "og:title", content: "Watch — Loopgram Channel" },
      { property: "og:description", content: "Watch this video on Loopgram Channel." },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Watch,
});

function Watch() {
  const { id } = Route.useParams();
  const { data: v } = useSuspenseQuery(videoQuery(id));
  const { data: cats = [] } = useQuery({ queryKey: ["cats"], queryFn: () => listCategories(), staleTime: 300_000 });
  const [views, setViews] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState<string | null>(null);
  const error = failed === id;
  // A view is reported once per page visit, only after real playback (see VIEW_POLICY in views.core.ts).
  const sent = useRef<string | null>(null);
  const eventId = useRef("");
  useEffect(() => { eventId.current = crypto.randomUUID(); sent.current = null; setViews(null); }, [id]);
  const [shared, setShared] = useState<string | null>(null);
  const [chip, setChip] = useState("all");
  useEffect(() => setChip("all"), [id]);
  const flash = (msg: string) => { setShared(msg); setTimeout(() => setShared(null), 2500); };
  const share = async () => {
    const url = `${location.origin}/watch/${id}`;
    const r = await shareLink(v?.title ?? "Loopgram", url);
    if (r === "copied") flash("Link copied");
    else if (r === "failed") window.prompt("Copy this link:", url);
  };
  const onTime = (el: { currentTime: number }) => {
    if (sent.current === id || el.currentTime < 0.0002) return;
    sent.current = id;
    let viewerId = localStorage.getItem("lg_viewer");
    if (!viewerId) { viewerId = crypto.randomUUID(); localStorage.setItem("lg_viewer", viewerId); }
    const send = (tries: number) =>
      countView({ data: { id, eventId: eventId.current, viewerId: viewerId! } })
        .then((r) => {
          if (r.status === "accepted") setViews((v?.views ?? 0) + 1);
          else if (r.status === "retry" && tries < 3) setTimeout(() => send(tries + 1), 5000 * (tries + 1));
        })
        .catch(() => { if (tries < 3) setTimeout(() => send(tries + 1), 5000 * (tries + 1)); });
    send(0);
  };
  const { data: related = [], isLoading: relLoading } = useQuery({ queryKey: ["related", id], queryFn: () => listRelated({ data: { id } }), staleTime: 60_000, enabled: !!v });
  const ytId = v ? youtubeId(v.videoUrl) : null;
  const catName = (c: string) => cats.find((x) => x.id === c)?.name ?? c;
  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto max-w-7xl px-4 py-2"><button onClick={() => (history.length > 1 ? history.back() : (location.href = "/"))} className="flex h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} aria-hidden /> Back</button></div>
      <main className="mx-auto grid max-w-7xl gap-6 p-0 sm:p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          {!v ? (
            <p className="py-20 text-center text-muted-foreground">Video not found. <Link to="/" className="underline">Go home</Link></p>
          ) : (
            <>
              {ytId ? <YoutubePlayer key={ytId} ytId={ytId} onPlay={() => onTime({ currentTime: 1 })} /> : (
                <CustomVideoPlayer key={v.videoUrl} src={v.videoUrl} poster={v.thumbUrl ?? undefined} onTime={onTime} subtitles={v.subtitles} />
              )}
              <div className={`px-4 sm:px-0 `}>
                <h1 className="mt-3 break-words text-xl font-bold">{v.title}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{formatViews(views ?? v.views)} · {formatDate(v.createdAt)}</p>
                <div className="mt-3 flex items-center gap-3">
                  <img src={UPLOADER.avatar} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{v.channel || UPLOADER.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{catName(v.category)}</p>
                  </div>
                  {ytId && <a href={`https://www.youtube.com/watch?v=${ytId}`} target="_blank" rel="noreferrer" className="inline-flex h-9 shrink-0 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">Subscribe</a>}
                </div>
                <div className="-mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
                  <LikeButton key={id} id={id} sk={v.sk} />
                  <button onClick={share} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-semibold hover:bg-accent"><Share2 size={16} aria-hidden /> Share</button>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary hover:bg-accent" aria-label="More actions"><MoreHorizontal size={16} aria-hidden /></DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={async () => { const url = `${location.origin}/watch/${id}`; if (await copyText(url)) flash("Link copied"); else window.prompt("Copy this link:", url); }}>
                        <Link2 size={14} aria-hidden /> Copy link
                      </DropdownMenuItem>
                      {ytId && (
                        <DropdownMenuItem onClick={() => window.open(`https://www.youtube.com/watch?v=${ytId}`, "_blank", "noopener")}>
                          <ExternalLink size={14} aria-hidden /> Open on YouTube
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {shared && <span className="shrink-0 text-xs text-muted-foreground">{shared}</span>}
                </div>
                {v.description && (
                  <div className="mt-3 rounded-xl bg-secondary p-3 text-sm">
                    <p className="whitespace-pre-wrap break-words">{v.description}</p>
                  </div>
                )}
                <CommentsPreview vid={id} />
              </div>
            </>
          )}
        </section>
        {v && (() => {
          const channel = v.channel || UPLOADER.name;
          const chips = [
            { id: "all", label: "All" },
            { id: "channel", label: `From ${channel}` },
            ...(v.category ? [{ id: "cat", label: catName(v.category) }] : []),
            { id: "recent", label: "Recently uploaded" },
          ];
          const shown = chip === "channel" ? related.filter((r) => (r.channel || UPLOADER.name) === channel)
            : chip === "cat" ? related.filter((r) => r.category === v.category)
            : chip === "recent" ? [...related].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
            : related;
          return (
          <aside className="px-4 pb-8 sm:px-0">
            <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
              {chips.map((c) => (
                <button key={c.id} onClick={() => setChip(c.id)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${chip === c.id ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}>{c.label}</button>
              ))}
            </div>
            {relLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="mb-3 h-20 animate-pulse rounded-lg bg-secondary" />)}
            {!relLoading && !shown.length && <p className="text-sm text-muted-foreground">No videos here yet.</p>}
            <div className="space-y-3">
              {shown.map((r) => (
                <Link key={r.id} to="/watch/$id" params={{ id: r.id }} className="flex gap-3 rounded-lg hover:bg-accent">
                  <VideoThumb v={r} className="w-40 shrink-0 rounded-lg" />
                  <span className="min-w-0 py-1">
                    <span className="line-clamp-2 text-sm font-semibold">{r.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{r.channel || UPLOADER.name}</span>
                    <span className="block text-xs text-muted-foreground">{formatViews(r.views)} · {formatDate(r.createdAt)}</span>
                  </span>
                </Link>
              ))}
            </div>
          </aside>
          );
        })()}
      </main>
    </div>
  );
}
