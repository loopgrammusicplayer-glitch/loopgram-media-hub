import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

const VALID_ID = /^[\w-]{11}$/;

/**
 * Load the YouTube IFrame API. Robust against:
 * - a script tag that already exists (re-navigating between watch pages)
 * - the global callback having already fired before we subscribed
 * - the script failing to load (network/CSP) — rejects so the caller can fall back
 */
function loadApi(timeoutMs = 8000): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("api-timeout")), timeoutMs);
    const done = (yt: any) => { clearTimeout(timer); res(yt); };
    const fail = (why: string) => { clearTimeout(timer); rej(new Error(why)); };

    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (existing) {
      // Script already injected earlier: poll for the API instead of adding a
      // duplicate script whose callback may never fire again.
      const poll = setInterval(() => {
        if (window.YT?.Player) { clearInterval(poll); done(window.YT); }
      }, 100);
      setTimeout(() => clearInterval(poll), timeoutMs);
      existing.addEventListener("error", () => { clearInterval(poll); fail("api-script-error"); }, { once: true });
      return;
    }

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); if (window.YT?.Player) done(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => fail("api-script-error");
    document.head.appendChild(s);
  });
}

function embedUrl(ytId: string) {
  // cc_load_policy=1 asks YouTube to show its own captions by default where the video has them.
  return `https://www.youtube-nocookie.com/embed/${ytId}?playsinline=1&rel=0&modestbranding=1&cc_load_policy=1`;
}

/**
 * Official YouTube embedded player. Uses the IFrame API when it loads (so we
 * get play events and precise error codes); if the API script can't load —
 * the cause of the black "player failed to load" screen on some mobile
 * networks — it falls back to the plain official embed iframe, which needs
 * no JavaScript from YouTube at all. "Watch on YouTube" is only shown when
 * the video itself reports a real playback error.
 */
export function YoutubePlayer({ ytId, onPlay }: { ytId: string; onPlay?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const played = useRef(false);
  const firePlay = () => { if (!played.current) { played.current = true; onPlay?.(); } };

  useEffect(() => {
    setErr(null);
    setFallback(false);
    played.current = false;
    if (!VALID_ID.test(ytId)) { setErr("invalid-id"); return; }
    let player: any;
    let dead = false;
    loadApi().then((YT) => {
      if (dead || !box.current) return;
      const el = document.createElement("div");
      box.current.replaceChildren(el);
      player = new YT.Player(el, {
        videoId: ytId, width: "100%", height: "100%",
        host: "https://www.youtube-nocookie.com",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 1, origin: location.origin },
        events: {
          onStateChange: (e: any) => { if (e.data === 1) firePlay(); },
          onError: (e: any) => setErr(
            e.data === 101 || e.data === 150 || e.data === 153
              ? "The owner of this video doesn't allow it to be played outside YouTube."
              : e.data === 100 ? "This video is private or was removed from YouTube."
              : e.data === 2 ? "This video's link is invalid."
              : "This video couldn't be played here."),
        },
      });
    }).catch(() => { if (!dead) setFallback(true); });
    return () => { dead = true; try { player?.destroy(); } catch { /* gone */ } };
  }, [ytId]);

  const invalid = err === "invalid-id";
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-player sm:rounded-xl">
      {fallback ? (
        <iframe
          key={ytId}
          src={embedUrl(ytId)}
          title="YouTube video player"
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          onPointerDown={firePlay}
        />
      ) : (
        <div ref={box} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
      )}
      {err && !invalid && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-4 text-center text-sm">
          <p className="text-muted-foreground">{err}</p>
          <a href={`https://www.youtube.com/watch?v=${ytId}`} target="_blank" rel="noreferrer" className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground">Watch on YouTube</a>
        </div>
      )}
      {invalid && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 p-4 text-center text-sm text-muted-foreground">
          This video's YouTube link is invalid.
        </div>
      )}
    </div>
  );
}
