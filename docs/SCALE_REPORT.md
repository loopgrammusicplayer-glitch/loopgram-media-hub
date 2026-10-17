# Loopgram scale report (preview, updated 2026-10-15 04:30 UTC)

## Service roles
| Request | Firebase | Redis | DynamoDB | R2 |
|---|---|---|---|---|
| Public feed/watch/search, CDN hit | no | no | no | no |
| Feed page, CDN miss | no | view totals (MGET) | 1–8 bounded Query pages (cursor) | no |
| Search, CDN miss | no | version GET + result GET (60 s TTL) | only on catalogue cache miss | no |
| Video bytes | no | no | no | public R2 URL, `immutable` 1-year cache |
| View counted | no | dedupe + rate window | 1 sharded counter write | no |
| Like / comment | token verify (cached JWKS) | per-user rate limit | conditional transaction (idempotent) | no |
| Studio save/publish/delete | owner check (server) | cache delete + `catalog:ver` bump **after** the durable write | authoritative write | upload/delete |

## MEASURED facts (preview dev server, one machine — not production)
- Feed load: 0.45 s first, ~0.23 s warm (3 runs, after changes).
- Search in real browser: "vogue" returns Vogue videos; nonsense query shows "No results found"; 0 page errors.
- Tests: 38/38 pass (4 new for search/cursors). Typecheck clean. Build OK.
- NOT measured: throughput under load, error rate under load, CDN hit rate, failover. No load test was run.

## Implemented this pass
- Feed listing (already cursor-paginated from DynamoDB, 24/page, max 8 bounded reads) now **rejects malformed cursors**.
- Search: query normalized to max 6 terms; **all terms must match**; title hits ranked higher; results cached in Redis 60 s under a **catalogue version key** — any Studio publish/unpublish/delete bumps the version, so drafts never linger in search cache.
- Search responses CDN-cacheable 60 s (stale 300 s).

## ESTIMATES (not measured)
- One 1080p stream ≈ 5 Mbps. 10 billion simultaneous viewers ≈ 50 Pbps — roughly 50–100× all global internet capacity today. Not achievable by any provider; treat as impossible.
- 100 million simultaneous viewers ≈ 500 Tbps — only via Cloudflare's CDN with cached video; origin/app/database are not in the path for cached bytes.
- DynamoDB partition limit: ~1,000 writes/s and ~3,000 reads/s per key. View counts are sharded (see views.core.ts); all feed reads hit one partition (`VIDEO`) but sit behind CDN + Redis caches.

## Video open path (2026-10-15 04:45 UTC pass)
- `getVideo` no longer scans the catalogue: id → `VIDPTR` pointer item (GetItem) → `VIDEO` item (GetItem), cached 60 s, busted on save/delete. Pointers are additive rows (PK `VIDPTR`, SK = video id); older videos get one written on first open. No GSI or schema change needed.
- MEASURED (preview, headless Chromium, sandbox → AWS eu-north-1, n=4 videos × 2): watch page HTML with metadata 0.60–0.85 s cold (includes one-time pointer backfill), 0.03–0.04 s warm.
- R2 file check (real upload): 206 range responses, `video/mp4`, `immutable` 1-year cache, TTFB 0.18 s for first 1 KB, `moov` atom at the start (plays before full download), H.264 High 576×1024 ~3.6 Mbps + AAC. URLs are UUID-keyed, so a replaced file gets a new URL.
- First-frame time NOT measured: the test browser lacks the H.264 decoder. Measure it in real Chrome/Safari.
- Watch page: spinner over the poster until the first frame; `preload="metadata"`; no forced autoplay.

## Remaining limits
1. Search ranks the in-memory catalogue (capped at 5,000 rows). Beyond that a real search service is required.
2. All videos share one DynamoDB partition key (`VIDEO`). Fine at current size; hot at very large scale without caches.
3. No durable queue/outbox; writes are synchronous with idempotent keys and honest errors.
4. Upstash/DynamoDB/R2 quotas and billing plans not inspected (no console access).

## Needs your authorization (costs money or changes production)
- **GSI `vid-index` (hash: `vid`)** for direct video lookup by id — on-demand, ~same cost per write as the base table plus storage. Lets `getVideo` skip the catalogue.
- **Dedicated search service** (e.g. Typesense Cloud ~$30+/month, or Algolia). Plan: owner-only server writes index after each DynamoDB write; public search key read-only; rollback = switch back to current in-memory search (kept in code).
- **Staged load test** (e.g. k6 Cloud) — billable.

## Rollback
All changes are code-only, no data or schema changed. Revert `src/lib/search.core.ts` and the search/bust/cursor edits in `src/lib/api.functions.ts`. The `catalog:ver` Redis key is harmless if left.
