// Pure rules for automatic captions (unit-tested). Audio is split into short
// segments; each segment's transcript is spread across its time window by word count.

export type Segment = { start: number; end: number; text: string };

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
export function vttTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

/** Split each segment into cues of at most `maxWords` words, timed proportionally. */
export function buildAutoVtt(segments: Segment[], maxWords = 8): string {
  const out: string[] = ["WEBVTT", ""];
  for (const seg of segments) {
    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (!words.length || seg.end <= seg.start) continue;
    const per = (seg.end - seg.start) / words.length;
    for (let i = 0; i < words.length; i += maxWords) {
      const chunk = words.slice(i, i + maxWords);
      const a = seg.start + i * per, b = seg.start + (i + chunk.length) * per;
      out.push(`${vttTime(a)} --> ${vttTime(b)}`, chunk.join(" "), "");
    }
  }
  return out.join("\n");
}

/** Time windows covering `duration` seconds in `size`-second pieces. */
export function segmentWindows(duration: number, size = 12): { start: number; end: number }[] {
  const w: { start: number; end: number }[] = [];
  for (let s = 0; s < duration; s += size) w.push({ start: s, end: Math.min(duration, s + size) });
  return w;
}

/** Longest audio we transcribe automatically (browser memory limit for decoding). */
export const MAX_AUTO_SECONDS = 30 * 60;
