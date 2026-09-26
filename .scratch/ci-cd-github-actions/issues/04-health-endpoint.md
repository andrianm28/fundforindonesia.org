# 04: A health endpoint for the deploy check

**What to build:** `GET /api/health` returns 200 `{ ok: true }` when a trivial database query succeeds, and 503 `{ ok: false }` otherwise. It has `Cache-Control: no-store`, needs no auth, and exposes no details.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Route tests cover DB up (200) and DB down (503); nothing sensitive is returned
