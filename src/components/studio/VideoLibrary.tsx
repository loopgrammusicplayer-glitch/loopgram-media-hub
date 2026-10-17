import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { inputCls } from "@/components/Header";
import { VideoThumb } from "@/components/VideoCard";
import { useAuth } from "@/lib/auth";
import { captureThumbnailFromUrl, isDarkThumb, uploadResumable } from "@/lib/uploader";
import { listStudioVideos, saveVideo, deleteVideo, getContent, saveContent, type Video } from "@/lib/api.functions";
import { card, smallBtn, useCategories } from "./StudioTabs";

const save = async (token: string, v: Video, patch: Partial<Video>) => {
  const x = { ...v, ...patch };
  await saveVideo({ data: { token, id: x.id, sk: x.sk, title: x.title, description: x.description ?? "", category: x.category, videoUrl: x.videoUrl, thumbUrl: x.thumbUrl || null, status: x.status } });
};

async function makeThumb(token: () => Promise<string>, v: Video) {
  const f = await captureThumbnailFromUrl(v.videoUrl);
  if (!f) throw new Error("Couldn't read a frame from this video (the file may be missing or in a format this browser can't decode).");
  const { url } = await uploadResumable(token, f, "thumb", () => {}, new AbortController().signal);
  await save(await token(), v, { thumbUrl: url });
}

export function VideoLibrary() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { data: cats } = useCategories();
  const [filter, setFilter] = useState<"all" | "published" | "draft">("all");
  const q = useInfiniteQuery({
    queryKey: ["videos", "studio", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => listStudioVideos({ data: { token: await token(), status: filter, limit: 36, ...(pageParam ? { cursor: pageParam } : {}) } }),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const { isLoading, refetch } = q;
  const data = q.data ? [...new Map(q.data.pages.flatMap((p) => p.videos).map((v) => [v.sk, v])).values()] : undefined;
  const [open, setOpen] = useState<Video | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["videos"] }); await refetch(); };
  // Thumbnails that exist but are black/broken are treated like missing ones and rebuilt from the same video.
  const [dark, setDark] = useState<Set<string> | null>(null);
  const thumbKey = (data ?? []).map((v) => v.thumbUrl ?? "").join("|");
  useEffect(() => {
    if (!data) return;
    let live = true;
    Promise.all(data.map(async (v) => (v.thumbUrl && (await isDarkThumb(v.thumbUrl)) ? v.sk : null)))
      .then((r) => live && setDark(new Set(r.filter((x): x is string => !!x))));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbKey]);
  const missing = (data ?? []).filter((v) => !v.thumbUrl || dark?.has(v.sk));
  const fillAll = async () => {
    let ok = 0;
    const bad: string[] = [];
    for (const [i, v] of missing.entries()) {
      setMsg(`Fixing thumbnails… ${i + 1} of ${missing.length}`);
      try {
        await makeThumb(token, v);
        ok++;
      } catch { bad.push(v.title); }
    }
    setMsg(`Thumbnails fixed: ${ok}${bad.length ? ` · upload a picture by hand for: ${bad.join(", ")}` : ""}.`);
    refresh();
  };
  // Self-heal: once the dark check finishes, missing or black thumbnails are rebuilt automatically.
  const healed = useRef(false);
  useEffect(() => {
    if (healed.current || !dark || !missing.length) return;
    healed.current = true;
    fillAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);
  const shown = (data ?? []).filter((v) => filter === "all" || v.status === filter);
  const catName = (id: string) => cats?.find((c) => c.id === id)?.name ?? id;
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Video library ({shown.length}{q.hasNextPage ? "+" : ""} loaded)</h2>
        {missing.length > 0 && <button onClick={fillAll} className={smallBtn}>Fix {missing.length} dark or missing thumbnails</button>}
      </div>
      <div className="mt-3 flex gap-2">
        {(["all", "published", "draft"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`${smallBtn} ${f === filter ? "bg-primary text-primary-foreground" : ""}`}>{f === "draft" ? "Unpublished" : f[0]!.toUpperCase() + f.slice(1)}</button>
        ))}
      </div>
      {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
      {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map((v) => (
          <button key={v.sk} onClick={() => setOpen(v)} className="text-left" aria-label={`Preview ${v.title}`}>
            <div className="relative">
              <VideoThumb v={v} />
              <span className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${v.status === "published" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                {v.status === "published" ? "Published" : "Unpublished"}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm font-medium">{v.title}</p>
            <p className="text-xs text-muted-foreground">{v.createdAt.slice(0, 10)} · {v.views} views</p>
          </button>
        ))}
      </div>
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className={smallBtn}>{q.isFetchingNextPage ? "Loading…" : "Load more videos"}</button>
        </div>
      )}
      {open && <VideoPreview v={open} catName={catName(open.category)} cats={cats ?? []} onClose={() => setOpen(null)} onChanged={async (nv) => { await refresh(); setOpen(nv); }} />}
    </section>
  );
}

