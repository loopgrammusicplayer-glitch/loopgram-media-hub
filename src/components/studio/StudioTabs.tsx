import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Play, Plus } from "lucide-react";
import { VideoThumb } from "@/components/VideoCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { btnCls, inputCls } from "@/components/Header";
import { PostBody } from "@/components/PostBody";
import { ContentMedia } from "@/components/ContentView";
import { CONTENT_KINDS, KIND_LABEL, safeLink, type ContentKind } from "@/lib/content.core";
import { useAuth } from "@/lib/auth";
import { postThumbnail } from "@/lib/media.core";
import { uploadResumable, cancelUpload, captureThumbnail, MAX_VIDEO_BYTES } from "@/lib/uploader";
import { trackMeta } from "@/lib/subtitles.core";
import {
  listCategories, saveCategory, deleteCategory, listAllPosts, savePost, deletePost,
  listAllVideos, saveVideo, addYoutubeVideo, listInquiries, listMedia, type Post, type Category,
} from "@/lib/api.functions";

export const card = "rounded-xl border border-border bg-card p-5";
export const smallBtn = "rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50";
const fmt = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: () => listCategories(), staleTime: 0 });
}

// ---------------- Dashboard (all live data, auto-refreshing) ----------------
export function DashboardTab() {
  const { token } = useAuth();
  const { data, dataUpdatedAt, isFetching, refetch, error } = useQuery({
    queryKey: ["dashboard"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const t = await token();
      const [v, p, q, m, c] = await Promise.all([
        listAllVideos({ data: { token: t } }),
        listAllPosts({ data: { token: t } }),
        listInquiries({ data: { token: t } }),
        listMedia({ data: { token: t } }).catch(() => []),
        listCategories().catch(() => []),
      ]);
      // Some list calls return wrapped objects or nothing on failure; always hand the view real arrays.
      const arr = <T,>(x: unknown, key?: string): T[] => (Array.isArray(x) ? x : key && Array.isArray((x as any)?.[key]) ? (x as any)[key] : []) as T[];
      return {
        v: arr<(typeof v extends (infer U)[] ? U : any)>(v, "videos"),
        p: arr<(typeof p extends (infer U)[] ? U : any)>(p, "posts"),
        q: arr<Record<string, string>>(q, "items"),
        m: arr<(typeof m extends (infer U)[] ? U : any)>(m, "items"),
        c: arr<(typeof c extends (infer U)[] ? U : any)>(c, "categories"),
      };
    },
  });
  const [showAll, setShowAll] = useState(false);
  if (error) return <section className={card}><p role="alert" className="text-sm text-destructive">{(error as Error).message}</p></section>;
  if (!data) return <section className={card}><h2 className="font-semibold">Dashboard</h2><p className="mt-3 text-sm text-muted-foreground">Loading live data…</p></section>;
  const { v, p, q, m, c } = data;
  const pubV = v.filter((x) => x.status === "published").length;
  const pubP = p.filter((x) => x.status === "published").length;
  const bytes = m.reduce((a, x) => a + (x.size || 0), 0);
  const stats: [string, string | number, string?][] = [
    ["Total views", v.reduce((a, x) => a + (x.views || 0), 0)],
    ["Videos", v.length, `${pubV} published · ${v.length - pubV} unpublished`],
    ["Posts", p.length, `${pubP} published · ${p.length - pubP} drafts`],
    ["Inquiries", q.length],
    ["Media files", m.length, `${m.filter((x) => !x.inUse).length} unused`],
    ["Storage used", fmt(bytes)],
    ["Categories", c.length],
  ];
  const catName = (id: string) => c.find((x) => x.id === id)?.name ?? id;
  const byViews = [...v].sort((a, b) => b.views - a.views);
  const videos = showAll ? byViews : byViews.slice(0, 12);
  const recentPosts = [...p].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const recentQ = [...q].sort((a, b) => (b["createdAt"] ?? "").localeCompare(a["createdAt"] ?? "")).slice(0, 8);
  const byCat = c.map((x) => ({ name: x.name, n: v.filter((y) => y.category === x.id).length })).filter((x) => x.n);
  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Live dashboard</h2>
          <button onClick={() => refetch()} className={smallBtn}>{isFetching ? "Updating…" : "Refresh"}</button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Updates every 15 seconds · last {new Date(dataUpdatedAt).toLocaleTimeString()}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map(([k, n, sub]) => (
            <div key={k} className="rounded-lg border border-border p-3">
              <div className="text-2xl font-bold">{typeof n === "number" ? n.toLocaleString() : n}</div>
              <div className="text-xs text-muted-foreground">{k}</div>
              {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className={card}>
        <h3 className="font-semibold">All videos by views ({v.length})</h3>
        <ul className="mt-3 divide-y divide-border">
          {videos.map((x, i) => (
            <li key={x.sk} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-6 text-right text-xs text-muted-foreground">{i + 1}</span>
              <Link to="/watch/$id" params={{ id: x.id }} className="w-24 shrink-0"><VideoThumb v={x} /></Link>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{x.title}</p>
                <p className="text-xs text-muted-foreground">{x.views.toLocaleString()} views · {catName(x.category)} · {x.createdAt.slice(0, 10)}</p>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${x.status === "published" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{x.status === "published" ? "Live" : "Hidden"}</span>
            </li>
          ))}
        </ul>
        {v.length > 12 && <button onClick={() => setShowAll((s) => !s)} className={`${smallBtn} mt-3`}>{showAll ? "Show fewer" : `Show all ${v.length} videos`}</button>}
      </section>

      {byCat.length > 0 && (
        <section className={card}>
          <h3 className="font-semibold">Videos per category</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {byCat.map((x) => (
              <li key={x.name}>
                <div className="flex justify-between"><span>{x.name}</span><span className="text-muted-foreground">{x.n}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-secondary"><div className="h-full bg-primary" style={{ width: `${(x.n / v.length) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <h3 className="font-semibold">Recent posts</h3>
        {!recentPosts.length && <p className="mt-2 text-sm text-muted-foreground">No posts yet.</p>}
        <ul className="mt-2 divide-y divide-border">
          {recentPosts.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{x.title || "Untitled"}</p>
                <p className="text-xs text-muted-foreground">{KIND_LABEL[x.kind]} · updated {x.updatedAt.slice(0, 10)}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{x.status === "published" ? "Published" : "Draft"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h3 className="font-semibold">Latest inquiries</h3>
        {!recentQ.length && <p className="mt-2 text-sm text-muted-foreground">No inquiries yet.</p>}
        <ul className="mt-2 space-y-2">
          {recentQ.map((x) => (
            <li key={x["_id"]} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex justify-between gap-2"><b className="truncate">{x["name"]}</b><span className="shrink-0 text-xs text-muted-foreground">{x["createdAt"]?.slice(0, 10)}</span></div>
              <a href={`mailto:${x["email"]}`} className="text-xs text-muted-foreground underline">{x["email"]}</a>
              <p className="mt-1 line-clamp-2 text-muted-foreground">{x["message"]}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}


/** Before publishing: shows the video's thumbnail; tap it to play the chosen file. */
function LocalPreview({ video, thumb }: { video: File; thumb: File | null }) {
  const [playing, setPlaying] = useState(false);
  const [urls, setUrls] = useState<{ v: string; t: string | null } | null>(null);
  useEffect(() => {
    const v = URL.createObjectURL(video);
    const t = thumb ? URL.createObjectURL(thumb) : null;
    setUrls({ v, t });
    return () => { URL.revokeObjectURL(v); if (t) URL.revokeObjectURL(t); };
  }, [video, thumb]);
  useEffect(() => setPlaying(false), [video]);
  if (!urls) return null;
  return playing ? (
    <video src={urls.v} poster={urls.t ?? undefined} controls autoPlay playsInline className="h-auto w-full max-w-full rounded-xl bg-secondary" />
  ) : (
    <button type="button" onClick={() => setPlaying(true)} aria-label="Play preview" className="relative block aspect-video w-full overflow-hidden rounded-xl bg-secondary">
      {urls.t ? <img src={urls.t} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">Making thumbnail…</span>}
      <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-background/80"><Play size={22} /></span></span>
    </button>
  );
}

// ---------------- Large video upload ----------------
export function UploadTab() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { data: cats } = useCategories();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [thumb, setThumb] = useState<File | null>(null);
  const [autoThumb, setAutoThumb] = useState<File | null>(null);
  const [subs, setSubs] = useState<{ file: File; lang: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [prog, setProg] = useState<{ sent: number; total: number; started: number } | null>(null);
  const [phase, setPhase] = useState<"uploading" | "processing" | "done" | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const pubId = useRef<{ file: File; id: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const run = async () => {
    if (!video || !title.trim()) return setMsg("Add a title and a video file.");
    if (video.size > MAX_VIDEO_BYTES) return setMsg("Videos can be up to 30 GB.");
    if (abort.current) return; // already running: ignore repeated taps
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    // Same id for every retry of this file, so the server never creates a duplicate post.
    if (pubId.current?.file !== video) pubId.current = { file: video, id: crypto.randomUUID() };
    const started = Date.now();
    setPhase("uploading");
    setProg({ sent: 0, total: video.size, started });
    try {
      setMsg("Uploading… if it stops, press Publish again to resume.");
      // Thumbnail is prepared and uploaded in parallel with the video, not after it.
      const thumbP = (async () => {
        const tf = thumb ?? autoThumb ?? (await captureThumbnail(video));
        return tf ? (await uploadResumable(token, tf, "thumb", () => {}, ac.signal)).url : null;
      })().catch(() => null);
      // Subtitle files are small; upload them in parallel with the video too.
      const subsP = Promise.all(subs.map(async (s) => {
        const r = await uploadResumable(token, s.file, "sub", () => {}, ac.signal);
        return { ...trackMeta(s.lang), url: r.url };
      }));
      const v = await uploadResumable(token, video, "video", (p) => setProg({ ...p, started }), ac.signal);
      const upMs = Date.now() - started;
      setProg({ sent: video.size, total: video.size, started });
      setPhase("processing");
      setMsg("Processing…");
      const [thumbUrl, subTracks] = await Promise.all([thumbP, subsP]);
      const t1 = Date.now();
      setMsg("Publishing…");
      const saved = { id: pubId.current.id, title, category: cat || cats?.[0]?.id || "music", description: desc, status: "published" as const, videoUrl: v.url, thumbUrl };
      await saveVideo({ data: { token: await token(), ...saved, subtitles: subTracks } });
      const pubMs = Date.now() - t1;
      pubId.current = null;
      qc.invalidateQueries({ queryKey: ["videos"] });
      setPhase("done");
      setMsg(`Upload complete — published! Upload ${(upMs / 1000).toFixed(1)}s · processing ${((t1 - started - upMs) / 1000).toFixed(1)}s · publishing ${(pubMs / 1000).toFixed(2)}s`);
      setTitle(""); setDesc(""); setVideo(null); setThumb(null); setSubs([]);
      formRef.current?.reset();
    } catch (err: any) {
      setPhase(null);
      setMsg(err?.name === "AbortError" ? "Upload paused. Press Publish to resume, or Cancel upload to discard it." : `Failed: ${err.message}. Nothing was published — press Publish to resume from where it stopped.`);
    } finally {
      abort.current = null;
      setRunning(false);
    }
  };
  const discard = async () => {
    abort.current?.abort();
    if (video) await cancelUpload(token, video, "video");
    setProg(null);
    setMsg("Upload cancelled and removed.");
  };
  // Never show 100% while still uploading/processing — only when fully complete.
  const pct = prog ? (phase === "done" ? 100 : Math.min(99.9, (prog.sent / prog.total) * 100)) : phase === "done" ? 100 : 0;
  const speed = prog ? prog.sent / Math.max(1, (Date.now() - prog.started) / 1000) : 0;
  const busy = running;
  return (
    <section className={card}>
      <h2 className="font-semibold">Upload video</h2>
      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); run(); }} className="mt-4 space-y-3">
        <input placeholder="Title" maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        <textarea placeholder="Description (optional)" maxLength={5000} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
          {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-semibold hover:bg-accent">
            <Plus size={16} /> Video
            <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; setVideo(f); setAutoThumb(null); if (f) captureThumbnail(f).then(setAutoThumb); }} className="sr-only" />
          </label>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-semibold hover:bg-accent">
            <Plus size={16} /> Thumbnail
            <input type="file" accept="image/*" onChange={(e) => setThumb(e.target.files?.[0] ?? null)} className="sr-only" />
          </label>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-semibold hover:bg-accent">
            <Plus size={16} /> Subtitles
            <input type="file" accept=".srt,.vtt,text/vtt" onChange={(e) => { const f = e.target.files?.[0]; if (f) setSubs((s) => [...s, { file: f, lang: "English" }]); e.target.value = ""; }} className="sr-only" />
          </label>
        </div>
        {subs.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.file.name}</span>
            <input value={s.lang} maxLength={40} onChange={(e) => setSubs(subs.map((x, j) => (j === i ? { ...x, lang: e.target.value } : x)))} placeholder="Language" aria-label="Subtitle language" className={`${inputCls} h-8 w-28 text-xs`} />
            <button type="button" onClick={() => setSubs(subs.filter((_, j) => j !== i))} className={smallBtn}>Remove</button>
          </div>
        ))}
        {video && <p className="truncate text-xs text-muted-foreground">{video.name} · {fmt(video.size)}{thumb ? ` · ${thumb.name}` : ""}</p>}
        {video && <LocalPreview video={video} thumb={thumb ?? autoThumb} />}
        {(prog || phase === "done") && (
          <div>
            <div className="h-2 overflow-hidden rounded bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
            <p className="mt-1 text-xs text-muted-foreground">
              {phase === "done" ? "Upload complete" : phase === "processing" ? "Processing…" : "Uploading…"} · {pct.toFixed(1)}%
              {prog && ` · ${fmt(prog.sent)} of ${fmt(prog.total)}`}
              {phase === "uploading" && prog && ` · ${fmt(speed)}/s`}
              {phase === "uploading" && prog && speed > 0 && ` · about ${Math.ceil((prog.total - prog.sent) / speed / 60)} min left`}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} className={btnCls}>{busy ? "Uploading…" : "Publish"}</button>
          {busy && <button type="button" onClick={() => abort.current?.abort()} className={smallBtn}>Pause</button>}
          {video && <button type="button" onClick={discard} className={smallBtn}>Cancel upload</button>}
        </div>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      </form>
      <YoutubeAdd />
    </section>
  );
}

// ---------------- Video publish / unpublish ----------------
export function VideoStatusButton({ v }: { v: any }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await saveVideo({ data: { token: await token(), id: v.id, sk: v.sk, title: v.title, description: v.description ?? "", category: v.category, videoUrl: v.videoUrl, thumbUrl: v.thumbUrl || null, subtitles: v.subtitles ?? [], status: v.status === "published" ? "draft" : "published" } });
      qc.invalidateQueries({ queryKey: ["videos"] });
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };
  return <button disabled={busy} onClick={toggle} className={smallBtn}>{v.status === "published" ? "Unpublish" : "Publish"}</button>;
}

// ---------------- Categories ----------------
export function CategoriesTab() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { data } = useCategories();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg("Saving…");
    try { await fn(); setMsg(ok); await Promise.all([qc.invalidateQueries({ queryKey: ["categories"] }), qc.invalidateQueries({ queryKey: ["cats"] })]); } catch (e: any) { setMsg(e.message); }
  };
  const list = data ?? [];
  const move = (c: Category, d: -1 | 1) => {
    const i = list.indexOf(c), j = i + d;
    if (j < 0 || j >= list.length) return;
    const o = list[j]!;
    act(async () => {
      const t = await token();
      await saveCategory({ data: { token: t, id: c.id, name: c.name, order: o.order === c.order ? j : o.order } });
      await saveCategory({ data: { token: t, id: o.id, name: o.name, order: o.order === c.order ? i : c.order } });
    }, "Order saved.");
  };
  return (
    <section className={card}>
      <h2 className="font-semibold">Categories</h2>
      <p className="mt-1 text-xs text-muted-foreground">Renaming keeps every post and video linked to the category.</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; act(async () => saveCategory({ data: { token: await token(), name, order: list.length } }), "Category added."); setName(""); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New category name" className={inputCls} />
        <button className={smallBtn}>Add</button>
      </form>
      {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
      <ul className="mt-3 divide-y divide-border">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
            <span className="flex-1 truncate">{c.name} <span className="text-xs text-muted-foreground">/{c.id}</span></span>
            <button onClick={() => move(c, -1)} className={smallBtn} aria-label="Move up">↑</button>
            <button onClick={() => move(c, 1)} className={smallBtn} aria-label="Move down">↓</button>
            <button onClick={() => { const n = prompt("Rename category", c.name)?.trim(); if (n) act(async () => saveCategory({ data: { token: await token(), id: c.id, name: n, order: c.order } }), "Renamed."); }} className={smallBtn}>Rename</button>
            <button onClick={() => { if (confirm(`Delete "${c.name}"? Its videos and posts stay on the site under "All".`)) act(async () => deleteCategory({ data: { token: await token(), id: c.id } }), "Deleted."); }} className={`${smallBtn} text-destructive`}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------- Written posts CMS ----------------
type Draft = Omit<Post, "id" | "createdAt" | "updatedAt"> & { id?: string };
const empty = (category: string): Draft => ({ slug: "", title: "", excerpt: "", body: "", coverUrl: null, category, tags: [], seoTitle: "", seoDescription: "", featured: false, status: "draft", kind: "article", linkUrl: "", mediaUrl: null, mediaName: "", gallery: [] });

export function PostsTab() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { data: cats } = useCategories();
  const { data: posts, refetch } = useQuery({ queryKey: ["posts", "owner-all"], queryFn: async () => listAllPosts({ data: { token: await token() } }) });
  const [edit, setEdit] = useState<Draft | null>(null);
  const [filter, setFilter] = useState<"all" | "published" | "draft">("all");
  const [q, setQ] = useState("");
  const [kf, setKf] = useState<ContentKind | "">("");
  const [cf, setCf] = useState("");
  const [from, setFrom] = useState("");
  const [page, setPage] = useState(1);
  const del = async (p: Post) => {
    if (!confirm(`Permanently delete "${p.title}"? This can't be undone.`)) return;
    try { await deletePost({ data: { token: await token(), id: p.id } }); refetch(); qc.invalidateQueries({ queryKey: ["posts"] }); } catch (e: any) { alert(e.message); }
  };
  if (edit) return <PostEditor initial={edit} cats={cats ?? []} onDone={() => { setEdit(null); refetch(); qc.invalidateQueries({ queryKey: ["posts"] }); }} />;
  const matched = (posts ?? []).filter((p) =>
    (filter === "all" || p.status === filter) && (!kf || p.kind === kf) && (!cf || p.category === cf) &&
    (!from || p.createdAt.slice(0, 10) >= from) && (!q || `${p.title} ${p.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const shown = matched.slice(0, page * 20);
  const catName = (id: string) => cats?.find((c) => c.id === id)?.name ?? id;
  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Written posts ({posts?.length ?? 0})</h2>
        <button onClick={() => setEdit(empty(cats?.[0]?.id ?? ""))} className={btnCls.replace("w-full", "")}>New post</button>
      </div>
      <div className="mt-3 flex gap-2">
        {(["all", "published", "draft"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`${smallBtn} capitalize ${f === filter ? "bg-primary text-primary-foreground" : ""}`}>{f}</button>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search title or tag" className={inputCls} />
        <select value={kf} onChange={(e) => { setKf(e.target.value as any); setPage(1); }} className={inputCls} aria-label="Type">
          <option value="">All types</option>{CONTENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select value={cf} onChange={(e) => { setCf(e.target.value); setPage(1); }} className={inputCls} aria-label="Category">
          <option value="">All categories</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">From<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={inputCls} /></label>
      </div>
      {posts && !shown.length && <p className="mt-3 text-sm text-muted-foreground">No posts here yet.</p>}
      <ul className="mt-3 divide-y divide-border">
        {shown.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            {postThumbnail(p) && <img src={postThumbnail(p) ?? ""} alt={p.title} loading="lazy" className="h-14 w-20 shrink-0 rounded-lg object-cover" />}
            <span className="min-w-0 flex-1 truncate">
              {p.featured && "★ "}{p.title}
              <span className="text-muted-foreground"> · {KIND_LABEL[p.kind]} · {catName(p.category)} · {p.status === "published" ? "Published" : "Draft"}</span>
            </span>
            {p.status === "published" && <a href={`/posts/${p.slug}`} target="_blank" rel="noreferrer" className={smallBtn}>View</a>}
            <button onClick={() => setEdit(p)} className={smallBtn}>Edit</button>
            <button onClick={async () => { try { await savePost({ data: { ...p, token: await token(), status: p.status === "published" ? "draft" : "published" } }); refetch(); qc.invalidateQueries({ queryKey: ["posts"] }); } catch (e: any) { alert(e.message); } }} className={smallBtn}>{p.status === "published" ? "Unpublish" : "Publish"}</button>
            <button onClick={() => del(p)} className={smallBtn}>Delete</button>
          </li>
        ))}
      </ul>
      {matched.length > shown.length && <button onClick={() => setPage((n) => n + 1)} className={`${smallBtn} mt-3`}>Show more ({matched.length - shown.length})</button>}
    </section>
  );
}

function PostEditor({ initial, cats, onDone }: { initial: Draft; cats: Category[]; onDone: () => void }) {
  const { token } = useAuth();
  const [d, setD] = useState<Draft>(initial);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const [pct, setPct] = useState<number | null>(null);
  const upFile = async (f: File, kind: "image" | "audio" | "doc") => {
    setMsg(`Uploading ${f.name}…`);
    try {
      const r = await uploadResumable(token, f, kind, (p) => setPct((p.sent / p.total) * 100), new AbortController().signal);
      setMsg("Uploaded.");
      return r.url;
    } finally { setPct(null); }
  };
  const upImage = (f: File) => upFile(f, "image");
  const pick = (accept: string, multiple: boolean, fn: (files: File[]) => Promise<void>) => (
    <input type="file" accept={accept} multiple={multiple} className="hidden"
      onChange={async (e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (!fs.length) return; try { await fn(fs); } catch (err: any) { setMsg(`Upload failed: ${err.message}. Try again.`); } }} />
  );
  const save = async (status: "draft" | "published") => {
    if (!d.title.trim()) return setMsg("Add a title.");
    if (d.kind === "link" && !safeLink(d.linkUrl)) return setMsg("Enter a valid web address starting with https://");
    setBusy(true); setMsg("Saving…");
    try {
      const r = await savePost({ data: { ...d, token: await token(), status, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      setD((x) => ({ ...x, id: r.id, slug: r.slug, status }));
      setMsg(status === "published" ? `Published at /posts/${r.slug}` : "Draft saved.");
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{d.id ? "Edit post" : "New post"} <span className="text-xs text-muted-foreground">({d.status === "published" ? "Published" : "Draft"})</span></h2>
        <button onClick={onDone} className={smallBtn}>← Back</button>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setPreview(false)} className={`${smallBtn} ${!preview ? "bg-primary text-primary-foreground" : ""}`}>Write</button>
        <button onClick={() => setPreview(true)} className={`${smallBtn} ${preview ? "bg-primary text-primary-foreground" : ""}`}>Preview</button>
      </div>
      {preview ? (
        <article className="rounded-lg border border-border p-4">
          {d.coverUrl && <img src={d.coverUrl} alt="" className="w-full rounded-xl" />}
          <h1 className="mt-4 text-3xl font-bold">{d.title || "Untitled"}</h1>
          {d.excerpt && <p className="mt-2 text-muted-foreground">{d.excerpt}</p>}
          <ContentMedia p={d} />
          <PostBody body={d.body} />
        </article>
      ) : (
        <>
          <label className="block text-sm font-medium">Content type
            <select value={d.kind} onChange={(e) => set("kind", e.target.value as ContentKind)} className={`${inputCls} mt-1`}>
              {CONTENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <input value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={200} placeholder="Title" className={inputCls} />
          {d.kind === "link" && <input value={d.linkUrl} onChange={(e) => set("linkUrl", e.target.value)} maxLength={2000} placeholder="https://…" inputMode="url" className={inputCls} />}
          {(d.kind === "audio" || d.kind === "document") && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm">{d.mediaUrl ? `File: ${d.mediaName || "uploaded"}` : `No ${d.kind} file yet`}</p>
              <label className={`${smallBtn} inline-block cursor-pointer`}>{d.mediaUrl ? "Replace file" : `Upload ${d.kind === "audio" ? "audio (MP3, M4A, WAV, OGG…)" : "document (PDF, Word, Excel, PowerPoint, TXT)"}`}
                {pick(d.kind === "audio" ? "audio/*" : ".pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.epub", false, async ([f]) => {
                  const url = await upFile(f!, d.kind === "audio" ? "audio" : "doc");
                  setD((x) => ({ ...x, mediaUrl: url, mediaName: f!.name.slice(0, 200) }));
                })}
              </label>
              {d.mediaUrl && <ContentMedia p={d} />}
            </div>
          )}
          {d.kind === "images" && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              {d.gallery.map((g, i) => (
                <div key={g.url} className="flex gap-2">
                  <img src={g.url} alt={g.alt} className="h-20 w-20 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <input value={g.alt} maxLength={300} onChange={(e) => set("gallery", d.gallery.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} placeholder="Alt text (describe the image)" className={inputCls} />
                    <input value={g.caption} maxLength={500} onChange={(e) => set("gallery", d.gallery.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} placeholder="Caption (optional)" className={inputCls} />
                  </div>
                  <button onClick={() => set("gallery", d.gallery.filter((_, j) => j !== i))} className={`${smallBtn} self-start`} aria-label="Remove image">✕</button>
                </div>
              ))}
              <label className={`${smallBtn} inline-block cursor-pointer`}>Add images
                {pick("image/*", true, async (fs) => {
                  for (const f of fs) { const url = await upImage(f); setD((x) => ({ ...x, gallery: [...x.gallery, { url, alt: "", caption: "" }] })); }
                })}
              </label>
            </div>
          )}
          {pct !== null && <div className="h-2 overflow-hidden rounded bg-secondary"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>}
          <input value={d.slug} onChange={(e) => set("slug", e.target.value)} maxLength={120} placeholder="URL (leave empty to use the title)" className={inputCls} />
          <textarea value={d.excerpt} onChange={(e) => set("excerpt", e.target.value)} maxLength={500} rows={2} placeholder="Short summary" className={inputCls} />
          <div className="space-y-1">
            <textarea value={d.body} onChange={(e) => set("body", e.target.value)} maxLength={100000} rows={14} placeholder={"Write your post.\n\nBlank line = new paragraph. Start a line with # or ## for headings."} className={inputCls} />
            <label className={`${smallBtn} inline-block cursor-pointer`}>Insert image
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const url = await upImage(f); set("body", `${d.body.trimEnd()}\n\n${url}\n\n`); } catch (err: any) { setMsg(err.message); } }} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d.coverUrl && <img src={d.coverUrl} alt="" className="h-16 rounded" />}
            <label className={`${smallBtn} cursor-pointer`}>{d.coverUrl ? "Change cover" : "Add cover image"}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { set("coverUrl", await upImage(f)); } catch (err: any) { setMsg(err.message); } }} />
            </label>
            {d.coverUrl && <button onClick={() => set("coverUrl", null)} className={smallBtn}>Remove cover</button>}
          </div>
          <select value={d.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
            <option value="">No category</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, separated by commas" className={inputCls} />
          <input value={d.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} maxLength={70} placeholder="Search title (optional, max 70)" className={inputCls} />
          <textarea value={d.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} maxLength={170} rows={2} placeholder="Search description (optional, max 170)" className={inputCls} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured post</label>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => save("draft")} className={smallBtn}>{d.status === "published" ? "Unpublish (move to drafts)" : "Save draft"}</button>
        <button disabled={busy} onClick={() => save("published")} className={btnCls.replace("w-full", "")}>{d.status === "published" ? "Update" : "Publish"}</button>
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </section>
  );
}

// ---------------- Add a YouTube video by link ----------------
function YoutubeAdd() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { data: cats } = useCategories();
  const [url, setUrl] = useState("");
  const [cat, setCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const reqId = useRef<{ url: string; id: string } | null>(null);
  const add = async () => {
    if (busy || !url.trim()) return;
    if (reqId.current?.url !== url) reqId.current = { url, id: crypto.randomUUID() };
    setBusy(true); setMsg("Adding…");
    try {
      const r = await addYoutubeVideo({ data: { token: await token(), url, category: cat || cats?.[0]?.id || "music", id: reqId.current.id } });
      qc.invalidateQueries({ queryKey: ["videos"] });
      setMsg(r.existed ? `Already in your feed: ${r.title}` : `Added to feed: ${r.title}`);
      setUrl(""); reqId.current = null;
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mt-6 space-y-3 border-t border-border pt-5">
      <h3 className="font-semibold">Add a YouTube video</h3>
      <input placeholder="Paste a YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls} />
      <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
        {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button disabled={busy} className={btnCls}>{busy ? "Adding…" : "Add to feed"}</button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </form>
  );
}
