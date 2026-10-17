import { describe, expect, it } from "vitest";
import { recordView, totalViews, VIEW_POLICY, type ViewDeps } from "./views.core";

const VID = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;

function fakeDeps(opts: { cacheDown?: boolean; dbFailTimes?: number } = {}) {
  const keys = new Map<string, number>();
  const shards = Array(VIEW_POLICY.SHARDS).fill(0) as number[];
  let fails = opts.dbFailTimes ?? 0;
  const metrics: string[] = [];
  const deps: ViewDeps = {
    setOnce: async (k) => { if (opts.cacheDown) throw new Error("down"); if (keys.has(k)) return false; keys.set(k, 1); return true; },
    incrWindow: async (k) => { if (opts.cacheDown) throw new Error("down"); keys.set(k, (keys.get(k) ?? 0) + 1); return keys.get(k)!; },
    release: async (...ks) => { ks.forEach((k) => keys.delete(k)); },
    addDurable: async (_v, n) => { if (fails > 0) { fails--; throw new Error("throttled"); } shards[n]!++; },
    videoIsPublished: async (v) => v === VID,
    metric: (m) => metrics.push(m),
    random: Math.random,
  };
  return { deps, shards, metrics, total: () => shards.reduce((a, b) => a + b, 0) };
}
const ev = (e: number, viewer = 1, ip = "a") => ({ videoId: VID, eventId: id(e), viewerId: id(1000 + viewer), ipHash: ip });

describe("view counting", () => {
  it("counts a valid view once", async () => {
    const f = fakeDeps();
    expect((await recordView(f.deps, ev(1))).status).toBe("accepted");
    expect(f.total()).toBe(1);
  });
  it("ignores a retried event (same event id)", async () => {
    const f = fakeDeps();
    await recordView(f.deps, ev(1));
    expect((await recordView(f.deps, ev(1))).status).toBe("duplicate");
    expect(f.total()).toBe(1);
  });
  it("ignores refreshes / other tabs by the same viewer within 30 minutes", async () => {
    const f = fakeDeps();
    await recordView(f.deps, ev(1));
    expect((await recordView(f.deps, ev(2))).status).toBe("duplicate");
    expect(f.total()).toBe(1);
  });
  it("rejects unknown or malformed video ids", async () => {
    const f = fakeDeps();
    expect((await recordView(f.deps, { ...ev(1), videoId: "33333333-3333-4333-8333-333333333333" })).status).toBe("invalid");
    expect((await recordView(f.deps, { ...ev(2), videoId: "not-a-uuid" })).status).toBe("invalid");
    expect(f.total()).toBe(0);
  });
  it("rate limits more than 30 events per minute from one address", async () => {
    const f = fakeDeps();
    const r = [];
    for (let i = 0; i < 31; i++) r.push((await recordView(f.deps, ev(i, i))).status);
    expect(r.filter((s) => s === "accepted")).toHaveLength(30);
    expect(r[30]).toBe("rate_limited");
  });
  it("counts concurrent views from different viewers exactly, spread over shards", async () => {
    const f = fakeDeps();
    await Promise.all(Array.from({ length: 25 }, (_, i) => recordView(f.deps, ev(i, i, `ip${i}`))));
    expect(f.total()).toBe(25);
  });
  it("asks to retry (and counts nothing) when the cache is down", async () => {
    const f = fakeDeps({ cacheDown: true });
    expect((await recordView(f.deps, ev(1))).status).toBe("retry");
    expect(f.total()).toBe(0);
  });
  it("a failed database write can be retried with the same event and counts once", async () => {
    const f = fakeDeps({ dbFailTimes: 1 });
    expect((await recordView(f.deps, ev(1))).status).toBe("retry");
    expect((await recordView(f.deps, ev(1))).status).toBe("accepted");
    expect((await recordView(f.deps, ev(1))).status).toBe("duplicate");
    expect(f.total()).toBe(1);
  });
  it("reconciles totals from stored base, old count and shards", () => {
    expect(totalViews(5, 7, [1, 2, 3])).toBe(18);
  });
});
