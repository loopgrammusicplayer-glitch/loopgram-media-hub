import { createServerFn } from "@tanstack/react-start";
import { firebaseWebConfig } from "./firebase-config.core";
import { executeMediaDeletion, mediaDeletionPlan, postThumbnail } from "./media.core";
import { SEARCH, isValidCursor, score, searchCacheKey, tokenize } from "./search.core";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { CONTENT_KINDS, MEDIA_URL_RE, isYoutube, kindOf, parseGallery, safeLink, type ContentKind, type GalleryItem } from "./content.core";

export const DEFAULT_CATEGORIES = ["Music", "Gaming", "News", "Sports", "Comedy", "Education", "Tech", "Movies", "Fashion", "Advertisements", "Sponsored", "Lifestyle", "Creators", "Business", "TV Shows"];
export const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Subtitle tracks are stored as a JSON string attribute; broken data means no tracks. */
function parseSubTracks(raw: unknown): { lang: string; label: string; url: string }[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a)
      ? a.filter((x) => x && typeof x.url === "string").map((x) => ({ lang: String(x.lang ?? "en").slice(0, 10), label: String(x.label ?? x.lang ?? "Subtitles").slice(0, 40), url: String(x.url) })).slice(0, 20)
      : [];
  } catch { return []; }
}

export type Status = "published" | "draft";
export type Video = {
  id: string;
  sk: string;
  title: string;
  description: string;
  category: string; // category id
  videoUrl: string;
  thumbUrl: string | null;
  /** Manual subtitle tracks (uploaded .srt/.vtt in R2). Required to publish non-YouTube videos. */
  subtitles?: { lang: string; label: string; url: string }[];
  views: number;
  status: Status;
  createdAt: string;
  /** Set for imported YouTube videos (real channel name from YouTube). */
  channel?: string;
};
export type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverUrl: string | null;
  category: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  featured: boolean;
  status: Status;
  createdAt: string;
  updatedAt: string;
  kind: ContentKind;
  linkUrl: string;
  mediaUrl: string | null;
  mediaName: string;
  gallery: GalleryItem[];
};
export type Category = { id: string; name: string; order: number };

const tokenSchema = z.object({ token: z.string().min(10) });

/** Stored media links keep the old r2.dev address; serve them from the current R2_PUBLIC_URL (e.g. a custom domain) without rewriting data. */
const R2_DEV = "https://pub-ced3f1a2664748f5aa4da50e138d60e3.r2.dev";
function mediaUrl<T extends string | null>(u: T): T {
  const base = process.env["R2_PUBLIC_URL"]?.trim().replace(/\/$/, "");
  return (u && base && base !== R2_DEV && u.startsWith(R2_DEV + "/") ? base + u.slice(R2_DEV.length) : u) as T;
}


/** Let browsers/Cloudflare briefly reuse public, non-personal read responses (bounded staleness after edits). */
function publicCache() {
  try { setResponseHeader("Cache-Control", "public, max-age=15, s-maxage=60, stale-while-revalidate=300"); } catch { /* not in a request */ }
}

export const getFirebaseConfig = createServerFn({ method: "GET" }).handler(async () => ({
  ...firebaseWebConfig(process.env["FIREBASE_API_KEY"]?.trim()),
  measurementId: process.env["GOOGLE_ANALYTICS_MEASUREMENT_ID"]?.trim() ?? "",
}));

export const getMe = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { verifyUser } = await import("./backend.server");
    return verifyUser(data.token);
  });

const ownerOnly = async (token: string) => {
  const { verifyUser } = await import("./backend.server");
  const u = await verifyUser(token);
  if (u.role !== "owner") throw new Error("Owner access required");
  return u;
};

// ---------- generic single-partition records (PK = group, SK = id) ----------
type Attr = string | number | boolean | string[];
async function putRecord(group: string, id: string, attrs: Record<string, Attr>) {
  const { ddb, tableKeys } = await import("./backend.server");
  const k = await tableKeys();
  const item: Record<string, any> = { type: { S: group.toLowerCase() } };
  for (const [a, v] of Object.entries(attrs)) {
    if (typeof v === "string") { if (v !== "") item[a] = { S: v }; }
    else if (typeof v === "number") item[a] = { N: String(v) };
    else if (typeof v === "boolean") item[a] = { BOOL: v };
    else if (v.length) item[a] = { SS: [...new Set(v)] };
  }
  if (k.range) { item[k.hash] = { S: group }; item[k.range] = { S: id }; }
  else item[k.hash] = { S: `${group}#${id}` };
  await ddb("PutItem", { Item: item });
}
async function listRecords(group: string, exhaustive = false): Promise<Record<string, any>[]> {
  const { ddb, tableKeys } = await import("./backend.server");
  const k = await tableKeys();
  const out: any[] = [];
  let start: any;
  do {
    const r: any = k.range
      ? await ddb("Query", { KeyConditionExpression: "#h = :v", ExpressionAttributeNames: { "#h": k.hash }, ExpressionAttributeValues: { ":v": { S: group } }, ScanIndexForward: false, ...(start ? { ExclusiveStartKey: start } : {}) })
      : await ddb("Scan", { FilterExpression: "#t = :v", ExpressionAttributeNames: { "#t": "type" }, ExpressionAttributeValues: { ":v": { S: group.toLowerCase() } }, ...(start ? { ExclusiveStartKey: start } : {}) });
    out.push(...(r.Items ?? []).filter((i: any) => !i.deleted?.BOOL));
    start = r.LastEvaluatedKey;
  } while (start && (exhaustive || out.length < 5000));
  return out.map((i) => {
    const o: Record<string, any> = { _id: k.range ? i[k.range].S : i[k.hash].S.split("#").slice(1).join("#") };
    for (const [a, v] of Object.entries<any>(i)) o[a] = v.S ?? (v.N !== undefined ? Number(v.N) : v.BOOL ?? v.SS ?? null);
    return o;
  });
}
/** Permanently remove one item. The AWS key may lack DeleteItem, but BatchWriteItem delete is allowed. */
async function ddbRemove(Key: Record<string, any>) {
  const { ddb } = await import("./backend.server");
  const table = process.env["DYNAMODB_TABLE_NAME"]!.trim();
  const r: any = await ddb("BatchWriteItem", { TableName: undefined, RequestItems: { [table]: [{ DeleteRequest: { Key } }] } });
  if (Object.keys(r?.UnprocessedItems ?? {}).length) throw new Error("The database was busy — please try deleting again.");
}
async function deleteRecord(group: string, id: string) {
  const { ddb, tableKeys } = await import("./backend.server");
  const k = await tableKeys();
  const Key: Record<string, any> = k.range ? { [k.hash]: { S: group }, [k.range]: { S: id } } : { [k.hash]: { S: `${group}#${id}` } };
  await ddbRemove(Key);
}
async function bust(...keys: string[]) {
  const { redis, forget } = await import("./backend.server");
  forget(...keys);
  // Bump the catalogue version so every cached search result is orphaned at once (runs only after the durable write).
  await Promise.all([redis("DEL", ...keys), redis("INCR", "catalog:ver")]).catch(() => {});
}

