import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { formatDuration } from "@/lib/content.core";
import { cueAt, parseSubtitles, type Cue, type SubtitleTrack } from "@/lib/subtitles.core";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_MS = 2500;

type Props = {
  src: string;
  poster?: string | undefined;
  onTime?: (el: { currentTime: number }) => void;
  /** Manual subtitle tracks. The default (first) track is always shown; there is no off switch. */
  subtitles?: SubtitleTrack[] | undefined;
};

/** YouTube-style player for uploaded files: fixed 16:9 black stage, letterboxed video, custom controls. */
export function CustomVideoPlayer({ src, poster, onTime, subtitles }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const hideT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [buf, setBuf] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [fs, setFs] = useState(false);
  const [shown, setShown] = useState(true);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(false);
  const [flash, setFlash] = useState<"play" | "pause" | null>(null);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);

  const glow = useRef<HTMLCanvasElement>(null);
  // Ambient mode: paint the current frame into a small blurred canvas behind the video.
  useEffect(() => {
    const id = setInterval(() => {
      const v = vid.current, c = glow.current;
      if (!v || !c || v.readyState < 2) return;
      try { c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height); } catch { /* ignore */ }
    }, 250);
    return () => clearInterval(id);
  }, [src]);

  const [cues, setCues] = useState<Cue[]>([]);

  // Load the default subtitle track (manual .srt/.vtt from R2). Always on — no viewer control.
  useEffect(() => {
    setCues([]);
    const track = subtitles?.[0];
    if (!track) return;
    let dead = false;
    fetch(track.url)
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => { if (!dead) setCues(parseSubtitles(text)); })
      .catch(() => {});
    return () => { dead = true; };
  }, [subtitles?.[0]?.url]);

  useEffect(() => {
    setReady(false); setErr(false); setT(0); setDur(0); setBuf(0); setPlaying(false); setAspect(null);
    const el = vid.current;
    if (el && el.readyState >= 2) setReady(true);
    if (el && el.readyState >= 1) setDur(el.duration);
  }, [src]);

  useEffect(() => {
    const on = () => setFs(document.fullscreenElement === box.current || (document as any).webkitFullscreenElement === box.current);
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    return () => { document.removeEventListener("fullscreenchange", on); document.removeEventListener("webkitfullscreenchange", on); };
  }, []);

  useEffect(() => () => clearTimeout(hideT.current), []);

  const poke = () => {
    setShown(true);
    clearTimeout(hideT.current);
    hideT.current = setTimeout(() => { if (vid.current && !vid.current.paused && !speedOpen) setShown(false); }, HIDE_MS);
  };
  useEffect(() => { if (!playing) { clearTimeout(hideT.current); setShown(true); } else poke(); }, [playing, speedOpen]);

  const toggle = () => {
    const el = vid.current;
    if (!el) return;
    if (el.paused) { void el.play().catch(() => {}); setFlash("play"); } else { el.pause(); setFlash("pause"); }
    setTimeout(() => setFlash(null), 500);
  };

  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return { x: p * r.width, time: p * (dur || 0) };
  };
  const seekTo = (clientX: number) => { const { time } = timeAt(clientX); if (vid.current && dur) { vid.current.currentTime = time; setT(time); } };

  const setVolume = (n: number) => {
    const el = vid.current; if (!el) return;
    el.volume = n; el.muted = n === 0; setVol(n); setMuted(n === 0);
  };
  const toggleMute = () => {
    const el = vid.current; if (!el) return;
    const m = !el.muted; el.muted = m; setMuted(m);
    if (!m && el.volume === 0) setVolume(1);
  };
  const setSpeed = (s: number) => { if (vid.current) vid.current.playbackRate = s; setRate(s); setSpeedOpen(false); };

  const toggleFs = async () => {
    const d = document as any, el = box.current as any;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      else if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else (vid.current as any)?.webkitEnterFullscreen?.();
    } catch { /* not allowed */ }
  };

  const onKey = (e: React.KeyboardEvent) => {
    const el = vid.current; if (!el) return;
    if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight") el.currentTime = Math.min(dur, el.currentTime + 5);
    else if (e.key === "ArrowLeft") el.currentTime = Math.max(0, el.currentTime - 5);
    else if (e.key === "m") toggleMute();
    else if (e.key === "f") void toggleFs();
    else return;
    poke();
  };

  const pct = dur ? (t / dur) * 100 : 0;
  const bufPct = dur ? (buf / dur) * 100 : 0;
  const visible = shown || !playing;
  const cue = cues.length ? cueAt(cues, t) : null;
  // YouTube-style: always a fixed 16:9 frame; the full video sits in the middle and the sides get an ambient blur.
  void aspect;
  const retry = () => { setErr(false); setReady(false); vid.current?.load(); };

  return (
    <div
      ref={box}
      tabIndex={0}
      onKeyDown={onKey}
      onMouseMove={poke}
      onTouchStart={poke}
      onMouseLeave={() => playing && setShown(false)}
      className={`group relative select-none overflow-hidden bg-player text-player-foreground outline-none ${fs ? "h-full w-full" : "aspect-video w-full sm:rounded-xl"} ${visible ? "" : "cursor-none"}`}
      aria-label="Video player"
    >
      {poster && (
        <img src={poster} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-80 blur-3xl saturate-150" />
      )}
      <canvas ref={glow} width={32} height={18} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-125 opacity-80 blur-2xl saturate-150" />
      <video
        ref={vid}
        key={src}
        src={src}
        poster={poster}
        playsInline
        {...{ "webkit-playsinline": "true" }}
        preload="metadata"
        onClick={toggle}
        onError={() => setErr(true)}
        onLoadedData={() => setReady(true)}
        onLoadedMetadata={(e) => { const el = e.currentTarget; setDur(el.duration); if (el.videoWidth && el.videoHeight) setAspect(el.videoWidth / el.videoHeight); }}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onTimeUpdate={(e) => { if (!scrubbing) setT(e.currentTarget.currentTime); onTime?.(e.currentTarget); }}
        onProgress={(e) => { const b = e.currentTarget.buffered; if (b.length) setBuf(b.end(b.length - 1)); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setReady(false)}
        onPlaying={() => setReady(true)}
        className="absolute inset-0 h-full w-full object-contain"
      />

      {!ready && !err && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-live="polite">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-player-foreground/30 border-t-player-accent" aria-label="Loading video" />
        </div>
      )}

      {cue && (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-4" aria-live="off">
          <span className="max-w-[90%] whitespace-pre-line rounded bg-player/80 px-2 py-0.5 text-center text-sm font-medium leading-snug text-player-foreground sm:text-base">
            {cue}
          </span>
        </div>
      )}

      {flash && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 animate-ping items-center justify-center rounded-full bg-player/60 [animation-iteration-count:1]">
            {flash === "play" ? <Play size={28} fill="currentColor" /> : <Pause size={28} fill="currentColor" />}
          </span>
        </div>
      )}

      {!playing && ready && !err && !flash && (
        <button onClick={toggle} aria-label="Play" className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-player/60 hover:bg-player-accent">
          <Play size={30} fill="currentColor" />
        </button>
      )}

      {err && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-4 text-center text-sm text-muted-foreground">
          This video couldn't be loaded.
          <button onClick={retry} className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-90">Try again</button>
        </div>
      )}

      {/* Controls */}
      <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-player/90 via-player/40 to-transparent px-3 pb-1.5 pt-10 transition-opacity duration-300 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        {/* Scrub bar */}
        <div
          ref={bar}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.floor(dur)}
          aria-valuenow={Math.floor(t)}
          aria-valuetext={`${formatDuration(t)} of ${formatDuration(dur)}`}
          tabIndex={0}
          className="group/bar relative flex h-4 cursor-pointer touch-none items-center"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setScrubbing(true); seekTo(e.clientX); }}
          onPointerMove={(e) => { setHover(timeAt(e.clientX)); if (scrubbing) seekTo(e.clientX); }}
          onPointerUp={() => setScrubbing(false)}
          onPointerLeave={() => setHover(null)}
        >
          <div className="relative h-1 w-full rounded-full bg-player-foreground/25 transition-all group-hover/bar:h-1.5">
            <div className="absolute inset-y-0 left-0 rounded-full bg-player-foreground/45" style={{ width: `${bufPct}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-player-accent" style={{ width: `${pct}%` }} />
            <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-player-accent transition-transform group-hover/bar:scale-100" style={{ left: `${pct}%` }} />
          </div>
          {hover && dur > 0 && (
            <span className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded bg-player/80 px-1.5 py-0.5 text-xs tabular-nums" style={{ left: hover.x }}>
              {formatDuration(hover.time)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-sm">
          <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-player-foreground/10">
            {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <div className="group/vol flex items-center">
            <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-player-foreground/10">
              {muted || vol === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
            </button>
            <input
              type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol} aria-label="Volume"
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-0 accent-player-foreground opacity-0 transition-all duration-200 focus:w-20 focus:opacity-100 group-hover/vol:w-20 group-hover/vol:opacity-100"
            />
          </div>
          <span className="ml-1 tabular-nums">{formatDuration(t)} / {formatDuration(dur)}</span>
          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button onClick={() => setSpeedOpen((o) => !o)} aria-label="Playback speed" aria-expanded={speedOpen}
                className="flex h-10 min-w-10 items-center justify-center rounded-full px-2 text-xs font-semibold hover:bg-player-foreground/10">
                {rate === 1 ? "1x" : `${rate}x`}
              </button>
              {speedOpen && (
                <div role="menu" className="absolute bottom-12 right-0 z-10 w-36 overflow-hidden rounded-lg bg-player/95 py-1 shadow-lg">
                  <p className="px-3 py-1.5 text-xs text-player-foreground/60">Playback speed</p>
                  {SPEEDS.map((s) => (
                    <button key={s} role="menuitemradio" aria-checked={s === rate} onClick={() => setSpeed(s)}
                      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-player-foreground/10 ${s === rate ? "font-semibold text-player-accent" : ""}`}>
                      {s === 1 ? "Normal" : `${s}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={toggleFs} aria-label={fs ? "Exit full screen" : "Full screen"} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-player-foreground/10">
              {fs ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
