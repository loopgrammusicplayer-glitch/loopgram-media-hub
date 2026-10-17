// View-counting policy + logic. Pure: all storage is injected, so it is unit-tested without real services.
// POLICY: a view counts once per viewer per video per DEDUPE window, only after PLAY_SECONDS of real playback.

export const VIEW_POLICY = {
  PLAY_SECONDS: 0.0002, // client sends the event only after this much playback (0.20 ms)
  DEDUPE_SECONDS: 30 * 60, // same viewer + same video counts at most once per 30 min
  EVENT_TTL_SECONDS: 24 * 3600, // replay protection for an event id
  RATE_LIMIT_PER_MIN: 30, // max view events per network address per minute
  SHARDS: 10, // durable counter spread across 10 database items per video (avoids one hot item)
  DISPLAY_TTL_SECONDS: 30, // shown totals may lag durable totals by up to this long
} as const;

export type ViewStatus = "accepted" | "duplicate" | "rate_limited" | "invalid" | "retry";
export type Metric = ViewStatus | "failed";

export interface ViewDeps {
  /** Set key only if absent, with expiry. true = set now, false = already existed. Throws if cache is down. */
  setOnce(key: string, ttlSec: number): Promise<boolean>;
  /** Increment with expiry, returns new value. Throws if cache is down. */
  incrWindow(key: string, ttlSec: number): Promise<number>;
  /** Durable add of 1 to a counter shard. Throws on failure. */
  addDurable(videoId: string, shard: number): Promise<void>;
  /** Remove keys (used to undo dedupe marks when the durable write fails, so a retry can succeed). */
  release(...keys: string[]): Promise<void>;
  videoIsPublished(videoId: string): Promise<boolean>;
  metric(m: Metric): void;
  random(): number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function recordView(
  deps: ViewDeps,
  input: { videoId: string; eventId: string; viewerId: string; ipHash: string },
): Promise<{ status: ViewStatus }> {
  const done = (status: ViewStatus) => (deps.metric(status), { status });
  if (!UUID.test(input.videoId) || !UUID.test(input.eventId) || !UUID.test(input.viewerId)) return done("invalid");

  let cacheUp = true;
  try {
    // Abuse controls. If the cache is down we cannot dedupe safely, so ask the client to retry
    // later rather than risk counting refreshes many times.
    if ((await deps.incrWindow(`vr:${input.ipHash}`, 60)) > VIEW_POLICY.RATE_LIMIT_PER_MIN) return done("rate_limited");
    if (!(await deps.setOnce(`ve:${input.eventId}`, VIEW_POLICY.EVENT_TTL_SECONDS))) return done("duplicate");
  } catch {
    cacheUp = false;
  }
  if (!cacheUp) return done("retry");

  if (!(await deps.videoIsPublished(input.videoId))) return done("invalid");

  try {
    if (!(await deps.setOnce(`vd:${input.videoId}:${input.viewerId}`, VIEW_POLICY.DEDUPE_SECONDS))) return done("duplicate");
  } catch {
    return done("retry");
  }

  try {
    await deps.addDurable(input.videoId, Math.floor(deps.random() * VIEW_POLICY.SHARDS));
  } catch {
    deps.metric("failed");
    await deps.release(`ve:${input.eventId}`, `vd:${input.videoId}:${input.viewerId}`).catch(() => {});
    return { status: "retry" }; // nothing durable written; client may retry with the SAME event id
  }
  return done("accepted");
}

/** Shown total = original stored count + old cache-only count (pre-upgrade) + all durable shards. */
export function totalViews(base: number, legacy: number, shards: number[]) {
  return base + legacy + shards.reduce((a, b) => a + b, 0);
}
