import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ThumbsUp, ThumbsDown, LoaderCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { videoLike } from "@/lib/likes.functions";

const fmt = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact" }).format(n);

// Server is the source of truth: the UI shows a pending state, then the confirmed reaction/counts from DynamoDB.
export function LikeButton({ id, sk }: { id: string; sk: string }) {
  const { user, token, loading } = useAuth();
  const call = useServerFn(videoLike);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [dislikes, setDislikes] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const seq = useRef(0); // ignore responses older than the latest action
  useEffect(() => {
    let alive = true;
    setLiked(false); setDisliked(false); setCount(null); setDislikes(null); setError(null);
    if (user) token().then(t => call({ data: { id, sk, token: t, mode: "read" } })).then(r => {
      if (!alive || seq.current) return;
      if (typeof r.liked === "boolean") setLiked(r.liked);
      if (typeof r.disliked === "boolean") setDisliked(r.disliked);
      if (typeof r.count === "number") setCount(r.count);
      if (typeof r.dislikes === "number") setDislikes(r.dislikes);
    }).catch(() => {});
    return () => { alive = false; };
  }, [id, sk, user?.uid]);
  const toggle = async (kind: "like" | "dislike") => {
    if (pending || Date.now() < retryAt) return;
    const mine = ++seq.current;
    setPending(true); setError(null);
    const mode = kind === "like" ? (liked ? "unlike" : "write") : (disliked ? "undislike" : "dislike");
    try {
      const r = await call({ data: { id, sk, token: await token(), mode } });
      if (mine !== seq.current) return;
      if (typeof r.liked === "boolean") {
        setLiked(r.liked); setDisliked(!!r.disliked);
        if (typeof r.count === "number") setCount(r.count);
        if (typeof r.dislikes === "number") setDislikes(r.dislikes);
      }
      else if (r.status === "sign_in") setError("Please sign in again.");
      else { setError("Not saved. Try again shortly."); setRetryAt(Date.now() + (r.retryAfterSeconds ?? 10) * 1000); }
    } catch { setError("Not saved. Check your connection."); setRetryAt(Date.now() + 5000); }
    finally { if (mine === seq.current) setPending(false); }
  };
  const pill = "inline-flex h-9 items-center gap-1.5 bg-secondary px-4 text-sm font-semibold hover:bg-accent disabled:opacity-60";
  if (!user) return <Link to="/login" aria-disabled={loading} className={`${pill} shrink-0 rounded-full`}><ThumbsUp size={16} /> Like</Link>;
  return <div className="flex shrink-0 items-center gap-2">
    <div className="flex items-center overflow-hidden rounded-full">
      <button type="button" onClick={() => toggle("like")} disabled={pending} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"} className={`${pill} border-r border-border`}>
        {pending ? <LoaderCircle size={16} className="animate-spin" /> : <ThumbsUp size={16} className={liked ? "fill-current" : ""} />}
        {count !== null ? fmt(count) : liked ? "Liked" : "Like"}
      </button>
      <button type="button" onClick={() => toggle("dislike")} disabled={pending} aria-pressed={disliked} aria-label={disliked ? "Remove dislike" : "Dislike"} className={pill}>
        <ThumbsDown size={16} className={disliked ? "fill-current" : ""} />
        {dislikes !== null && dislikes > 0 ? fmt(dislikes) : <span className="sr-only">Dislike</span>}
      </button>
    </div>
    {error && <span role="status" className="shrink-0 text-xs text-muted-foreground">{error}</span>}
  </div>;
}
