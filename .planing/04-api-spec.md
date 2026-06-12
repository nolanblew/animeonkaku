# Spike 04 — Internal API Specification (v1)

Base path `/v1`. JSON bodies, validated with zod schemas (Fastify type provider). Auth: `Authorization: Bearer <session-token>` on everything except `/auth/login` and `/healthz`. Errors: `{ "error": { "code": string, "message": string } }`.

## Auth — Kitsu-backed accounts

No native accounts. A "user" is a Kitsu user id; the server holds the Kitsu tokens and performs all Kitsu traffic.

### POST /v1/auth/login
```json
{ "username": "nolan", "password": "…", "deviceName": "Pixel 9" }
```
Server runs the Kitsu password grant (port of `KitsuAuthRepositoryImpl`, including tolerant response parsing), calls `users?filter[self]=true`, upserts `users` row keyed by kitsu_user_id, stores Kitsu access+refresh tokens, creates a device session.
```json
{
  "token": "opaque-256-bit",
  "user": { "kitsuUserId": "12345", "username": "nolan" },
  "isNewUser": true
}
```
- `isNewUser=true` → server immediately enqueues a full library sync (HIGH priority).
- Password is never stored; only Kitsu tokens are.
- 401 + Kitsu's error_description on bad credentials.

### Session endpoints
| | |
|---|---|
| `POST /v1/auth/logout` | revoke this device's token |
| `GET /v1/auth/me` | user info, kitsu token health, lastSyncAt, deviceName list |
| `DELETE /v1/auth/devices/{id}` | revoke another device |

Tokens: long-lived (180 d), sliding `last_used_at`, hashed (SHA-256) at rest. If the Kitsu *refresh* token dies (revoked/password change), `/me` and sync results carry `kitsuAuthState: "REAUTH_REQUIRED"`; client shows re-login. All other endpoints keep working (catalog + media are local).

## Library & catalog (reads)

Catalog (anime/themes/artists) is **global**, shared across users; library entries are per-user.

### GET /v1/library?since={unixMillis}
Delta-friendly snapshot of *my* library. Response (full when `since` omitted):
```json
{
  "serverTime": 1760000000000,
  "anime": [ {
      "kitsuId": "1", "animeThemesId": 123,
      "title": "...", "titleEn": "...", "titleRomaji": "...", "titleJa": "...",
      "posterUrl": "/v1/media/images/anime/1/poster", "coverUrl": "/v1/media/images/anime/1/cover",
      "watchingStatus": "current", "subtype": "TV", "startDate": "2024-01-01", "endDate": null,
      "episodeCount": 12, "ageRating": "PG", "averageRating": 8.1, "userRating": 9.0,
      "libraryUpdatedAt": 1758000000000, "slug": "...", "genres": ["action"],
      "updatedAt": 1759000000000, "deleted": false
  } ],
  "themes": [ {
      "id": 4567, "animeThemesAnimeId": 123, "kitsuAnimeIds": ["1"],
      "title": "...", "themeType": "OP1",
      "artists": [ { "name": "...", "asCharacter": null, "alias": null } ],
      "audioUrl": "/v1/media/audio/4567", "videoUrl": "https://v.animethemes.moe/...",
      "audioState": "READY",        // READY | PENDING | FAILED | MISSING
      "durationSeconds": 90, "fileSize": 5_242_880,
      "updatedAt": 1759000000000, "deleted": false
  } ]
}
```
- `since` returns only rows with `updatedAt > since` plus tombstones (`deleted: true`) — this replaces the client's own delta logic; Room becomes a cache of this feed.
- `audioState` lets the client know a stream will 302 to origin (PENDING) vs served locally (READY).

### Other reads
| | |
|---|---|
| `GET /v1/anime/{kitsuId}` | one anime + its themes |
| `GET /v1/search?q=…` | proxied online search (AnimeThemes /search + Kitsu text search), server-cached |
| `GET /v1/artists/{slug}` | artist + songs (proxied/cached `fetchArtistSongs`) |
| `POST /v1/library/anime` `{ "kitsuId": "..." }` or `{ "animeThemesId": 123 }` | manual add (port of isManuallyAdded flow); triggers mapping + media jobs |
| `DELETE /v1/library/anime/{kitsuId}` | remove manual add |

## User state (multi-device source of truth)

| | |
|---|---|
| `GET /v1/prefs/themes` | `[ { themeId, liked, disliked, playCount, lastPlayedAt } ]` |
| `PUT /v1/prefs/themes/{id}` | `{ "liked": true }` / `{ "disliked": false }` |
| `POST /v1/plays` | batch: `[ { "themeId": 4567, "playedAt": 1760000000000 } ]` — client uploads queued offline plays |
| `GET /v1/playlists` | manual + auto playlists with entries (+`updatedAt` for delta) |
| `POST /v1/playlists` / `PUT /v1/playlists/{id}` / `DELETE …` | manual playlist CRUD (entries: ordered themeIds) |
| `GET /v1/playlists/auto` | "Kitsu Library", "Currently Watching", "Liked Songs" — server-computed, refreshed after each sync |

Dynamic (filter-tree) playlists stay client-side in v1; their *specs* may be stored via `PUT /v1/playlists/{id}/spec` (opaque JSON blob) purely for backup/multi-device, evaluation stays on device.

Conflict policy (small-project pragmatism): last-write-wins on prefs; play counts are additive (server sums batches; client never writes absolute counts).

## Media

| | |
|---|---|
| `GET /v1/media/audio/{themeId}` | 206/200 with Range support when READY; **302 to origin + enqueue URGENT job** when not; 404 if theme unknown |
| `HEAD /v1/media/audio/{themeId}` | state probe (200 READY / 302 / 404) |
| `GET /v1/media/images/anime/{kitsuId}/poster|cover` | local or 302 to Kitsu CDN |
| `GET /v1/media/images/artists/{slug}` | local or 302 |
| `POST /v1/media/audio/{themeId}/request` | explicit "client wants to offline this" → HIGH priority enqueue; returns current state. Client download flow calls this, then polls/streams when READY (or follows 302 immediately — see doc 07) |

Caching headers: `ETag` = sha256, `Cache-Control: private, max-age=31536000, immutable` for READY audio (files never change for a given theme id; if AnimeThemes re-encodes, the job system bumps the row and the URL stays stable while ETag changes).

## Sync control

| | |
|---|---|
| `POST /v1/sync` `{ "full": false }` | enqueue my library sync (HIGH). Returns `{ "jobId": … }` |
| `GET /v1/sync/status` | `{ "state": "RUNNING", "phase": "MAPPING_THEMES", "progress": {...}, "lastCompletedAt": …, "unmatched": ["Title A"] }` — drives the existing Import screen UI |
| `GET /v1/jobs?status=failed` (admin) | inspect queue |
| `POST /v1/jobs/{id}/retry` (admin) | retry failed job |

## Versioning & compatibility

- Path-versioned (`/v1`). Additive changes only within v1; breaking → `/v2`.
- `GET /healthz` unauthenticated for compose healthcheck.
- All timestamps unix millis UTC in JSON (matches Android code).
