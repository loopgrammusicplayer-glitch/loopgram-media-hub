import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Header, btnCls, inputCls } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_CATEGORIES, PAGE_SLUGS, slugify, deleteInquiry, deleteMedia, deleteVideo, getContent, healthCheck,
  listInquiries, listMedia, listAllVideos, listVideos, saveContent, saveVideo,
} from "@/lib/api.functions";
import { useSignOut } from "./account";
import { VideoLibrary } from "@/components/studio/VideoLibrary";
import { Button } from "@/components/ui/button";
import { FileText, Music, Video as VideoIcon, Trash2, Image as ImageIcon } from "lucide-react";
import { usePaged, ShowMore } from "@/components/studio/ShowMore";
import { card, smallBtn, DashboardTab, UploadTab, PostsTab, CategoriesTab } from "@/components/studio/StudioTabs";

export const Route = createFileRoute("/owner")({
  head: () => ({
    meta: [
      { title: "Studio — Loopgram Channel" },
      { name: "description", content: "Owner studio for Loopgram Channel." },
      { property: "og:title", content: "Studio — Loopgram Channel" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:description", content: "Owner studio for Loopgram Channel." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Owner,
});

const TABS = ["Dashboard", "Upload", "Videos", "Posts", "Categories", "Media", "Inquiries", "Pages", "Settings"] as const;
type Tab = (typeof TABS)[number];

export async function uploadFile(token: string, file: File, kind: "video" | "thumb" | "image") {
  const res = await fetch(`/api/upload?kind=${kind}`, {
    method: "POST",
    body: file,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type || (kind === "video" ? "video/mp4" : "image/jpeg") },
  });
  const j = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
  if (!res.ok) throw new Error(j.error ?? `Upload failed (${res.status})`);
  return j as { key: string; url: string };
}

function Owner() {
  const { user, role, loading } = useAuth();
  const nav = useNavigate();
  const signOut = useSignOut();
  const [tab, setTab] = useState<Tab>("Dashboard");
  useEffect(() => {
    if (!loading && !user) nav({ to: "/login", replace: true });
  }, [loading, user, nav]);
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  if (role !== "owner")
    return <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted-foreground">Access denied. This area is for the channel owner only.</div>;
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Studio</h1>
          <button onClick={signOut} className={smallBtn}>Sign out</button>
        </div>
        <nav className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${t === tab ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}>{t}</button>
          ))}
        </nav>
        {tab === "Dashboard" && <DashboardTab />}
        {tab === "Upload" && <UploadTab />}
        {tab === "Posts" && <PostsTab />}
        {tab === "Categories" && <CategoriesTab />}
        {tab === "Videos" && <VideoLibrary />}
        {tab === "Media" && <MediaTab />}
        {tab === "Inquiries" && <InquiriesTab />}
        {tab === "Pages" && <PagesTab />}
        {tab === "Settings" && <SettingsTab />}
      </main>
    </div>
  );
}

function MediaTab() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const { data, refetch, isLoading, error } = useQuery({ queryKey: ["media"], queryFn: async () => listMedia({ data: { token: await token() } }) });
  const paged = usePaged(data, 50);
  const del = async (m: NonNullable<typeof data>[number]) => {
    if (!confirm(`Permanently delete "${m.title}"? This also deletes ${m.linkedPosts} linked post(s) and ${m.linkedVideos} linked video(s) from the website. Shared files used elsewhere will be kept. This cannot be undone.`)) return;
    setDeleting(m.key); setMessage("");
    try {
      const result = await deleteMedia({ data: { token: await token(), key: m.key } });
      qc.removeQueries({ queryKey: ["posts"] });
      await qc.invalidateQueries();
      await refetch();
      setMessage(`Deleted ${result.deletedFiles} file(s), ${result.deletedPosts} post(s) and ${result.deletedVideos} video(s).`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Deletion failed. Try again.");
      await qc.invalidateQueries();
    } finally { setDeleting(null); }
  };
  return (
    <section className={card}>
      <h2 className="font-semibold">Media library</h2>
      {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error.message}</p>}
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      {data && !data.length && <p className="mt-3 text-sm text-muted-foreground">No media yet.</p>}
      <ul className="mt-3 divide-y divide-border">
        {paged.visible.map((m) => {
          const Icon = m.key.startsWith("audio/") ? Music : m.key.startsWith("videos/") ? VideoIcon : m.key.startsWith("docs/") ? FileText : ImageIcon;
          return <li key={m.key} className="flex items-center gap-3 py-3 text-sm">
            <a href={m.url} target="_blank" rel="noreferrer" aria-label={`Open ${m.title}`} className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
              {m.previewUrl ? <img src={m.previewUrl} alt={m.title} loading="lazy" className="h-full w-full object-cover" /> : <Icon size={24} aria-hidden />}
            </a>
            <div className="min-w-0 flex-1">
              <a href={m.url} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">{m.title}</a>
              <p className="truncate text-xs text-muted-foreground">{m.key}</p>
              <p className="text-xs text-muted-foreground">{(m.size / 1048576).toFixed(1)} MB · {m.inUse ? `${m.linkedPosts + m.linkedVideos} linked item(s)` : "Unused"}</p>
            </div>
            <Button variant="ghost" size="icon" disabled={deleting !== null} onClick={() => del(m)} aria-label={`Delete ${m.title}`} title={`Delete ${m.title}`} className="shrink-0 text-destructive">
              <Trash2 aria-hidden className={deleting === m.key ? "animate-pulse" : ""} />
            </Button>
          </li>;
        })}
      </ul>
      <ShowMore more={paged.more} left={paged.left} />
    </section>
  );
}