// ---------- Categories ----------
async function loadCategories(): Promise<Category[]> {
  const { cached } = await import("./backend.server");
  return cached("cats:all", 300, async () => {
    const rows = await listRecords("CATEGORY");
    if (!rows.length) return DEFAULT_CATEGORIES.map((n, i) => ({ id: slugify(n), name: n, order: i }));
    // A hidden marker row keeps an intentionally emptied list from reverting to defaults.
    return rows.filter((r) => r["_id"] !== CAT_MARKER).map((r) => ({ id: r["_id"], name: r["name"], order: Number(r["order"] ?? 0) })).sort((a, b) => a.order - b.order);
  });
}
const CAT_MARKER = "__seeded";
async function seedCategories() {
  const existing = await listRecords("CATEGORY", true);
  if (existing.some((r) => r["_id"] === CAT_MARKER)) return;
  if (!existing.length) for (const c of await loadCategories()) await putRecord("CATEGORY", c.id, { name: c.name, order: c.order });
  await putRecord("CATEGORY", CAT_MARKER, { name: "", order: 999 });
}
export const listCategories = createServerFn({ method: "GET" }).handler(async () => {
  publicCache();
  try { return await loadCategories(); } catch { return DEFAULT_CATEGORIES.map((n, i) => ({ id: slugify(n), name: n, order: i })); }
});
export const saveCategory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ id: z.string().max(80).optional(), name: z.string().trim().min(1).max(60), order: z.number().int().min(0).max(998) }).parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    await seedCategories();
    // The id never changes on rename, so posts/videos keep their category link.
    const id = data.id || slugify(data.name) || crypto.randomUUID().slice(0, 8);
    if (id === CAT_MARKER) throw new Error("Invalid category name.");
    await putRecord("CATEGORY", id, { name: data.name, order: data.order });
    await bust("cats:all");
    return { id };
  });
export const deleteCategory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ id: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    if (data.id === CAT_MARKER) throw new Error("Invalid category.");
    await seedCategories();
    // Linked videos/posts keep their records and still appear under "All".
    await deleteRecord("CATEGORY", data.id);
    await bust("cats:all");
    return { ok: true };
  });

