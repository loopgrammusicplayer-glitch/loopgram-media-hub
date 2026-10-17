import { describe, expect, it } from "vitest";
import { burstRps, createAdmission, persistLike } from "./likes.core";

describe("like integrity and overload", () => {
  it("confirms only after durable write resolves", async () => {
    let finish: (() => void) | undefined;
    let confirmed = false;
    const result = persistLike({ putOnce: () => new Promise<void>(r => { finish = r; }) }).then(r => { confirmed = true; return r; });
    await Promise.resolve();
    expect(confirmed).toBe(false);
    finish?.();
    expect((await result).status).toBe("confirmed");
  });
  it("never confirms an uncertain write", async () => {
    expect((await persistLike({ putOnce: async () => { throw new Error("timeout"); } })).status).toBe("retry");
  });
  it("retries preserve one durable record", async () => {
    const records = new Set<string>();
    const store = { putOnce: async () => { records.add("same-video:same-user"); } };
    await Promise.all(Array.from({ length: 100 }, () => persistLike(store)));
    expect(records.size).toBe(1);
  });
  it("rejects overload without creating a waiting queue", () => {
    const gate = createAdmission(2);
    const release = gate.enter();
    expect(gate.enter()).not.toBeNull();
    expect(gate.enter()).toBeNull();
    release?.(); release?.();
    expect(gate.enter()).not.toBeNull();
    expect(gate.enter()).toBeNull();
  });
  it("treats five billion as a target and computes burst load", () => {
    expect(burstRps(1)).toBe(5_000_000_000);
    expect(burstRps(60)).toBeCloseTo(83_333_333.33333333);
    expect(burstRps(3600)).toBeCloseTo(1_388_888.888888889);
  });
});