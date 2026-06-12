# Spike 02 — External APIs (Kitsu, AnimeThemes) — constraints & usage contract

What the server must know to talk to the two upstream services. All of this is already proven working in the Android client; the server ports the same calls.

## Kitsu (kitsu.io)

### Auth — OAuth2 password grant
- `POST https://kitsu.io/api/oauth/token`, `application/x-www-form-urlencoded`.
  - Login: `grant_type=password&username=…&password=…&client_id=…&client_secret=…`
  - Refresh: `grant_type=refresh_token&refresh_token=…&client_id=…&client_secret=…`
- Public client credentials (documented by Kitsu, currently hardcoded in `KitsuAuthRepositoryImpl`):
  - id `dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd`
  - secret `54d7307928f63414defd96399fc31ba847961ceaecef3a5fd93144e960c0e151`
- Access token lifetime ≈ 30 days (`expires_in`), refresh token provided. Response sometimes non-standard — the client has fallback parsing for form-encoded/HTML/JSON-error bodies (`KitsuAuthRepositoryImpl.parseFallback`); port the same tolerance.
- Password must be RFC3986-encoded in form bodies (special chars).
- Sources: [Kitsu JSON:API docs](https://hummingbird-me.github.io/api-docs/), [Kitsu Apiary](https://kitsu.docs.apiary.io/).

### API — JSON:API at `https://kitsu.io/api/edge/`
Headers: `Accept`/`Content-Type: application/vnd.api+json`, `Authorization: Bearer <token>` (auth only needed for `filter[self]` and private libraries; library reads of public profiles work unauthenticated).

Endpoints in use (see `KitsuApi.kt` for exact field lists):
| Purpose | Endpoint | Notes |
|---|---|---|
| Identify user | `GET users?filter[self]=true` | → Kitsu user id (the account key) |
| Find by slug | `GET users?filter[slug]={name}` | login-by-username flow |
| Library | `GET users/{id}/library-entries?filter[status]=current,completed&include=anime&sort=-updatedAt&page[limit]=500&page[offset]=…` | 500/page max; `meta.count` gives total |
| Library (all statuses) | same w/o status filter | used for status-delta scans |
| Anime details | `GET anime?filter[id]=a,b,c&page[limit]=20` | batch 20 |
| External mappings | `GET anime?filter[id]=…&include=mappings` | gives `myanimelist/anime` etc. |
| Categories/genres | `GET anime?filter[id]=…&include=categories` | batch 20 |
| Search | `GET anime?filter[text]=…&page[limit]=5` | manual-add feature |

- No published hard rate limit; the client self-throttles at ≥350ms between requests globally. Server should keep a similar polite limit (e.g. ≤2 req/s) since one server now aggregates all users.
- `ratingTwenty` (2–20) ÷ 2 → user rating 1–10; `averageRating` string "0–100" ÷ 10.
- Timestamps ISO-8601; delta sync compares ISO strings lexicographically (valid for ISO-8601 UTC).

## AnimeThemes (api.animethemes.moe)

- Public, no auth. **Rate limit: 90 requests/minute**, with `X-RateLimit-Limit` / `X-RateLimit-Remaining` response headers and `Retry-After` + `X-RateLimit-Reset` on 429. Source: [AnimeThemes rate limiting docs](https://api-docs.animethemes.moe/intro/ratelimiting/).
- JSON:API-ish; pagination via `links.next`.

Endpoints in use (see `AnimeRepositoryImpl.kt`):
| Purpose | Endpoint |
|---|---|
| Map Kitsu ids → anime+themes | `GET /anime?filter[has]=resources&filter[site]=Kitsu&filter[external_id]=<≤50 csv>&include=resources,animethemes,animethemes.animethemeentries.videos,animethemes.animethemeentries.videos.audio,animethemes.song,animethemes.song.artists&page[size]=100` |
| Map MAL ids | same with `filter[site]=MyAnimeList` |
| Title fallback | `GET /anime?q=<title>&include=…,animesynonyms&page[size]=5` (exact name/synonym match enforced client-side) |
| Single anime | `GET /anime/{id}?include=…` (response is `{ "anime": {…} }`, single object) |
| Global search | `GET /search?q=…&fields[search]=anime,artists&include[anime]=…&include[artist]=images` |
| Artist page | `GET /artist/{slug}?include=songs.animethemes.anime…` |

### Binary hosts
- Audio: `https://a.animethemes.moe/{basename}.ogg` (from `video.audio.link` or constructed from `audio.path`). Sometimes only `video.link` (`v.animethemes.moe`, `.webm`) exists — current client falls back to the video URL as the audio URL.
- Images: `https://i.animethemes.moe/{path}`.
- Files support HTTP GET streaming; sizes typically 3–12 MB per audio track. Be polite: this is exactly what the "download once" server philosophy protects.

### Data-shape gotchas (all already handled in client code — port the handling)
- `resources[].external_id` may be number **or** string.
- A theme may have multiple `animethemeentries`/`videos`; pick first with usable audio.
- `song` may be null → title falls back to `"{type} {sequence}"`.
- Artist credits carry `artistsong.as` (character) and `alias`.
- Theme ids are numeric in practice; client has a hash fallback that should be dropped server-side (treat non-numeric as error).
- One AnimeThemes anime can match multiple Kitsu entries (seasons/specials collapsed) — the client enforces 1:1 with "claimed id" guards; the server catalog **should instead allow N:1** (multiple kitsu_anime rows pointing at the same animethemes anime is legitimate; current 1:1 constraint exists only because Room used `animeThemesId` as the theme join key). Decision recorded in `05-server-data-model.md`.

## Politeness budget (server)

Worst realistic case: library of 1,000 anime ⇒ 2 Kitsu library pages + 20 AnimeThemes mapping calls + fallbacks. Trivially within limits. The danger is the **binary backfill** (1,000+ audio files): the queue (doc 06) caps audio fetches at ~1 file per 5–10 s sustained with concurrency 1, which drains a 2,000-track library overnight without ever pressuring the origin.
