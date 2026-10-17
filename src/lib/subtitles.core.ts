// Pure subtitle rules (unit-tested). Manual subtitles only — no AI anywhere in this pipeline.
// Supports WebVTT (.vtt) and SubRip (.srt). Shared by browser and server.

export type Cue = { start: number; end: number; text: string };
export type SubtitleTrack = { lang: string; label: string; url: string };

const TIME_RE = /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;

function toSeconds(m: RegExpExecArray): number {
  const h = Number(m[1] ?? 0), min = Number(m[2]), s = Number(m[3]);
  const ms = Number((m[4] ?? "0").padEnd(3, "0").slice(0, 3));
  return h * 3600 + min * 60 + s + ms / 1000;
}

/** Strip VTT/SRT markup tags and cue settings from a text line. */
const clean = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();

/**
 * Parse .vtt or .srt text into cues sorted by start time.
 * Returns [] for unparseable input. Cues with end <= start are dropped.
 */
export function parseSubtitles(raw: string): Cue[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    // Skip VTT header/metadata blocks.
    if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0]!) && !TIME_RE.test(lines[0]!)) continue;
    // Find the timing line (SRT may have a numeric cue identifier first).
    const ti = lines.findIndex((l) => l.includes("-->") && TIME_RE.test(l));
    if (ti === -1) continue;
    const timing = lines[ti]!;
    const arrow = timing.split("-->");
    const sm = TIME_RE.exec(arrow[0]!);
    const em = TIME_RE.exec(arrow[1] ?? "");
    if (!sm || !em) continue;
    const start = toSeconds(sm), end = toSeconds(em);
    const textLines = lines.slice(ti + 1).map(clean).filter(Boolean);
    if (!textLines.length || end <= start) continue;
    cues.push({ start, end, text: textLines.join("\n") });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** A track is valid when it parses to at least one cue. */
export const validSubtitles = (raw: string) => parseSubtitles(raw).length > 0;

/** The cue text showing at time t (seconds), or null when no cue is active. */
export function cueAt(cues: Cue[], t: number): string | null {
  for (const c of cues) if (t >= c.start && t < c.end) return c.text;
  return null;
}

/** Normalize a language code/label the owner typed, e.g. "English" -> { lang: "en", label: "English" }. */
export function trackMeta(langInput: string): { lang: string; label: string } {
  const label = langInput.trim().slice(0, 40) || "English";
  const known: Record<string, string> = { english: "en", swahili: "sw", luganda: "lg", french: "fr", spanish: "es", arabic: "ar" };
  const lang = known[label.toLowerCase()] ?? (/^[a-z]{2,3}$/i.test(label) ? label.toLowerCase() : "en");
  return { lang, label };
}
