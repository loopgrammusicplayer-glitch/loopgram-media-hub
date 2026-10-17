// Scalable video catalogue logic (search index, related videos, counters, reindex).
// Pure of any I/O: everything goes through the small `Store` interface so it is unit-tested
// against an in-memory store with >5,000 synthetic videos, and runs on DynamoDB in production
// (adapter in catalog.server.ts). No function here ever loads the whole catalogue.
import { score, tokenize } from "./search.core";

export type Doc = { pk: string; sk: string; [attr: string]: any };
export type Key = { pk: string; sk: string };

export interface Store {
  get(key: Key): Promise<Doc | null>;
  /** Items of one partition, newest (highest sk) first, optionally only sk < before. */
  query(pk: string, opts: { before?: string | undefined; limit: number }): Promise<Doc[]>;
  getMany(keys: Key[]): Promise<Doc[]>;
  putMany(items: Doc[]): Promise<void>;
  deleteMany(keys: Key[]): Promise<void>;
  add(key: Key, deltas: Record<string, number>): Promise<void>;
  put(item: Doc): Promise<void>;
  /** Atomically write `next` only if the stored copy still has `prevUpdatedAt` (null = must not exist),
   * and in the same transaction add `deltas` to the stats item. Throws ConflictError otherwise. */
  commit(next: Doc, prevUpdatedAt: string | null, deltas: Record<string, number>): Promise<void>;
}
export class ConflictError extends Error {
  constructor() { super("This video was changed at the same time somewhere else. Please try again."); }
}

export const CATALOG = {
  SHARDS: 4, // each word/category index is spread over 4 partitions so popular words don't create one hot key
  MAX_TERMS: 64,
  PAGE: 12,
  ROUNDS: 5, // bounded index reads per search request
  RELATED: 20,
  REINDEX_PAGE: 100,
} as const;
export const STATS_KEY: Key = { pk: "STATS", sk: "videos" };
export const VIEW_SHARDS = 10;

const STOP = new Set(["the", "and", "for", "you", "with", "this", "that", "are", "was", "from", "of", "to", "in", "on", "is", "it", "at", "by", "an", "or", "be", "as"]);

/** Every distinct searchable word of a video (title, description, category, channel, tags), capped. */
export function videoTerms(v: Doc): string[] {
  const text = [v["title"], v["description"], v["category"], v["channel"], ...(Array.isArray(v["tags"]) ? v["tags"] : [])].filter(Boolean).join(" ");
  const out = new Set<string>();
  for (const t of text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u)) {
    if (t.length >= 2 && t.length <= 40 && !STOP.has(t)) out.add(t);
    if (out.size >= CATALOG.MAX_TERMS) break;
  }
  return [...out];
}

export function shardOf(sk: string): number {
  let h = 2166136261;
  for (let i = 0; i < sk.length; i++) h = Math.imul(h ^ sk.charCodeAt(i), 16777619);
  return (h >>> 0) % CATALOG.SHARDS;
}
const termPk = (t: string, n: number) => `TERM#${t}#${n}`;
const catPk = (c: string, n: number) => `VCAT#${c}#${n}`;
const isLive = (v: Doc | null | undefined): v is Doc => !!v && !v["deleted"];
const isPublished = (v: Doc | null | undefined): v is Doc => isLive(v) && v["status"] !== "draft" && !!v["videoUrl"];

/** Index rows for one video: one per word + one category row. Rows carry the status so readers can skip drafts cheaply. */
export function indexRows(v: Doc): Doc[] {
  if (!isLive(v)) return [];
  const n = shardOf(v.sk);
  const base = { sk: v.sk, vid: v["vid"], status: v["status"] === "draft" ? "draft" : "published", type: "vidx" };
  const rows = videoTerms(v).map((t) => ({ pk: termPk(t, n), ...base }));
  if (v["category"]) rows.push({ pk: catPk(String(v["category"]), n), ...base });
  return rows;
}

export function statsDelta(prev: Doc | null, next: Doc | null): Record<string, number> {
  const c = (v: Doc | null) => isLive(v) ? { total: 1, published: v["status"] === "draft" ? 0 : 1, draft: v["status"] === "draft" ? 1 : 0 } : { total: 0, published: 0, draft: 0 };
  const a = c(prev), b = c(next);
  const d: Record<string, number> = {};
  for (const k of ["total", "published", "draft"] as const) if (b[k] - a[k]) d[k] = b[k] - a[k];
  return d;
}