function VideoPreview({ v, catName, cats, onClose, onChanged }: { v: Video; catName: string; cats: { id: string; name: string }[]; onClose: () => void; onChanged: (v: Video | null) => void }) {
  const { token } = useAuth();
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(v.title);
  const [desc, setDesc] = useState(v.description ?? "");
  const [cat, setCat] = useState(v.category);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const fq = useQuery({ queryKey: ["page", "featured"], queryFn: () => getContent({ data: { slug: "featured" } }) });
  const pinned = fq.data?.body.trim() === v.id;
  const setPin = async (id: string) => {
    setBusy(true); setMsg("Working…");
    try {
      await saveContent({ data: { token: await token(), slug: "featured", title: "", body: id } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["page", "featured"] }), qc.invalidateQueries({ queryKey: ["featured"] })]);
      setMsg(id ? "Pinned to the top of the home page." : "Unpinned.");
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const run = async (fn: () => Promise<Video | null>, ok: string) => {
    setBusy(true); setMsg("Working…");
    try { const nv = await fn(); setMsg(ok); onChanged(nv); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/90 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={v.title}>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-t-xl border border-border bg-card p-4 sm:rounded-xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-semibold">{v.title}</h3>
          <button onClick={onClose} className={smallBtn} aria-label="Close">✕</button>
        </div>
        <video key={v.videoUrl} src={v.videoUrl} poster={v.thumbUrl ?? undefined} controls playsInline preload="metadata" className="mt-3 h-auto w-full max-w-full rounded-lg bg-background" />
        <p className="mt-2 text-xs text-muted-foreground">{v.status === "published" ? "Published" : "Unpublished"} · uploaded {v.createdAt.slice(0, 10)} · {catName} · {v.views} views</p>
        {edit ? (
          <div className="mt-3 space-y-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} className={inputCls} aria-label="Title" />
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={5000} rows={3} className={inputCls} aria-label="Description" />
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls} aria-label="Category">
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button disabled={busy || !title.trim()} onClick={() => run(async () => { await save(await token(), v, { title, description: desc, category: cat }); setEdit(false); return { ...v, title, description: desc, category: cat }; }, "Saved.")} className={smallBtn}>Save changes</button>
          </div>
        ) : v.description ? <p className="mt-2 whitespace-pre-wrap text-sm">{v.description}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {v.status === "published" && <a href={`/watch/${v.id}`} target="_blank" rel="noreferrer" className={smallBtn}>View on site</a>}
          {v.status === "published" && <button disabled={busy} onClick={() => setPin(pinned ? "" : v.id)} className={smallBtn}>{pinned ? "★ Featured · Unpin" : "Pin as featured"}</button>}
          <button onClick={() => setEdit((x) => !x)} className={smallBtn}>{edit ? "Cancel edit" : "Edit"}</button>
          <button disabled={busy} onClick={() => run(async () => { const status = v.status === "published" ? "draft" : "published"; await save(await token(), v, { status }); return { ...v, status }; }, "Updated.")} className={smallBtn}>
            {v.status === "published" ? "Unpublish" : "Publish"}
          </button>
          <button disabled={busy} onClick={() => run(async () => { await makeThumb(token, v); return null; }, "Thumbnail updated.")} className={smallBtn}>{v.thumbUrl ? "New thumbnail from video" : "Make thumbnail"}</button>
          <button disabled={busy} onClick={() => { if (confirm(`Permanently delete "${v.title}"? This can't be undone.`)) run(async () => { await deleteVideo({ data: { token: await token(), sk: v.sk } }); onClose(); return null; }, "Deleted."); }} className={`${smallBtn} text-destructive`}>Delete</button>
        </div>
        {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
      </div>
    </div>
  );
}
