import { describe, it, expect } from "vitest";
import { parseSubtitles, validSubtitles, cueAt, trackMeta } from "./subtitles.core";

const SRT = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,500 --> 00:00:08,000
Second line
across two lines
`;

const VTT = `WEBVTT

00:01.000 --> 00:04.000
<b>Bold</b> cue

00:05.000 --> 00:07.500 align:start position:0%
Plain cue
`;

describe("subtitle parsing", () => {
  it("parses SRT with cue numbers and comma decimals", () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 4, text: "Hello world" });
    expect(cues[1]!.text).toBe("Second line\nacross two lines");
  });
  it("parses VTT, skips the header, strips tags and cue settings", () => {
    const cues = parseSubtitles(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 4, text: "Bold cue" });
    expect(cues[1]!.end).toBe(7.5);
  });
  it("rejects empty or broken files", () => {
    expect(validSubtitles("")).toBe(false);
    expect(validSubtitles("not subtitles at all")).toBe(false);
    expect(validSubtitles(SRT)).toBe(true);
  });
  it("shows each cue only inside its time range and stays in sync after seeks", () => {
    const cues = parseSubtitles(SRT);
    expect(cueAt(cues, 0.5)).toBeNull();
    expect(cueAt(cues, 2)).toBe("Hello world");
    expect(cueAt(cues, 4)).toBeNull(); // ended exactly at 4
    expect(cueAt(cues, 6)).toBe("Second line\nacross two lines"); // seeked forward
    expect(cueAt(cues, 1.5)).toBe("Hello world"); // seeked back
  });
  it("normalizes language metadata", () => {
    expect(trackMeta("English")).toEqual({ lang: "en", label: "English" });
    expect(trackMeta("sw")).toEqual({ lang: "sw", label: "sw" });
    expect(trackMeta("")).toEqual({ lang: "en", label: "English" });
  });
});
