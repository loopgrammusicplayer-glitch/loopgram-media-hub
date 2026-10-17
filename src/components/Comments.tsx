import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { addComment, deleteComment, listComments, reportComment } from "@/lib/api.functions";

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!(s >= 0)) return "";
  const u: [number, string][] = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [n, l] of u) if (s >= n) { const k = Math.floor(s / n); return `${k} ${l}${k > 1 ? "s" : ""} ago`; }
  return "just now";
};

/** Compact preview for the watch page: real count + newest comment, opens the full comments page. */
export function CommentsPreview({ vid }: { vid: string }) {
  const { data = [], isLoading, isError } = useQuery({ queryKey: ["comments", vid], queryFn: () => listComments({ data: { vid } }), staleTime: 15_000 });
  const c = data[0];
  return (
    <Link to="/watch/$id/comments" params={{ id: vid }} className="mt-4 block rounded-xl bg-secondary p-3 hover:bg-accent">
      <p className="text-sm font-semibold">Comments {!isLoading && !isError && <span className="font-normal text-muted-foreground">{data.length}</span>}</p>
      {isError ? <p className="mt-1 text-xs text-muted-foreground">Comments couldn't be loaded. Tap to retry.</p>
        : c ? <p className="mt-1 line-clamp-2 break-words text-sm"><span className="font-semibold">{c.name}</span> {c.text}</p>
        : !isLoading && <p className="mt-1 text-xs text-muted-foreground">No comments yet. Tap to add one.</p>}
    </Link>
  );
}

export function Comments({ vid }: { vid: string }) {
  const { user, role, token } = useAuth();
  const qc = useQueryClient();
  const { data = [], isLoading, isError } = useQuery({ queryKey: ["comments", vid], queryFn: () => listComments({ data: { vid } }), staleTime: 15_000 });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pending = useRef<{ text: string; id: string } | null>(null);
  const uid = (user as any)?.uid as string | undefined;

  const post = async () => {
    const t = text.trim();
    if (busy || !t) return;
    if (pending.current?.text !== t) pending.current = { text: t, id: crypto.randomUUID() };
    setBusy(true); setMsg(null);
    try {
      await addComment({ data: { token: await token(), vid, id: pending.current.id, text: t } });
      pending.current = null; setText("");
      await qc.invalidateQueries({ queryKey: ["comments", vid] });
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const act = async (fn: typeof deleteComment | typeof reportComment, id: string, done: string) => {
    try { await fn({ data: { token: await token(), vid, id } }); setMsg(done); qc.invalidateQueries({ queryKey: ["comments", vid] }); }
    catch (e: any) { setMsg(e.message); }
  };

  return (
    <section className="mt-6">
      <h2 className="font-semibold">{isLoading ? "Comments" : `${data.length} comment${data.length === 1 ? "" : "s"}`}</h2>
      {user ? (
        <form onSubmit={(e) => { e.preventDefault(); post(); }} className="mt-3 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Add a comment…" className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm" />
          <button disabled={busy || !text.trim()} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "…" : "Post"}</button>
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground"><Link to="/login" className="underline">Sign in</Link> to comment.</p>
      )}
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
      {isError && <p className="mt-3 text-sm text-muted-foreground">Comments couldn't be loaded.</p>}
      <ul className="mt-4 space-y-4">
        {data.map((c) => (
          <li key={c.id} className="flex gap-3">
            {c.picture ? <img src={c.picture} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-full object-cover" /> :
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">{c.name[0]?.toUpperCase()}</span>}
            <div className="min-w-0 flex-1">
              <p className="text-xs"><span className="font-semibold">{c.name}</span> <span className="text-muted-foreground">{ago(c.createdAt)}</span></p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.text}</p>
              {user && (
                <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                  {(c.uid === uid || role === "owner") && <button onClick={() => confirm("Delete this comment?") && act(deleteComment, c.id, "Comment deleted.")} className="hover:underline">Delete</button>}
                  {c.uid !== uid && <button onClick={() => act(reportComment, c.id, "Thanks — comment reported.")} className="hover:underline">Report</button>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