// ---------- Videos ----------
async function loadVideos(fresh = false): Promise<Video[]> {
  const { cached, tableKeys } = await import("./backend.server");
  const load = async () => {
    const k = await tableKeys();
    const rows = await listRecords("VIDEO", fresh);
    return rows.map((i) => ({
      id: i["vid"],
      sk: k.range ? i["_id"] : `VIDEO#${i["_id"]}`,
      title: i["title"] ?? "",
      description: i["description"] ?? "",
      category: slugify(i["category"] ?? ""),
      videoUrl: mediaUrl(i["videoUrl"] ?? ""),
      thumbUrl: mediaUrl(i["thumbUrl"] ?? null),
      subtitles: parseSubTracks(i["subtitles"]),
      views: Number(i["views"] ?? 0),
      status: (i["status"] === "draft" ? "draft" : "published") as Status,
      createdAt: i["createdAt"] ?? "",
      ...(i["channel"] ? { channel: i["channel"] as string } : {}),
    }));
  };
  return fresh ? load() : cached("videos:all", 60, load);
}
// Shown totals = stored base + legacy cache-only count + durable shards (see views.core.ts). Cached 30 s.
function shardKey(k: { hash: string; range?: string | undefined }, vid: string, n: number) {
  const key: Record<string, any> = { [k.hash]: { S: `VIEWS#${vid}#${n}` } };
  if (k.range) key[k.range] = { S: "count" };
  return key;
}
async function withViews(list: Video[]) {
  if (!list.length) return list;
  const { redis, ddb, tableKeys } = await import("./backend.server");
  const { VIEW_POLICY, totalViews } = await import("./views.core");
  const ids = list.map((v) => v.id);
  const [legacy, hot] = await Promise.all([
    redis<(string | null)[]>("MGET", ...ids.map((id) => `views:${id}`)).catch(() => null),
    redis<(string | null)[]>("MGET", ...ids.map((id) => `vt:${id}`)).catch(() => null),
  ]);
  const durable = new Map<string, number>();
  ids.forEach((id, i) => { if (hot?.[i] != null) durable.set(id, Number(hot[i])); });
  const missing = ids.filter((id) => !durable.has(id));
  if (missing.length) {
    try {
      const k = await tableKeys();
      const per = Math.floor(100 / VIEW_POLICY.SHARDS);
      for (let i = 0; i < missing.length; i += per) {
        const chunk = missing.slice(i, i + per);
        const sums = new Map(chunk.map((id) => [id, 0]));
        let req: any = { [process.env["DYNAMODB_TABLE_NAME"]!.trim()]: { Keys: chunk.flatMap((id) => Array.from({ length: VIEW_POLICY.SHARDS }, (_, n) => shardKey(k, id, n))) } };
        for (let tries = 0; req && Object.keys(req).length && tries < 5; tries++) {
          const r: any = await ddb("BatchGetItem", { TableName: undefined, RequestItems: req });
          for (const items of Object.values<any[]>(r.Responses ?? {})) for (const it of items) {
            const id = String(it[k.hash].S).split("#")[1]!;
            sums.set(id, (sums.get(id) ?? 0) + Number(it["n"]?.N ?? 0));
          }
          req = r.UnprocessedKeys;
        }
        for (const [id, n] of sums) {
          // Never publish/cache a partial total when DynamoDB left unread shards.
          if (!req || !Object.keys(req).length) {
            durable.set(id, n);
            await redis("SET", `vt:${id}`, n, "EX", VIEW_POLICY.DISPLAY_TTL_SECONDS).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.error("view totals read failed", (e as Error).message);
    }
  }
  return list.map((v, i) => ({ ...v, views: totalViews(v.views, Number(legacy?.[i] ?? 0), [durable.get(v.id) ?? 0]) }));
}

/** Public: published videos only, newest first, cursor-paginated straight from the database
 * (sort key starts with the upload time, so the table's own order is newest-first). Reads only what one page needs. */
const PAGE_SIZE = 24;
export const listVideos = createServerFn({ method: "GET" })
  .inputValidator((d: { category?: string; cursor?: string | undefined }) => z.object({ category: z.string().max(80).optional(), cursor: z.string().max(200).refine(isValidCursor, "Invalid cursor").optional() }).parse(d))
  .handler(async ({ data }): Promise<{ videos: Video[]; next: string | null; error?: string }> => {
    publicCache();
    try {
      const { ddb, tableKeys } = await import("./backend.server");
      const k = await tableKeys();
      const c = data.category && data.category !== "all" ? data.category : null;
      if (!k.range) {
        // Legacy single-key table: fall back to the cached catalogue.
        const all = (await loadVideos()).filter((v) => v.status === "published" && !!v.videoUrl && (!c || v.category === c));
        const off = Number(data.cursor ?? 0) || 0;
        return { videos: await withViews(all.slice(off, off + PAGE_SIZE)), next: off + PAGE_SIZE < all.length ? String(off + PAGE_SIZE) : null };
      }
      const out: Video[] = [];
      let start: any = data.cursor ? { [k.hash]: { S: "VIDEO" }, [k.range]: { S: data.cursor } } : undefined;
      let more = true;
      // Bounded: at most 8 small reads per request even when a category is rare.
      for (let i = 0; i < 8 && out.length < PAGE_SIZE && more; i++) {
        const r: any = await ddb("Query", {
          KeyConditionExpression: "#h = :v",
          FilterExpression: "#s = :p AND attribute_exists(videoUrl) AND (attribute_not_exists(deleted) OR deleted = :f)",
          ExpressionAttributeNames: { "#h": k.hash, "#s": "status" },
          ExpressionAttributeValues: { ":v": { S: "VIDEO" }, ":p": { S: "published" }, ":f": { BOOL: false } },
          ScanIndexForward: false,
          Limit: c ? 100 : PAGE_SIZE + 1,
          ...(start ? { ExclusiveStartKey: start } : {}),
        });
        for (const i of r.Items ?? []) {
          const v: Video = {
            id: i.vid?.S ?? "", sk: i[k.range].S, title: i.title?.S ?? "", description: i.description?.S ?? "",
            category: slugify(i.category?.S ?? ""), videoUrl: mediaUrl(i.videoUrl?.S ?? ""), thumbUrl: mediaUrl(i.thumbUrl?.S ?? null),
            views: Number(i.views?.N ?? 0), status: "published", createdAt: i.createdAt?.S ?? "",
            ...(i.channel?.S ? { channel: i.channel.S } : {}),
          };
          if (!v.id || !v.videoUrl || (c && v.category !== c)) continue;
          if (out.length < PAGE_SIZE) out.push(v); else { more = true; break; }
        }
        start = r.LastEvaluatedKey;
        more = !!start || out.length >= PAGE_SIZE;
        if (!start) break;
      }
      const last = out[out.length - 1];
      const next = out.length >= PAGE_SIZE && last ? last.sk : start ? (start[k.range].S as string) : null;
      return { videos: await withViews(out), next };
    } catch (e) {
      console.error(e);
      return { videos: [], next: null, error: "Videos are temporarily unavailable." };
    }
  });

// ---------- Search ----------
export type SearchVideo = Video;
export type SearchPost = Omit<Post, "body">;
export type SearchResult = { videos: SearchVideo[]; posts: SearchPost[]; next: number | null };


export const searchContent = createServerFn({ method: "GET" })
  .inputValidator((d: { q?: string; offset?: number }) =>
    z.object({ q: z.string().trim().max(100).default(""), offset: z.number().int().min(0).max(100000).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<SearchResult> => {
    // Identical queries are served by the CDN edge (60 s) before reaching the server at all.
    publicCache();
    const terms = tokenize(data.q);
    if (!terms.length) return { videos: [], posts: [], next: null };
    try {
      const { redis } = await import("./backend.server");
      const off = data.offset ?? 0;
      const ver = (await redis<string>("GET", "catalog:ver").catch(() => null)) ?? "0";
      const key = searchCacheKey(ver, terms, off);
      const hit = await redis<string>("GET", key).catch(() => null);
      if (hit) return JSON.parse(hit) as SearchResult;
      // Bounded: ranks the cached catalogue (capped at 5,000 rows) in memory — no per-query DynamoDB scan.
      const [vids, posts] = await Promise.all([loadVideos(), loadPosts()]);
      const rank = <T,>(xs: { x: T; s: number }[]) => xs.filter((r) => r.s > 0).sort((a, b) => b.s - a.s).map((r) => r.x);
      const mv = rank(vids.filter((v) => v.status === "published").map((v) => ({ x: v, s: score(terms, v.title, v.description, v.category) })));
      const mp = rank(posts.filter((p) => p.status === "published").map((p) => ({ x: p, s: score(terms, p.title, p.excerpt, p.category, p.tags) })));
      const per = SEARCH.perPage;
      const result: SearchResult = {
        videos: await withViews(mv.slice(off, off + per)),
        posts: mp.slice(off, off + per).map(stripBody),
        next: off + per < Math.max(mv.length, mp.length) ? off + per : null,
      };
      await redis("SET", key, JSON.stringify(result), "EX", SEARCH.cacheTtlSeconds).catch(() => {});
      return result;
    } catch (e) {
      console.error(e);
      return { videos: [], posts: [], next: null };
    }
  });

function itemToVideo(i: Record<string, any>, sk: string): Video {
  const g = (a: string) => i[a]?.S ?? (i[a]?.N !== undefined ? Number(i[a].N) : undefined);
  return {
    id: g("vid"), sk, title: g("title") ?? "", description: g("description") ?? "",
    category: slugify(g("category") ?? ""), videoUrl: mediaUrl(g("videoUrl") ?? ""), thumbUrl: mediaUrl(g("thumbUrl") ?? null),
    views: Number(g("views") ?? 0), status: g("status") === "draft" ? "draft" : "published", createdAt: g("createdAt") ?? "",
    subtitles: parseSubTracks(g("subtitles")),
    ...(g("channel") ? { channel: g("channel") as string } : {}),
  };
}
/** Direct lookup: id -> VIDPTR pointer item (GetItem) -> VIDEO item (GetItem). Two key reads, no catalogue scan.
 * Videos saved before pointers existed fall back to the catalogue once, then get a pointer written (additive, idempotent). */
async function lookupVideo(id: string): Promise<Video | null> {
  const { ddb, tableKeys, cached } = await import("./backend.server");
  return cached(`video:${id}`, 60, async () => {
    const k = await tableKeys();
    if (k.range) {
      const p: any = await ddb("GetItem", { Key: { [k.hash]: { S: "VIDPTR" }, [k.range]: { S: id } } });
      const sk = p.Item?.sk?.S as string | undefined;
      if (sk) {
        const r: any = await ddb("GetItem", { Key: { [k.hash]: { S: "VIDEO" }, [k.range]: { S: sk } } });
        return r.Item && !r.Item.deleted?.BOOL ? itemToVideo(r.Item, sk) : null;
      }
    } else {
      const r: any = await ddb("GetItem", { Key: { [k.hash]: { S: `VIDEO#${id}` } } });
      if (r.Item && !r.Item.deleted?.BOOL) return itemToVideo(r.Item, `VIDEO#${id}`);
    }
    const v = (await loadVideos()).find((x) => x.id === id) ?? null;
    if (v && k.range) await putRecord("VIDPTR", id, { sk: v.sk }).catch((e) => console.error("pointer backfill failed", (e as Error).message));
    return v;
  });
}

export const getVideo = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    publicCache();
    const v = await lookupVideo(data.id);
    return v && v.status === "published" ? (await withViews([v]))[0]! : null;
  });

/** Public: real related videos — same category and shared title/description words score higher, then freshness. */
export const listRelated = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<Video[]> => {
    publicCache();
    try {
      const { cached } = await import("./backend.server");
      // Scoring scans the catalogue; cache the picked list per video so busy pages don't redo it.
      const scored = await cached(`rel:${data.id}`, 60, async (): Promise<Video[]> => {
      const all = (await loadVideos()).filter((v) => v.status === "published");
      const cur = all.find((v) => v.id === data.id);
      if (!cur) return [] as Video[];
      const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
      const cw = words(`${cur.title} ${cur.description}`);
      return all
        .filter((v) => v.id !== cur.id)
        .map((v) => {
          let s = v.category === cur.category ? 10 : 0;
          for (const w of words(`${v.title} ${v.description}`)) if (cw.has(w)) s += 2;
          return { v, s, t: Date.parse(v.createdAt) || 0 };
        })
        .sort((a, b) => b.s - a.s || b.t - a.t)
        .slice(0, 20)
        .map((x) => x.v);
      });
      return withViews(scored);
    } catch (e) {
      console.error(e);
      return [];
    }
  });

export const listAllVideos = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    return withViews(await loadVideos());
  });

