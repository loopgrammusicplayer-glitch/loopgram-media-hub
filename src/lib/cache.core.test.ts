import { describe, expect, it } from "vitest";
import { createCache } from "./cache.core";
import { latestRequest, PERFORMANCE } from "./performance";

describe("cache integrity", () => {
  it("shares concurrent loads", async () => {
    let calls = 0;
    const cache = createCache({ read: async () => null, write: async () => {} });
    const results = await Promise.all(Array.from({ length: 100 }, () => cache.get("key", 60, async () => { calls++; return 7; })));
    expect(calls).toBe(1); expect(results).toHaveLength(100); expect(results.every(v => v === 7)).toBe(true);
  });
  it("falls back on cache failure without losing source content", async () => {
    const cache = createCache({ read: async () => { throw new Error(); }, write: async () => { throw new Error(); } });
    expect(await cache.get("key", 60, async () => 9)).toBe(9);
    expect(cache.metrics.readFailure).toBe(1); expect(cache.metrics.writeFailure).toBe(1);
  });
  it("prevents an invalidated in-flight read from repopulating memory", async () => {
    let finish: ((v: number) => void) | undefined;
    const writes: string[] = [];
    const cache = createCache({ read: async () => null, write: async (_, v) => { writes.push(v); } });
    const old = cache.get("key", 60, () => new Promise<number>(r => { finish = r; }));
    await Promise.resolve(); await Promise.resolve();
    cache.forget("key");
    expect(await cache.get("key", 60, async () => 2)).toBe(2);
    finish?.(1); expect(await old).toBe(1);
    expect(await cache.get("key", 60, async () => 3)).toBe(2);
    expect(writes).toEqual(["2"]);
  });
  it("expires local entries", async () => {
    let now = 0;
    const cache = createCache({ now: () => now, read: async () => null, write: async () => {} });
    expect(await cache.get("key", 60, async () => 1)).toBe(1);
    now = 5001;
    expect(await cache.get("key", 60, async () => 2)).toBe(2);
  });
  it("bounds distinct concurrent misses", async () => {
    const cache = createCache({ read: async () => new Promise<string | null>(() => {}), write: async () => {} });
    for (let n = 0; n < PERFORMANCE.cacheInflight; n++) void cache.get(String(n), 60, async () => 1);
    await expect(cache.get("overflow", 60, async () => 1)).rejects.toThrow("busy");
  });
  it("invalidates old search responses immediately when input changes", () => {
    const guard = latestRequest(); const old = guard.invalidate();
    const clear = guard.invalidate();
    expect(guard.isCurrent(old)).toBe(false); expect(guard.isCurrent(clear)).toBe(true);
  });
  it("keeps user performance targets explicit", () => {
    expect(PERFORMANCE.feedbackTargetMs).toBe(50);
    expect(PERFORMANCE.cachedRequestTargetMs).toBe(200);
  });
});