export type LikeResult = { status: "confirmed" | "retry" | "sign_in" | "unavailable"; retryAfterSeconds?: number; liked?: boolean; count?: number; disliked?: boolean; dislikes?: number };
export interface LikeStore { putOnce: () => Promise<void> }

// A conditional durable insert is the only confirmation boundary. No optimistic count.
export async function persistLike(store: LikeStore): Promise<LikeResult> {
  try {
    await store.putOnce();
    return { status: "confirmed" };
  } catch {
    // A timeout may have committed: retry the same deterministic key.
    return { status: "retry", retryAfterSeconds: 10 };
  }
}

// Per-isolate admission only: no waiting queue, no global-capacity claim.
export function createAdmission(max: number) {
  let active = 0;
  return {
    enter(): (() => void) | null {
      if (active >= max) return null;
      active++;
      let released = false;
      return () => { if (!released) { released = true; active--; } };
    },
  };
}

export const LIKE_CAPACITY_TARGET = 5_000_000_000;
export function burstRps(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Invalid burst duration");
  return LIKE_CAPACITY_TARGET / seconds;
}