/** Owner Studio: one page of videos (all statuses), newest first, straight from DynamoDB with a sort-key cursor.
 * Bounded reads per request; view totals only for the returned page. Never loads the whole catalogue. */
export const listStudioVideos = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({
    cursor: z.string().max(200).refine(isValidCursor, "Invalid cursor").optional(),
    status: z.enum(["all", "published", "draft"]).default("all"),
    limit: z.number().int().min(10).max(50).default(36),
  }).parse(d))
  .handler(async ({ data }): Promise<{ videos: Video[]; next: string | null }> => {
    await ownerOnly(data.token);
    const { ddb, tableKeys } = await import("./backend.server");
    const k = await tableKeys();
    const want = data.limit;
    if (!k.range) {
      const all = (await loadVideos()).filter((v) => data.status === "all" || v.status === data.status);
      const off = Number(data.cursor ?? 0) || 0;
      return { videos: await withViews(all.slice(off, off + want)), next: off + want < all.length ? String(off + want) : null };
    }
    const names: Record<string, string> = { "#h": k.hash };
    const values: Record<string, any> = { ":v": { S: "VIDEO" }, ":t": { BOOL: true } };
    let filter = "attribute_not_exists(deleted) OR deleted <> :t";
    if (data.status === "published") { filter = `(${filter}) AND (attribute_not_exists(#s) OR #s <> :d)`; names["#s"] = "status"; values[":d"] = { S: "draft" }; }
    if (data.status === "draft") { filter = `(${filter}) AND #s = :d`; names["#s"] = "status"; values[":d"] = { S: "draft" }; }
    const out: Video[] = [];
    let start: any = data.cursor ? { [k.hash]: { S: "VIDEO" }, [k.range]: { S: data.cursor } } : undefined;
    for (let i = 0; i < 10 && out.length < want; i++) {
      const r: any = await ddb("Query", {
        KeyConditionExpression: "#h = :v", FilterExpression: filter,
        ExpressionAttributeNames: names, ExpressionAttributeValues: values,
        ScanIndexForward: false, Limit: data.status === "all" ? want - out.length : 100,
        ...(start ? { ExclusiveStartKey: start } : {}),
      });
      for (const it of r.Items ?? []) {
        if (out.length >= want) break;
        const v = itemToVideo(it, it[k.range].S);
        if (v.id) out.push(v);
      }
      start = r.LastEvaluatedKey;
      if (!start) break;
    }
    const last = out[out.length - 1];
    const next = out.length >= want && last ? last.sk : start ? (start[k.range].S as string) : null;
    return { videos: await withViews(out), next };
  });

