import { describe, expect, it } from "vitest";
import { buildAutoVtt, segmentWindows, vttTime } from "./autocaption.core";
import { parseSubtitles } from "./subtitles.core";

describe("auto captions", () => {
  it("formats VTT time", () => expect(vttTime(3723.5)).toBe("01:02:03.500"));
  it("spreads a segment's words over its window", () => {
    const cues = parseSubtitles(buildAutoVtt([{ start: 10, end: 14, text: "one two three four" }], 2));
    expect(cues).toEqual([{ start: 10, end: 12, text: "one two" }, { start: 12, end: 14, text: "three four" }]);
  });
  it("skips silent segments", () => expect(parseSubtitles(buildAutoVtt([{ start: 0, end: 12, text: "  " }]))).toEqual([]));
  it("covers the whole duration", () => expect(segmentWindows(25, 12)).toEqual([{ start: 0, end: 12 }, { start: 12, end: 24 }, { start: 24, end: 25 }]));
});
