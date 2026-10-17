import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Play } from "lucide-react";
import type { Video } from "@/lib/api.functions";
import logo from "@/assets/logo.png";

/** Every video on Loopgram is published by the channel owner. */
export const UPLOADER = { name: "Loopgram Channel", avatar: logo };

export function formatViews(n: number) {
  const f = (x: number, s: string) => `${(Math.floor(x * 10) / 10).toString()}${s}`;
  const t = n >= 1e9 ? f(n / 1e9, "B") : n >= 1e6 ? f(n / 1e6, "M") : n >= 1e3 ? f(n / 1e3, "K") : String(n);
  return `${t} ${n === 1 ? "view" : "views"}`;
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Thumbnail image only — never a video element, so lists never create extra players or autoplay. */
export function VideoThumb({ v, className = "" }: { v: Pick<Video, "thumbUrl" | "videoUrl">; className?: string }) {
  const [bad, setBad] = useState<string | null>(null);
  const thumb = bad === v.thumbUrl ? null : v.thumbUrl;
  return (
    <div className={`relative aspect-video overflow-hidden rounded-xl bg-secondary ${className}`}>
      {thumb ? (
        <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setBad(thumb)} />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground"><Play size={28} aria-hidden /></span>
      )}
    </div>
  );
}

export function VideoCard({ v, categoryName }: { v: Video; categoryName: string }) {
  return (
    <Link to="/watch/$id" params={{ id: v.id }} className="group block">
      <VideoThumb v={v} />
      <div className="mt-3 flex gap-3">
        <img src={UPLOADER.avatar} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full object-cover" />
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold">{v.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{v.channel || UPLOADER.name}{categoryName ? ` · ${categoryName}` : ""}</p>
          <p className="text-xs text-muted-foreground">{formatViews(v.views)} · {formatDate(v.createdAt)}</p>
        </div>
      </div>
    </Link>
  );
}
