import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Pause, Play, Download } from "lucide-react";
import { formatDuration, safeLink, type GalleryItem } from "@/lib/content.core";
import type { Post } from "@/lib/api.functions";

/** Renders the media part of a post by its content type. All text is rendered as text (no HTML). */
export function ContentMedia({ p }: { p: Pick<Post, "kind" | "linkUrl" | "mediaUrl" | "mediaName" | "gallery" | "title" | "coverUrl"> }) {
  if (p.kind === "link") return <LinkCard url={p.linkUrl} title={p.title} />;
  if (p.kind === "audio" && p.mediaUrl) return <AudioPlayer src={p.mediaUrl} title={p.mediaName || p.title} />;
  if (p.kind === "document" && p.mediaUrl) return <DocCard url={p.mediaUrl} name={p.mediaName || p.title} />;
  if (p.kind === "images") return <Gallery items={p.gallery} />;
  return null;
}

function LinkCard({ url, title }: { url: string; title: string }) {
  const safe = safeLink(url);
  if (!safe) return null;
  return (
    <div className="mt-6 rounded-xl border border-border p-4">
      <p className="text-xs text-muted-foreground">External link</p>
      <p className="mt-1 break-all text-sm">{new URL(safe).hostname}</p>
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90" aria-label={`Open link: ${title}`}>
        Open Link <ExternalLink size={16} />
      </a>
    </div>
  );
}

export function AudioPlayer({ src, title }: { src: string; title: string }) {
  const a = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [err, setErr] = useState(false);
  useEffect(() => { const el = a.current; if (el && el.readyState >= 1) setDur(el.duration); }, []);
  return (
    <div className="mt-6 rounded-xl border border-border p-4">
      <audio ref={a} src={src} preload="metadata"
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onDurationChange={(e) => setDur(e.currentTarget.duration)} onTimeUpdate={(e) => { setT(e.currentTarget.currentTime); if (!dur) setDur(e.currentTarget.duration); }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setErr(true)} />
      <p className="truncate text-sm font-medium">{title}</p>
      {err ? <p className="mt-2 text-sm text-destructive">This audio couldn't be loaded.</p> : (
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => (playing ? a.current?.pause() : a.current?.play())} aria-label={playing ? "Pause" : "Play"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <input type="range" min={0} max={dur || 0} step={1} value={t} aria-label="Seek"
            onChange={(e) => { if (a.current) a.current.currentTime = Number(e.target.value); }} className="min-w-0 flex-1 accent-foreground" />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(t)} / {formatDuration(dur)}</span>
        </div>
      )}
    </div>
  );
}

function DocCard({ url, name }: { url: string; name: string }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
      <FileText size={28} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">View</a>
      <a href={url} download={name} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"><Download size={14} /> Download</a>
    </div>
  );
}

function Gallery({ items }: { items: GalleryItem[] }) {
  if (!items.length) return null;
  return (
    <div className={`mt-6 grid gap-3 ${items.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {items.map((g) => (
        <figure key={g.url}>
          <img src={g.url} alt={g.alt} loading="lazy" decoding="async" className="w-full rounded-xl object-cover" />
          {g.caption && <figcaption className="mt-1 text-xs text-muted-foreground">{g.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