const viewMetrics = ["accepted", "duplicate", "rate_limited", "invalid", "retry", "failed"] as const;

/** Public: report a genuine playback (sent by the player after VIEW_POLICY.PLAY_SECONDS). Never trusts a client count. */
export const countView = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), eventId: z.string().uuid(), viewerId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data }) => {
    const b = await import("./backend.server");
    const { recordView } = await import("./views.core");
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const ip = getRequestHeader("cf-connecting-ip") || getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`loopgram-view:${ip}`));
    const ipHash = [...new Uint8Array(digest)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
    const hour = new Date().toISOString().slice(0, 13);
    const k = await b.tableKeys();
    const res = await recordView(
      {
        setOnce: async (key, ttl) => (await b.redis("SET", key, "1", "NX", "EX", ttl)) === "OK",
        incrWindow: async (key, ttl) => {
          const n = Number(await b.redis<number>("INCR", key));
          if (n === 1) await b.redis("EXPIRE", key, ttl);
          return n;
        },
        release: async (...keys) => { await b.redis("DEL", ...keys); },
        addDurable: async (vid, n) => {
          await b.ddb("UpdateItem", { Key: shardKey(k, vid, n), UpdateExpression: "ADD #n :one", ExpressionAttributeNames: { "#n": "n" }, ExpressionAttributeValues: { ":one": { N: "1" } } });
        },
        videoIsPublished: async (vid) => (await lookupVideo(vid))?.status === "published",
        metric: (m) => { b.redis("INCR", `vm:${m}:${hour}`).then(() => b.redis("EXPIRE", `vm:${m}:${hour}`, 8 * 86400)).catch(() => {}); },
        random: Math.random,
      },
      { videoId: data.id, eventId: data.eventId, viewerId: data.viewerId, ipHash },
    );
    return res;
  });

/** Owner: view event counts for the last 24 hours. */
export const getViewMetrics = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    const { redis } = await import("./backend.server");
    const hours = Array.from({ length: 24 }, (_, i) => new Date(Date.now() - i * 3600_000).toISOString().slice(0, 13));
    const out: Record<string, number> = {};
    for (const m of viewMetrics) {
      const vals = await redis<(string | null)[]>("MGET", ...hours.map((h) => `vm:${m}:${h}`)).catch(() => null);
      out[m] = (vals ?? []).reduce((a, v) => a + Number(v ?? 0), 0);
    }
    return out;
  });

const YT_URL_RE = /^https:\/\/(www\.youtube\.com\/watch\?v=[\w-]{11}|i\.ytimg\.com\/vi\/[\w-]{11}\/\w+\.jpg)$/;
const r2Url = z.string().url().refine((u) => MEDIA_URL_RE.test(u) || YT_URL_RE.test(u), "Invalid media URL");

/** Owner: add a YouTube video by link. Title/channel/thumbnail come from YouTube's public oEmbed (no API key). */
export const addYoutubeVideo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ url: z.string().max(500), category: z.string().max(80), id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    const { youtubeId } = await import("./content.core");
    const yt = youtubeId(data.url);
    if (!yt) throw new Error("That doesn't look like a YouTube video link.");
    const watch = `https://www.youtube.com/watch?v=${yt}`;
    const all = await loadVideos();
    const dupe = all.find((v) => v.videoUrl === watch || v.id === data.id);
    if (dupe) return { ok: true, id: dupe.id, title: dupe.title, existed: true };
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, { signal: AbortSignal.timeout(5000) }).catch(() => { throw new Error("YouTube didn't answer in time — please try again."); });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "This video's owner doesn't allow it to be played on other sites." : "YouTube couldn't find this video (it may be private or removed).");
    const o = (await r.json()) as { title?: string; author_name?: string };
    const { tableKeys } = await import("./backend.server");
    const k = await tableKeys();
    const createdAt = new Date().toISOString();
    await putRecord("VIDEO", k.range ? `${createdAt}#${data.id}` : data.id, {
      vid: data.id, title: (o.title ?? "YouTube video").slice(0, 150), description: "", category: data.category,
      videoUrl: watch, thumbUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, channel: (o.author_name ?? "").slice(0, 100),
      createdAt, views: 0, status: "published", updatedAt: createdAt,
    });
    await bust("videos:all");
    return { ok: true, id: data.id, title: o.title ?? "", existed: false };
  });