function InquiriesTab() {
  const { token } = useAuth();
  const { data, refetch, isLoading } = useQuery({ queryKey: ["inquiries"], queryFn: async () => listInquiries({ data: { token: await token() } }) });
  const paged = usePaged(data as Record<string, string>[] | undefined, 20);
  return (
    <section className={card}>
      <h2 className="font-semibold">Inquiries</h2>
      {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      {data && !data.length && <p className="mt-3 text-sm text-muted-foreground">No inquiries yet.</p>}
      <ul className="mt-3 space-y-3">
        {paged.visible.map((q: Record<string, string>) => (
          <li key={q["_id"]} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex justify-between gap-2">
              <b>{q["name"]}</b>
              <span className="text-muted-foreground">{q["createdAt"]?.slice(0, 10)}</span>
            </div>
            <a href={`mailto:${q["email"]}`} className="text-muted-foreground underline">{q["email"]}</a>
            <p className="mt-2 whitespace-pre-wrap">{q["message"]}</p>
            <button onClick={async () => { await deleteInquiry({ data: { token: await token(), id: q["_id"]! } }); refetch(); }} className={`${smallBtn} mt-2`}>Delete</button>
          </li>
        ))}
      </ul>
      <ShowMore more={paged.more} left={paged.left} />
    </section>
  );
}

function ContentEditor({ slug, label }: { slug: (typeof PAGE_SLUGS)[number]; label: string }) {
  const { token } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    getContent({ data: { slug } }).then((c) => { setTitle(c.title); setBody(c.body); });
  }, [slug]);
  const save = async () => {
    setMsg("Saving…");
    try { await saveContent({ data: { token: await token(), slug, title, body } }); setMsg("Saved."); }
    catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{label}</h3>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={inputCls} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Content" className={inputCls} />
      <button onClick={save} className={smallBtn}>Save</button>
      {msg && <span className="ml-2 text-sm text-muted-foreground">{msg}</span>}
    </div>
  );
}

function PagesTab() {
  const [slug, setSlug] = useState<"about" | "privacy" | "terms">("about");
  return (
    <section className={`${card} space-y-4`}>
      <h2 className="font-semibold">Editable pages</h2>
      <select value={slug} onChange={(e) => setSlug(e.target.value as any)} className={inputCls}>
        <option value="about">About</option><option value="privacy">Privacy</option><option value="terms">Terms</option>
      </select>
      <ContentEditor key={slug} slug={slug} label={`/pages/${slug}`} />
    </section>
  );
}

function SettingsTab() {
  const { token } = useAuth();
  const [health, setHealth] = useState<Record<string, string> | null>(null);
  return (
    <>
      <section className={card}>
        <ContentEditor slug="settings" label="Site tagline (title) and announcement (content) shown on the home page" />
      </section>
      <section className={card}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Service status</h2>
          <button onClick={async () => setHealth(await healthCheck({ data: { token: await token() } }))} className={smallBtn}>Test all</button>
        </div>
        {health && (
          <ul className="mt-3 space-y-1 text-sm">
            {Object.entries(health).map(([k, v]) => (
              <li key={k}><span className="font-medium capitalize">{k}:</span> <span className={v === "OK" ? "" : "text-destructive"}>{v}</span></li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
