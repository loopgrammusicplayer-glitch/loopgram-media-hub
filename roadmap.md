# Roadmap

- [x] Show post thumbnails and media previews; cascade owner media deletion through linked content, storage and caches (22 tests passed; public thumbnail renders)
- [ ] Verify actual Media-tab deletion as the owner — blocked: Firebase owner session unavailable in the browser

- [x] Restore Firebase browser configuration and reconcile the requested GitHub source (all source/media files present; Firebase initialization verified)

- [x] Pull sonic-sync-studio from GitHub and save the keys the user pasted
- [x] Pull GitHub repo loop-galaxy-revival into this project
- [x] Store user-provided keys as project secrets (R2, AWS, Upstash, Firebase owner UID)
- [x] Verify app runs with keys connected
- [x] Mission 3: accurate like counts, Unlike, idempotent atomic writes (tests pass)
- [~] Mission 1 (header + watch page done): mobile-first design polish across feed, watch, Studio, search
- [ ] Mission 2: audit every button (Share, Comment, Subscribe, Search, Studio Save/Publish)
- [x] Mission 5: feed now server-rendered (loader primes first page); watch page server-rendered too
- [x] Mission 6: scale report in docs/SCALE_REPORT.md (load test, GSI, search index await approval)
- [ ] Mission 7: live test of likes and publishing with owner sign-in
- [x] Fix YouTube embed failure: plain-iframe fallback when IFrame API fails; verified normal + blocked-API on mobile viewport
- [x] Studio Video Library: server cursor pagination
- [ ] 2M+ scale: DynamoDB word index search, indexed related videos, maintained dashboard counters, reindex/repair, remove 5,000 caps
- [x] Direct-to-storage uploads in code (all sizes, 6 parallel parts)
- [ ] Turn on R2 CORS — blocked: saved R2 keys lack bucket-settings permission; owner must add rule in Cloudflare or give an Admin R2 token

- [x] Compare groove-sync-cloud GitHub source: no missing source files; correct absent Firebase verification project setting and unrelated Google key fallback (7 tests passed; live RPC reaches token verification)
- [ ] Confirm owner sign-in after Firebase correction — blocked: no Firebase owner session available; owner must retry sign-in