/** Bring index rows from `prev` to `next`: delete words that disappeared, (re)write current rows. Idempotent. */
export async function syncIndex(store: Store, prev: Doc | null, next: Doc | null) {
  const keep = new Set((next ? indexRows(next) : []).map((r) => r.pk));
  const stale = (prev ? indexRows(prev) : []).filter((r) => !keep.has(r.pk)).map((r) => ({ pk: r.pk, sk: r.sk }));
  if (stale.length) await store.deleteMany(stale);
  if (next && isLive(next)) await store.putMany(indexRows(next));
}

const ytId = (url: unknown) => /youtube\.com\/watch\?v=([\w-]{11})$/.exec(String(url ?? ""))?.[1] ?? null;

/** Save a video: atomic write + counter change, then pointers and index. Index failures are queued for repair, never lost. */
export async function writeVideo(store: Store, prev: Doc | null, next: Doc) {
  await store.commit(next, prev ? (prev["updatedAt"] ?? "") : null, statsDelta(prev, next));
  const ptrs: Doc[] = [{ pk: "VIDPTR", sk: next["vid"], vsk: next.sk, type: "vidptr" }];
  const yt = ytId(next["videoUrl"]);
  if (yt) ptrs.push({ pk: "YTURL", sk: yt, vid: next["vid"], vsk: next.sk, type: "vidptr" });
  try {
    await store.putMany(ptrs);
    await syncIndex(store, prev, next);
  } catch (e) {
    await store.put({ pk: "IDXDIRTY", sk: next.sk, at: new Date().toISOString(), type: "idxdirty" }).catch(() => {});
    throw e;
  }
}

/** Delete: soft-delete + counter change atomically (so a retry can't double-count), then remove index and rows. */
export async function removeVideo(store: Store, prev: Doc) {
  if (prev["deleted"]) return;
  const tomb = { ...prev, deleted: true, updatedAt: new Date().toISOString() };
  await store.commit(tomb, prev["updatedAt"] ?? "", statsDelta(prev, null));
  await syncIndex(store, prev, null);
  const keys: Key[] = [{ pk: prev.pk, sk: prev.sk }, { pk: "VIDPTR", sk: prev["vid"] }];
  const yt = ytId(prev["videoUrl"]);
  if (yt) keys.push({ pk: "YTURL", sk: yt });
  await store.deleteMany(keys);
}

async function newestAcrossShards(store: Store, pk: (n: number) => string, before: string | undefined, limit: number) {
  const parts = await Promise.all(Array.from({ length: CATALOG.SHARDS }, (_, n) => store.query(pk(n), { before, limit })));
  const seen = new Set<string>();
  return parts.flat().sort((a, b) => (a.sk < b.sk ? 1 : -1)).filter((r) => !seen.has(r.sk) && seen.add(r.sk));
}

/** Word search over the index. Uses the most selective (longest) word to walk candidates newest-first,
 * verifies every word against the real video row, and pages with an sk cursor. Bounded reads per call. */
export async function searchVideos(store: Store, q: string, cursor?: string, limit: number = CATALOG.PAGE) {
  const terms = tokenize(q).filter((t) => !STOP.has(t));
  if (!terms.length) return { videos: [] as Doc[], next: null as string | null };
  const lead = [...terms].sort((a, b) => b.length - a.length)[0]!;
  const out: Doc[] = [];
  let before = cursor;
  let exhausted = false;
  for (let round = 0; round < CATALOG.ROUNDS && out.length < limit && !exhausted; round++) {
    const rows = await newestAcrossShards(store, (n) => termPk(lead, n), before, limit * 2);
    const page = rows.slice(0, limit * 2);
    if (page.length < limit * 2) exhausted = true;
    const live = page.filter((r) => r["status"] !== "draft");
    const docs = new Map((await store.getMany(live.map((r) => ({ pk: "VIDEO", sk: r.sk })))).map((d) => [d.sk, d]));
    for (const r of page) {
      const v = docs.get(r.sk);
      before = r.sk;
      if (isPublished(v) && score(terms, v["title"] ?? "", v["description"] ?? "", v["category"] ?? "", v["channel"] ?? "") > 0) out.push(v);
      if (out.length >= limit) break;
    }
    if (!page.length) exhausted = true;
  }
  return { videos: out, next: exhausted && out.length < limit ? null : (before ?? null) };
}