// ---------- Comments (signed-in users) ----------
export type Comment = { id: string; uid: string; name: string; picture: string | null; text: string; createdAt: string };
export const listComments = createServerFn({ method: "GET" })
  .inputValidator((d: { vid: string }) => z.object({ vid: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<Comment[]> => {
    const { cached } = await import("./backend.server");
    return cached(`cmts:${data.vid}`, 30, async () =>
      (await listRecords(`COMMENT#${data.vid}`))
        .filter((r) => !r["hidden"])
        .map((r) => ({ id: r["_id"], uid: r["uid"], name: r["name"] ?? "Loopgram user", picture: r["picture"] ?? null, text: r["text"] ?? "", createdAt: r["createdAt"] ?? "" }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200));
  });
export const addComment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ vid: z.string().uuid(), id: z.string().uuid(), text: z.string().trim().min(1).max(1000) }).parse(d))
  .handler(async ({ data }) => {
    const b = await import("./backend.server");
    const u = await b.verifyUser(data.token).catch(() => null);
    if (!u) throw new Error("Please sign in to comment.");
    if (!(await loadVideos()).some((v) => v.id === data.vid && v.status === "published")) throw new Error("Video not found");
    // Same client id on retry = same record (no duplicates). 1 new comment per 10 s per user.
    const first = await b.redis("SET", `cmt:dup:${data.id}`, "1", "NX", "EX", 86400).catch(() => "OK");
    if (first !== "OK") return { ok: true };
    const okRate = await b.redis("SET", `cmt:rate:${u.uid}`, "1", "NX", "EX", 10).catch(() => "OK");
    if (okRate !== "OK") { await b.redis("DEL", `cmt:dup:${data.id}`).catch(() => {}); throw new Error("You're commenting too fast. Wait a few seconds."); }
    const text = data.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    await putRecord(`COMMENT#${data.vid}`, data.id, {
      uid: u.uid, name: (u.name || u.email?.split("@")[0] || "Loopgram user").slice(0, 80), picture: u.picture ?? "", text, createdAt: new Date().toISOString(),
    });
    await bust(`cmts:${data.vid}`);
    return { ok: true };
  });
export const deleteComment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ vid: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const b = await import("./backend.server");
    const u = await b.verifyUser(data.token).catch(() => null);
    if (!u) throw new Error("Please sign in again.");
    const c = (await listRecords(`COMMENT#${data.vid}`)).find((r) => r["_id"] === data.id);
    if (!c) return { ok: true };
    if (c["uid"] !== u.uid && u.role !== "owner") throw new Error("You can only delete your own comments.");
    await deleteRecord(`COMMENT#${data.vid}`, data.id);
    await bust(`cmts:${data.vid}`);
    return { ok: true };
  });
export const reportComment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ vid: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const b = await import("./backend.server");
    const u = await b.verifyUser(data.token).catch(() => null);
    if (!u) throw new Error("Please sign in to report.");
    // One report per user per comment; the owner can review reports in Redis set `cmt:reports`.
    await b.redis("SADD", `cmt:reports`, `${data.vid}/${data.id}`).catch(() => {});
    await b.redis("SADD", `cmt:rep:${data.id}`, u.uid).catch(() => {});
    return { ok: true };
  });

/** Owner-only speech recognition for one short audio piece (≤ ~1 MB WAV). Errors containing "retry" are transient. */
export const transcribeChunk = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ audio: z.string().min(10).max(2_000_000) }).parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Automatic captions are not configured.");
    const bin = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append("file", new Blob([bin], { type: "audio/wav" }), "audio.wav");
    fd.append("model", "openai/gpt-transcribe");
    fd.append("prompt", "Song lyrics or speech from a music/video channel. Transcribe only words actually heard.");
    const r = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "X-Lovable-AIG-SDK": "fetch" }, body: fd });
    if (r.status === 429 || r.status >= 500) throw new Error(`Speech service busy (${r.status}) — retry`);
    if (r.status === 402) throw new Error("AI credits are used up — add credits to continue automatic captions.");
    if (!r.ok) throw new Error(`Speech recognition failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { text?: string };
    return { text: String(j.text ?? "").trim().slice(0, 2000) };
  });

export const saveVideo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    tokenSchema.extend({
      id: z.string().uuid(),
      sk: z.string().max(200).optional(),
      title: z.string().trim().min(1).max(150),
      description: z.string().max(5000).default(""),
      category: z.string().max(80),
      videoUrl: r2Url,
      thumbUrl: r2Url.nullable(),
      subtitles: z.array(z.object({ lang: z.string().max(10), label: z.string().max(40), url: r2Url })).max(20).default([]),
      status: z.enum(["published", "draft"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    const { tableKeys } = await import("./backend.server");
    const k = await tableKeys();
    // Idempotent: a retried/double-tapped publish carries the same id, so it updates instead of duplicating.
    const all = await loadVideos();
    const existing = data.sk ? all.find((v) => v.sk === data.sk) : all.find((v) => v.id === data.id);
    // Subtitles are optional; keep existing tracks when none are sent.
    const subs = data.subtitles.length ? data.subtitles : (existing?.subtitles ?? []);
    const createdAt = existing?.createdAt || new Date().toISOString();
    const id = k.range ? (existing?.sk ?? `${createdAt}#${data.id}`) : `${data.id}`;
    await putRecord("VIDEO", id, {
      vid: existing?.id ?? data.id,
      title: data.title,
      description: data.description,
      category: data.category,
      videoUrl: data.videoUrl,
      thumbUrl: data.thumbUrl ?? "",
      subtitles: JSON.stringify(subs),
      createdAt,
      channel: existing?.channel ?? "",
      views: existing?.views ?? 0,
      status: data.status,
      updatedAt: new Date().toISOString(),
    });
    // Pointer only after the durable VIDEO write succeeded; a failure here is reported, not hidden.
    if (k.range) await putRecord("VIDPTR", existing?.id ?? data.id, { sk: id });
    await bust("videos:all", `video:${existing?.id ?? data.id}`);
    return { ok: true };
  });

