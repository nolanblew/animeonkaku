# A1 IMPLEMENTATION PLAN -- Android Server Plumbing

## Scope

Add the Android scaffold for server mode while preserving the legacy direct-Kitsu path unless a server base URL is configured.

## Boundaries

- Do not remove legacy Kitsu/AnimeThemes Android code in A1.
- Do not swap library reads/playback/downloads to the server yet; that is I1.
- Keep offline playback and existing Room cache behavior unchanged.

## Tasks

1. Add `OngakuApi` Retrofit service and Moshi DTOs for the v1 server contract from `.planing/04-api-spec.md`.
2. Add server connection/session storage:
   - `ServerSettingsStore` for base URL and pull cursor.
   - `ServerTokenStore` for opaque bearer session token and server user metadata.
   - `OngakuAuthInterceptor` and dynamic base-URL interceptor.
3. Wire Hilt network providers:
   - `@Named("ongaku")` OkHttpClient/Retrofit.
   - `OngakuAuthRepository` that posts `/v1/auth/login`.
4. Add Settings UI state for the server base URL.
5. Gate Import login:
   - blank server URL keeps the current Kitsu path.
   - configured server URL posts to the server and stores the server session, without starting the legacy local sync.
6. Room v19 -> v20:
   - add `pending_plays` table and DAO.
   - store `serverPullCursor` in `ServerSettingsStore` instead of Room.
7. Add `PendingWritesFlushWorker` for pending play batches and schedule it only when a server base URL is configured.

## Tests

- DTO parsing for `/v1/auth/login`, `/v1/library`, `/v1/sync/status`.
- Server settings/token stores normalize URLs, persist session metadata, and clear session state.
- Interceptors rewrite requests to the configured base URL, add bearer auth, and clear session on 401.
- Pending play DAO/worker contract is covered by unit-level tests where practical; full Room migration is verified by Gradle/KSP schema generation and `gradlew test`.