/** Related: small candidate set from the same category + the video's title words, ranked, current video excluded. */
export async function relatedVideos(store: Store, cur: Doc, limit: number = CATALOG.RELATED) {
  const words = videoTerms({ pk: "", sk: "", title: cur["title"] }).sort((a, b) => b.length - a.length).slice(0, 3);
  const lists = await Promise.all([
    cur["category"] ? newestAcrossShards(store, (n) => catPk(String(cur["category"]), n), undefined, 15) : Promise.resolve([]),
    ...words.map((w) => newestAcrossShards(store, (n) => termPk(w, n), undefined, 8)),
  ]);
  const sks = [...new Set(lists.flat().filter((r) => r["status"] !== "draft" && r.sk !== cur.sk).map((r) => r.sk))].slice(0, 100);
  const docs = (await store.getMany(sks.map((sk) => ({ pk: "VIDEO", sk })))).filter((d) => isPublished(d) && d["vid"] !== cur["vid"]);
  const cw = new Set(videoTerms({ pk: "", sk: "", title: cur["title"], description: cur["description"] }));
  return docs
    .map((v) => {
      let s = v["category"] === cur["category"] ? 10 : 0;
      for (const w of videoTerms({ pk: "", sk: "", title: v["title"], description: v["description"] })) if (cw.has(w)) s += 2;
      return { v, s };
    })
    .sort((a, b) => b.s - a.s || (a.v.sk < b.v.sk ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.v);
}

export async function hasCategoryVideos(store: Store, category: string) {
  const rows = await newestAcrossShards(store, (n) => catPk(category, n), undefined, 1);
  return rows.length > 0;
}

export async function readStats(store: Store) {
  const [s, ...shards] = await Promise.all([store.get(STATS_KEY), ...Array.from({ length: VIEW_SHARDS }, (_, n) => store.get({ pk: "STATSVIEWS", sk: String(n) }))]);
  const shardSum = shards.reduce((a, x) => a + Number(x?.["n"] ?? 0), 0);
  return {
    total: Math.max(0, Number(s?.["total"] ?? 0)),
    published: Math.max(0, Number(s?.["published"] ?? 0)),
    draft: Math.max(0, Number(s?.["draft"] ?? 0)),
    views: Math.max(0, Number(s?.["views"] ?? 0) + shardSum - Number(s?.["viewsShardBase"] ?? 0)),
    recountedAt: (s?.["recountedAt"] as string | undefined) ?? null,
  };
}

/** Repair/recount, one bounded page per call: rewrites pointers + index rows and tallies counts into a run item.
 * The last page replaces the live stats with the exact tally. Safe to re-run any time (idempotent writes). */
export async function reindexPage(store: Store, runId: string, cursor: string | undefined, viewsOf?: (docs: Doc[]) => Promise<number[]>) {
  // Repair queue first: videos whose index update failed earlier.
  const dirty = await store.query("IDXDIRTY", { limit: 25 });
  if (dirty.length) {
    const docs = await store.getMany(dirty.map((d) => ({ pk: "VIDEO", sk: d.sk })));
    for (const d of docs) await syncIndex(store, null, d);
    await store.deleteMany(dirty.map((d) => ({ pk: d.pk, sk: d.sk })));
  }
  const page = await store.query("VIDEO", { before: cursor, limit: CATALOG.REINDEX_PAGE });
  const live = page.filter(isLive);
  const ptrs: Doc[] = live.flatMap((v) => {
    const p: Doc[] = [{ pk: "VIDPTR", sk: v["vid"], vsk: v.sk, type: "vidptr" }];
    const yt = ytId(v["videoUrl"]);
    if (yt) p.push({ pk: "YTURL", sk: yt, vid: v["vid"], vsk: v.sk, type: "vidptr" });
    return p;
  });
  if (ptrs.length) await store.putMany(ptrs);
  await store.putMany(live.flatMap(indexRows));
  const views = viewsOf ? (await viewsOf(live)).reduce((a, b) => a + b, 0) : 0;
  const run: Key = { pk: "STATSRUN", sk: runId };
  const d = live.reduce((acc, v) => { const x = statsDelta(null, v); for (const k in x) acc[k] = (acc[k] ?? 0) + x[k]!; return acc; }, { views } as Record<string, number>);
  await store.add(run, { ...d, pages: 1 });
  const next = page.length === CATALOG.REINDEX_PAGE ? page[page.length - 1]!.sk : null;
  if (!next) {
    const r = await store.get(run);
    const shards = await Promise.all(Array.from({ length: VIEW_SHARDS }, (_, n) => store.get({ pk: "STATSVIEWS", sk: String(n) })));
    await store.put({
      ...STATS_KEY, type: "stats",
      total: Number(r?.["total"] ?? 0), published: Number(r?.["published"] ?? 0), draft: Number(r?.["draft"] ?? 0),
      views: Number(r?.["views"] ?? 0), viewsShardBase: shards.reduce((a, x) => a + Number(x?.["n"] ?? 0), 0),
      recountedAt: new Date().toISOString(),
    });
    await store.deleteMany([run]);
  }
  return { processed: live.length, next };
}