async function mediaInUse(exclude: { videoSk?: string; postId?: string }) {
  const [v, p] = await Promise.all([loadVideos(), loadPosts()]);
  const s = new Set<string>();
  for (const x of v) if (x.sk !== exclude.videoSk) { s.add(x.videoUrl); if (x.thumbUrl) s.add(x.thumbUrl); for (const t of x.subtitles ?? []) s.add(t.url); }
  for (const x of p) if (x.id !== exclude.postId) {
    if (x.coverUrl) s.add(x.coverUrl);
    if (x.mediaUrl) s.add(x.mediaUrl);
    for (const g of x.gallery) s.add(g.url);
    for (const m of x.body.matchAll(/https?:\/\/[^\s)"']+/g)) s.add(m[0]);
  }
  return s;
}

export const deleteVideo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ sk: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    const b = await import("./backend.server");
    const v = (await loadVideos()).find((x) => x.sk === data.sk);
    if (!v) throw new Error("Video not found");
    const k = await b.tableKeys();
    await deleteRecord("VIDEO", k.range ? v.sk : v.sk.replace(/^VIDEO#/, ""));
    const used = await mediaInUse({ videoSk: v.sk });
    for (const u of [v.videoUrl, v.thumbUrl, ...(v.subtitles ?? []).map((t) => t.url)]) if (u && MEDIA_URL_RE.test(u) && !used.has(u)) await b.r2Delete(new URL(u).pathname.slice(1)).catch(() => {});
    if (k.range) await deleteRecord("VIDPTR", v.id).catch(() => {});
    await bust("videos:all", `views:${v.id}`, `video:${v.id}`);
    return { ok: true };
  });

// ---------- Posts ----------
async function loadPosts(fresh = false): Promise<Post[]> {
  const { cached } = await import("./backend.server");
  const load = async () =>
    (await listRecords("POST", fresh)).map((r) => ({
      id: r["_id"],
      slug: r["slug"] ?? r["_id"],
      title: r["title"] ?? "",
      excerpt: r["excerpt"] ?? "",
      body: r["body"] ?? "",
      coverUrl: mediaUrl(r["coverUrl"] || r["thumbUrl"] || r["thumbnailUrl"] || null),
      category: r["category"] ?? "",
      tags: r["tags"] ?? [],
      seoTitle: r["seoTitle"] ?? "",
      seoDescription: r["seoDescription"] ?? "",
      featured: !!r["featured"],
      status: (r["status"] === "published" ? "published" : "draft") as Status,
      createdAt: r["createdAt"] ?? "",
      updatedAt: r["updatedAt"] ?? "",
      kind: kindOf(r["kind"]),
      linkUrl: r["linkUrl"] ?? "",
      mediaUrl: mediaUrl(r["mediaUrl"] ?? null),
      mediaName: r["mediaName"] ?? "",
      gallery: parseGallery(r["gallery"]).map((g) => ({ ...g, url: mediaUrl(g.url) })),
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return fresh ? load() : cached("posts:all", 60, load);
}
const stripBody = (p: Post) => ({ ...p, coverUrl: mediaUrl(postThumbnail(p)), body: "" });
export const listPosts = createServerFn({ method: "GET" })
  .inputValidator((d: { category?: string; kind?: string; limit?: number }) =>
    z.object({ category: z.string().max(80).optional(), kind: z.enum(CONTENT_KINDS).optional(), limit: z.number().int().min(1).max(500).default(200) }).parse(d))
  .handler(async ({ data }) => {
    setResponseHeader("Cache-Control", "no-store");
    try {
      const p = (await loadPosts()).filter((x) => x.status === "published" && (!data.category || x.category === data.category) && (!data.kind || x.kind === data.kind));
      return p.sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, data.limit).map(stripBody);
    } catch (e) {
      console.error(e);
      return [];
    }
  });
export const getPost = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: z.string().max(120) }).parse(d))
  .handler(async ({ data }) => { setResponseHeader("Cache-Control", "no-store"); return (await loadPosts()).find((p) => p.slug === data.slug && p.status === "published") ?? null; });

export const listAllPosts = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    return loadPosts();
  });

export const savePost = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    tokenSchema.extend({
      id: z.string().max(80).optional(),
      title: z.string().trim().min(1).max(200),
      slug: z.string().max(120).optional(),
      excerpt: z.string().max(500).default(""),
      body: z.string().max(100000).default(""),
      coverUrl: r2Url.nullable().default(null),
      category: z.string().max(80).default(""),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
      seoTitle: z.string().max(70).default(""),
      seoDescription: z.string().max(170).default(""),
      featured: z.boolean().default(false),
      status: z.enum(["published", "draft"]),
      kind: z.enum(CONTENT_KINDS).default("article"),
      linkUrl: z.string().max(2000).default(""),
      mediaUrl: r2Url.nullable().default(null),
      mediaName: z.string().max(200).default(""),
      gallery: z.array(z.object({ url: r2Url, alt: z.string().max(300).default(""), caption: z.string().max(500).default("") })).max(100).default([]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    let linkUrl = "";
    if (data.kind === "link") {
      const l = safeLink(data.linkUrl);
      if (!l) throw new Error("Enter a valid web address starting with https://");
      linkUrl = l;
    }
    if (data.status === "published") {
      if ((data.kind === "audio" || data.kind === "document") && !data.mediaUrl) throw new Error(`Upload the ${data.kind} file before publishing.`);
      if (data.kind === "images" && !data.gallery.length) throw new Error("Add at least one image before publishing.");
    }
    if (data.mediaUrl) {
      const prefix = data.kind === "audio" ? "/audio/" : data.kind === "document" ? "/docs/" : "";
      if (!prefix || !data.mediaUrl.includes(prefix)) throw new Error("That file doesn't match the content type.");
    }
    const all = await loadPosts();
    const existing = data.id ? all.find((p) => p.id === data.id) : undefined;
    const id = existing?.id ?? crypto.randomUUID();
    let slug = slugify(data.slug || data.title) || id.slice(0, 8);
    if (all.some((p) => p.slug === slug && p.id !== id)) slug = `${slug}-${id.slice(0, 4)}`;
    const now = new Date().toISOString();
    await putRecord("POST", id, {
      slug, title: data.title, excerpt: data.excerpt, body: data.body, coverUrl: data.coverUrl ?? "",
      category: data.category, tags: data.tags, seoTitle: data.seoTitle, seoDescription: data.seoDescription,
      featured: data.featured, status: data.status, createdAt: existing?.createdAt ?? now, updatedAt: now,
      kind: data.kind, linkUrl, mediaUrl: data.kind === "audio" || data.kind === "document" ? (data.mediaUrl ?? "") : "",
      mediaName: data.mediaName, gallery: data.kind === "images" ? JSON.stringify(data.gallery) : "",
    });
    await bust("posts:all");
    return { id, slug };
  });

export const deletePost = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ id: z.string().max(80) }).parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    const b = await import("./backend.server");
    const p = (await loadPosts()).find((x) => x.id === data.id);
    if (!p) throw new Error("Post not found");
    await deleteRecord("POST", p.id);
    const used = await mediaInUse({ postId: p.id });
    if (p.coverUrl && !used.has(p.coverUrl)) await b.r2Delete(new URL(p.coverUrl).pathname.slice(1)).catch(() => {});
    await bust("posts:all");
    return { ok: true };
  });

// ---------- Media library ----------
function storageBases() {
  return [R2_DEV, process.env["R2_PUBLIC_URL"]?.trim() || R2_DEV];
}
async function invalidateDeletedMedia(videos: { id: string }[]) {
  const b = await import("./backend.server");
  const keys = ["posts:all", "videos:all", ...videos.flatMap((v) => [`video:${v.id}`, `views:${v.id}`, `vt:${v.id}`])];
  b.forget(...keys);
  await b.redis("DEL", ...keys);
  await b.redis("INCR", "catalog:ver");
  // Physically remove search copies as well as orphaning their catalogue version.
  let cursor = "0";
  do {
    const page = await b.redis<[string, string[]]>("SCAN", cursor, "MATCH", "srch:*", "COUNT", 100);
    if (!page) throw new Error("Unable to clear cached search results. Retry deletion.");
    cursor = page[0];
    if (page[1].length) await b.redis("DEL", ...page[1]);
  } while (cursor !== "0");
}
export const listMedia = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    const b = await import("./backend.server");
    const [posts, videos] = await Promise.all([loadPosts(true), loadVideos(true)]);
    const bases = storageBases();
    return (await b.r2List())
      .filter((o) => o.size > 0)
      .map((o) => {
        const plan = mediaDeletionPlan(o.key, posts, videos, bases);
        const post = plan.posts[0];
        const video = plan.videos[0];
        const image = /^(images|thumbs)\//.test(o.key) || /\.(jpe?g|png|webp|gif|avif)$/i.test(o.key);
        return { ...o, url: b.publicUrl(o.key), inUse: !!(plan.posts.length || plan.videos.length), linkedPosts: plan.posts.length, linkedVideos: plan.videos.length,
          title: post?.title || video?.title || o.key,
          previewUrl: image ? b.publicUrl(o.key) : (post ? mediaUrl(postThumbnail(post)) : video?.thumbUrl ?? null) };
      });
  });

export const deleteMedia = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ key: z.string().min(1).max(300).regex(/^[\w.-]+(?:\/[\w.-]+)*$/).refine((key) => !key.split("/").some((p) => p === "." || p === "..")) }).parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    const b = await import("./backend.server");
    const [posts, videos, schema] = await Promise.all([loadPosts(true), loadVideos(true), b.tableKeys()]);
    const plan = mediaDeletionPlan(data.key, posts, videos, storageBases());
    await executeMediaDeletion(plan, {
      removePost: (id) => deleteRecord("POST", id),
      removeVideo: async (v) => {
        await deleteRecord("VIDEO", schema.range ? v.sk : v.sk.replace(/^VIDEO#/, ""));
        if (schema.range) await deleteRecord("VIDPTR", v.id);
      },
      removeFile: (key) => b.r2Delete(key),
      invalidate: () => invalidateDeletedMedia(plan.videos),
    });
    return { ok: true, deletedPosts: plan.posts.length, deletedVideos: plan.videos.length, deletedFiles: plan.files.length };
  });

// ---------- Inquiries ----------
export const submitInquiry = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(100),
      email: z.string().trim().email().max(255),
      message: z.string().trim().min(5).max(2000),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const id = `${new Date().toISOString()}#${crypto.randomUUID()}`;
    await putRecord("INQUIRY", id, { ...data, createdAt: new Date().toISOString(), status: "new" });
    return { ok: true };
  });

export const listInquiries = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    return (await listRecords("INQUIRY")) as Record<string, string>[];
  });

export const deleteInquiry = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ id: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    await deleteRecord("INQUIRY", data.id);
    return { ok: true };
  });

// ---------- Editable pages & settings ----------
export const PAGE_SLUGS = ["about", "privacy", "terms", "settings"] as const;
export const getContent = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => z.object({ slug: z.enum(PAGE_SLUGS) }).parse(d))
  .handler(async ({ data }) => {
    const { cached } = await import("./backend.server");
    try {
      publicCache();
      return await cached(`page:${data.slug}`, 300, async () => {
        // Single-item read instead of loading every page record.
        const { ddb, tableKeys } = await import("./backend.server");
        const k = await tableKeys();
        const Key: Record<string, any> = k.range ? { [k.hash]: { S: "PAGE" }, [k.range]: { S: data.slug } } : { [k.hash]: { S: `PAGE#${data.slug}` } };
        const r: any = (await ddb("GetItem", { Key })).Item;
        if (!r || r.deleted?.BOOL) return { title: "", body: "" };
        return { title: (r.title?.S as string) ?? "", body: (r.body?.S as string) ?? "" };
      });
    } catch {
      return { title: "", body: "" };
    }
  });

export const saveContent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.extend({ slug: z.enum(PAGE_SLUGS), title: z.string().max(200), body: z.string().max(20000) }).parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    await putRecord("PAGE", data.slug, { title: data.title, body: data.body, updatedAt: new Date().toISOString() });
    await bust(`page:${data.slug}`);
    return { ok: true };
  });

export const healthCheck = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    await ownerOnly(data.token);
    const b = await import("./backend.server");
    const run = async (fn: () => Promise<unknown>) => {
      const t = Date.now();
      try { await fn(); return `OK (${Date.now() - t} ms)`; } catch (e) { return (e as Error).message.slice(0, 200); }
    };
    return {
      firebase: "OK",
      cache: JSON.stringify(b.cacheMetrics()),
      redis: await run(() => b.redis("PING")),
      dynamodb: await run(() => b.ddb("DescribeTable", {})),
      r2: await run(() => b.r2Ping()),
    };
  });
