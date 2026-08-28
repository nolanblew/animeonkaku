# Web–Mobile Feature Gap Audit v1

**Audit date:** 2026-08-27  
**Compared:** current React web player in `web/` against the mature Android client in `src/app/`  
**Method:** two independent read-only subagent passes (mobile-first and web-first), followed by an integrator pass across source, tests, and the authenticated QA web runtime at `http://localhost:48777`.

## Scope and interpretation

This report uses the original web-player scope as the contract.

Included:

- Mobile-equivalent library behavior, including manual and smart playlist creation/editing.
- Live library/playlist/profile updates without a page refresh.
- Browser/OS media-player integration.
- Managed image caching and exactly the next three audio items, including reconciliation when the queue changes.
- Responsive desktop-first UX that remains usable in half-width and small windows.
- Good performance for libraries with thousands of anime on mid-range hardware.
- Login, logout, profile editing, account lookup/creation, initial sync, and subsequent sync behavior comparable to mobile.
- Root web routing at `/`, API access through `/api`, no direct browser access to the database or external catalog providers.
- Friendly 404/500 surfaces with safe expandable technical details.

Explicitly not counted as gaps:

- Downloads, offline browsing, offline playback, download management, and Wi-Fi-only download settings.
- High-security hardening beyond sensible basics.
- Analytics, crash reporting, and PWA/offline-service-worker work.
- Adding tracks from inside a playlist. The current product decision is to add from the song/theme action instead.

Priority meanings:

- **P0:** core playback behavior is misleading or inaccessible and should be fixed before broader use.
- **P1:** required parity or a major primary-flow omission.
- **P2:** meaningful completeness, resilience, performance, or UX gap.
- **P3:** polish or misleading affordance with a small blast radius.

## Executive summary

The web player has a solid foundation and several of the original architectural requirements are already implemented: cookie-authenticated `/api` calls, live SSE plus delta polling, browser Media Session handlers, a managed next-three audio cache, responsive shell breakpoints, real playlist metadata/artwork, thumbs-up/down controls, view-transition animation, and safe 404/500 details.

It is not yet at mobile feature parity. The most important remaining problems are:

1. **Dislike is persisted but does not reproduce mobile playback behavior.** Disliked entries remain eligible for web queues.
2. **The full-screen Up Next UI silently hides most of the queue.** It solves whole-page scrolling by clipping entries, with no alternate queue surface.
3. **Initial and ongoing Kitsu sync management is largely absent.** The web can sign in and receive live updates, but it does not provide the mobile progress, retry, manual sync, force re-sync, unlink, or unmatched-item flows.
4. **Queue behavior and controls are substantially behind mobile.** History, reordering, removal, contextual playback, and durable restoration are missing from the web experience.
5. **Artist and related-music discovery is incomplete.** Artist “detail” is only an in-place theme filter; related releases cannot be discovered and managed like mobile.
6. **Large playlist and queue views are not virtualized or paged.** The live 134-track Kitsu Library playlist rendered all 134 rows and 274 buttons at once.

## Feature-by-feature parity matrix

| Area | Web status | Assessment |
|---|---|---|
| Root web app and `/api` boundary | Complete | The SPA is served at `/`; the client defaults to `/api` and uses credentials-included requests (`web/src/lib/api.ts:33-68`). |
| Login/account lookup or creation | Partial | Web submits the same server login inputs and receives `isNewUser`/`syncMode`, but does not present the mobile onboarding and first-sync lifecycle (`web/src/auth/AuthProvider.tsx:18-23,112-118`). |
| Logout/session cleanup | Complete | Logout clears account-scoped queries and local player/cache ownership (`web/src/auth/AuthProvider.tsx:121-131`). |
| Profile editing | Complete, web stronger in places | Display name and avatar upload/removal are implemented; signed-in devices and Kitsu state are shown (`web/src/features/accountsearch/SettingsPage.tsx:95-125`). |
| Initial/manual Kitsu sync | Missing/partial | No sync-management route or screen, detailed progress, manual sync, force re-sync, pause/resume/cancel, unlink, or unmatched-anime result view. |
| Periodic live library updates | Complete | Initial cursor snapshot, SSE notifications, delta polling fallback, category invalidation, and cleanup are implemented (`web/src/lib/query.tsx:31-90`; `web/src/lib/live.ts:43-47,85-117,189-205`). |
| Home | Partial | Quick Picks and playlists exist; Top Songs/recent additions, Play all, working overflow actions, and the mobile home preference are missing. |
| Library: anime | Mostly complete | Responsive cards, status/search/sort, paging, empty/error states, and detail navigation exist. |
| Library: songs | Partial | Theme browsing/actions exist, but full catalog songs and collection-level Play/Shuffle parity are incomplete. |
| Library: artists | Partial | An in-place artist theme filter exists; dedicated artist route, richer artist catalog, and cross-navigation do not. |
| Anime detail | Partial | Themes, Play all/Shuffle, release display, and base actions exist; related-music request/status and full song-row actions do not. |
| Related music/releases | Partial | Release detail exists, but related-music discovery/request flow and several track actions are absent. |
| Search | Partial | Local anime/theme/playlist plus server track/release search exists; artist results, clickable release results, retry, saved-result fallback, and rich actions are missing. |
| Manual playlists | Mostly complete | Create/edit/delete, artwork, real titles, playback, shuffle, remove, Play next/Add to queue, and add-from-song are present. Reordering and playlist-level queue actions are not. |
| Smart playlists | Mostly complete | Structured simple/advanced builder, nested logic, sort priority, auto/snapshot modes, and expert JSON fallback exist. Explicit snapshot refresh and some mobile help/preview affordances are missing. |
| Likes/dislikes | Partial and behaviorally incorrect | Thumbs UI and API persistence are present; mobile-style disliked-entry skipping/unskip behavior is absent. |
| TV/full/video playback | Mostly complete | Mode availability, switching, seek, repeat, shuffle, fullscreen video, and play-event recording exist. Spoiler/NSFW confirmation and loudness normalization are missing. |
| Queue/Up Next | Major gap | Core queue reducer is capable, but the UI exposes only skip-to; hidden entries, history, removal, reorder, and contextual actions are not available. |
| Browser Media Session | Complete baseline | Play/pause, seek, previous/next, metadata, state, and position are wired (`web/src/media/mediaSession.ts:44-107`). |
| Light media caching | Partial | Next-three audio reconciliation is correct. Managed image coverage and stale cache-namespace cleanup are incomplete. |
| Responsive/animation | Partial | Desktop/compact/mobile shell and mini-to-full view transition exist. Full-screen queue responsiveness trades scrolling for inaccessible content. |
| Large-library performance | Partial/unverified | Anime and library result rendering is bounded, but playlist detail/queue rendering and some lookup algorithms are not. No long-run heap/soak evidence was found. |
| 404/500 errors | Complete | Friendly states, retry/home actions, and expandable redacted details exist (`web/src/components/ErrorState.tsx:5-24,44-67`). |

## Integrated findings

### P0-01 — Disliked entries are still eligible for playback

**Mobile behavior:** Android consults disliked IDs when deciding which queue entries remain playable, while retaining explicit unskip behavior (`src/app/src/main/java/com/takeya/animeongaku/media/MediaControllerManager.kt:144-160,1169-1187`; `src/app/src/main/java/com/takeya/animeongaku/ui/player/PlayerScreen.kt:425-465`).

**Web behavior:** the web writes thumbs-up/thumbs-down preferences, but queue construction maps every playlist item without consulting those preferences (`web/src/features/libraryactions/TrackActionMenu.tsx:43-71`; `web/src/pages/Pages.tsx:139-175`). There is no web unskip model or playback eligibility check.

**Impact:** the thumbs-down control looks equivalent to mobile but does not carry its central behavioral meaning. A disliked item can still play from Play all, Shuffle, Play next, or Add to queue.

**Recommendation:** centralize queue eligibility in the web player, apply it consistently to all queue producers, preserve the current entry, and add an explicit unskip/remove-dislike action for queued entries. Cover themes, related songs, duplicates, shuffle, and manually selected disliked entries.

### P0-02 — Full-screen Up Next hides most of the queue

**Web behavior:** the player deliberately applies `overflow: hidden`; below 1180 px it renders a three-column strip and hides the fourth and later entries, while below 700 px it hides the third and later entries (`web/src/player/player.css:70-80,94-119`). The regression test explicitly requires a non-scrollable clipped queue (`web/src/player/playerViewport.test.ts:5-11`).

The list still reports the full count, but there is no “show all,” drawer, pagination, keyboard path, or secondary queue page. `NowPlayingView` maps the entire queue into the DOM even though CSS hides most entries (`web/src/player/NowPlayingView.tsx:46`).

**Impact:** the player meets “the whole page must never scroll” by making most queue items unreachable, especially in the half-width window explicitly called out in the scope.

**Recommendation:** keep the page locked to the viewport, but make Up Next an intentionally bounded internal surface: a compact scroll region, virtualized drawer/sheet, or paged queue. Do not reintroduce body scrolling or nested competing scrollbars; one clearly owned queue scroller is appropriate.

### P1-03 — Kitsu onboarding and sync lifecycle are incomplete

Android provides login validation, Full/Delta initial-sync progress, legacy import, manual Sync Library, force re-sync, unlink, pause/resume/cancel, detailed phase progress, and unmatched-anime reporting (`src/app/src/main/java/com/takeya/animeongaku/ui/onboarding/OnboardingViewModel.kt:25-184`; `src/app/src/main/java/com/takeya/animeongaku/ui/onboarding/FirstSyncScreen.kt:94-215`; `src/app/src/main/java/com/takeya/animeongaku/ui/sync/ImportScreen.kt:96-169,225-247,454-666`). The server already exposes sync start/status routes (`server/src/api/syncRoutes.ts:28-53`).

Web stores `isNewUser` and `syncMode`, but its visible state is only a “Syncing your library…” line. It marks initial sync ready as soon as the first library query succeeds, not when the full server sync lifecycle reports completion (`web/src/auth/AuthProvider.tsx:112-118,159-161`; `web/src/lib/query.tsx:58-61`; `web/src/components/ResponsiveShell.tsx:134,180`). Settings only displays the last-sync timestamp (`web/src/features/accountsearch/SettingsPage.tsx:113-120`).

**Impact:** a new or large account can appear ready while the server is still matching/importing data, and the user has no web recovery path for a stuck, partial, or intentionally refreshed sync.

**Recommendation:** add an authenticated sync page and a first-sync route driven by `/v1/sync/status`. Distinguish Full vs Delta, show phases/counts/errors, retain usable partial data, and expose Sync now, Re-sync all with confirmation, retry, and unlink. Legacy import should be included only if it remains part of the supported account-creation contract.

### P1-04 — Queue management and contextual playback trail mobile

Android Up Next exposes history, current/upcoming sections, queue-entry action sheets, drag reorder, swipe removal, mode actions, and navigation by stable queue-entry identity (`src/app/src/main/java/com/takeya/animeongaku/ui/player/UpNextSheet.kt:202-278,336-537`).

Web's queue reducer supports several operations, but the full-screen UI only supports clicking an upcoming item to skip to it (`web/src/player/queue.ts:63-80,727-759`; `web/src/player/NowPlayingView.tsx:46`). It exposes no history, remove, reorder, or per-entry overflow menu.

Context is also lost when starting a playlist from a middle row: web slices the collection at the selected index before constructing the queue, so earlier playlist entries cannot be reached with Previous (`web/src/pages/Pages.tsx:139-145`). Android starts the full playlist at the selected index (`src/app/src/main/java/com/takeya/animeongaku/ui/library/PlaylistDetailViewModel.kt:406-461`). Release-row and individual anime-theme playback similarly tend to become single-item contexts on web.

Finally, `QueueStore` can restore a snapshot, but `PlayerProvider` does not persist or restore it. A refresh loses queue/history/listening context even though the login screen promises users can “pick up your listening session” (`web/src/pages/LoginPage.tsx:38`; `web/src/player/queue.ts:510-535,763-764`; `web/src/player/PlayerProvider.tsx:90-118`).

**Recommendation:** build one shared queue surface for full screen and mini player, preserving full collection context, stable duplicate identities, history, remove/reorder, and reload restoration. Match the existing Android queue invariants rather than inventing a second queue contract.

### P1-05 — Artist and related-music discovery is incomplete

Android has dedicated artist and related-music routes (`src/app/src/main/java/com/takeya/animeongaku/ui/AnimeOngakuApp.kt:458-484`), artist collections/actions, and related release/track playback (`src/app/src/main/java/com/takeya/animeongaku/ui/library/ArtistDetailScreen.kt:355-460`; `src/app/src/main/java/com/takeya/animeongaku/ui/library/RelatedMusicScreen.kt:63-209`).

Web routes omit both concepts (`web/src/app/App.tsx:35-43`). The Artists tab computes names from theme associations and opens an in-place filtered theme list (`web/src/features/catalog/LibraryCatalogPage.tsx:42-50,85-87,150-153`). Anime detail only displays already-ready releases (`web/src/features/catalog/AnimeDetailPage.tsx:44`); there is no request/import/progress path equivalent to mobile.

**Recommendation:** add a dedicated artist route with theme and full-song sections, artwork, Play/Shuffle, and cross-links to anime. Add related-music discovery/request/status around the existing release detail route rather than duplicating release UI.

### P1-06 — Track and player overflow actions are incomplete

Mobile's shared action model includes Play next, Add to queue, Replace queue, Save to playlist, Play video, Go to artist, Go to anime, Related music, mode preference, and context-specific removal (`src/app/src/main/java/com/takeya/animeongaku/ui/common/ActionSheet.kt:61-94,127-150,217-348`).

Web playlist rows now have a useful menu, but the generic menu is limited to Play next, Add to queue, Save to playlist, thumbs, and optional removal (`web/src/features/libraryactions/TrackActionMenu.tsx:61-74`). The now-playing and mini-player `...` both use this reduced menu (`web/src/player/CurrentTrackActions.tsx:7-16`). Release tracks and anime-detail release tracks expose Play only (`web/src/features/releases/ReleaseDetailPage.tsx:90-100`; `web/src/features/catalog/AnimeDetailPage.tsx:44`).

**Recommendation:** define a single context-aware web action model and use it on home, search, anime, release, playlist, mini-player, and full-screen player rows. Hide only actions that truly do not apply.

### P1-07 — Home contains dead navigation/actions and omits mobile content

The Quick Picks overflow button has no handler (`web/src/features/catalog/HomeCatalogPage.tsx:63-70`). This was confirmed in the authenticated QA runtime: clicking it produced no menu or dialog. The notification bell is another inert control (`web/src/components/ResponsiveShell.tsx:162-166`).

Home's “See all” uses `/library?tab=songs`, but the Library page always initializes `tab` to `anime` and never reads the query string (`web/src/features/catalog/HomeCatalogPage.tsx:60`; `web/src/features/catalog/LibraryCatalogPage.tsx:21-29`). The live runtime reproduced the mismatch.

Android also provides Quick Picks Play all and a Top Songs section (`src/app/src/main/java/com/takeya/animeongaku/ui/home/HomeScreen.kt:263-364`). Web renders only Quick Picks and playlists (`web/src/features/catalog/HomeCatalogPage.tsx:44-87`), despite the home service having additional data.

**Recommendation:** wire the overflow to the shared action model; make Library tabs URL-addressable; add Play all and Top Songs/recent additions; either implement notifications or remove the bell and unread dot.

### P1-08 — Playlist editing is good but not fully at mobile parity

The rebuilt playlist detail is a major improvement: it resolves real titles, subtitles, artwork, duration, availability, Full Size/Video capability badges, and item actions (`web/src/features/playlists/playlistDisplay.ts:20-74`; `web/src/features/playlists/components.tsx:298-321`). It correctly directs additions through a song's action menu.

Remaining gaps:

- Manual playlist rows cannot be moved up/down or drag-reordered, while Android exposes entry movement (`src/app/src/main/java/com/takeya/animeongaku/ui/library/PlaylistDetailScreen.kt:508-516,624-644`).
- Playlist-level Play next/Add to queue/Replace queue/settings actions are absent.
- Snapshot smart playlists have no explicit Refresh now action, while mobile exposes refresh for snapshot mode (`src/app/src/main/java/com/takeya/animeongaku/ui/library/PlaylistDetailScreen.kt:153-187`).
- The dynamic builder supports regex but has no equivalent of mobile's regex help surface.

The old numeric `PlaylistItemsEditor` remains exported (`web/src/features/playlists/components.tsx:234-260`) but has no call sites in the current web source. It is **not an active UI defect**; remove or quarantine it so a future refactor does not accidentally restore the rejected “Theme #123 / Catalog id” experience.

### P1-09 — Large playlist and queue rendering do not meet the performance goal

The library grid/list limits visible results (`web/src/features/catalog/LibraryCatalogPage.tsx:19,62,85-88`) and is directionally sound. Playlist detail, however, maps every resolved row (`web/src/features/playlists/components.tsx:318`), and Up Next maps every upcoming queue entry before CSS hides most (`web/src/player/NowPlayingView.tsx:46`).

In the authenticated QA runtime, `/playlist/5` rendered **134 track rows and 274 buttons** simultaneously. At thousands of tracks this creates unnecessary DOM, image observers, menu components, and preference lookups. Song playlist resolution also scans all anime music catalogs/releases while constructing lookup state (`web/src/pages/Pages.tsx:156-175`; see also `web/src/features/playlists/playlistDisplay.ts:48-68`).

**Recommendation:** virtualize or window playlist and queue rows, retain stable row keys, pre-index songs/themes once per normalized library update, and add measured browser gates for 1k/5k anime and long queues. Include a repeated navigation/playback soak with heap snapshots; no evidence of such a memory-leak test exists today.

### P1-10 — Video warning policy from mobile is missing

Android warns before playing spoiler/NSFW video (`src/app/src/main/java/com/takeya/animeongaku/ui/player/PlayerScreen.kt:148-165,307-325`). Web DTOs carry `spoiler`/`nsfw` video metadata, but the mapping/player path does not preserve or consult it before switching mode (`web/src/lib/library.ts:60-64`; `web/src/player/mapping.ts:24-50`; `web/src/player/NowPlayingView.tsx:23-24,40`).

**Recommendation:** preserve flags in queue items and apply one shared confirmation policy for row actions, mode switching, and auto-restored video.

### P2-11 — Managed caching is correct for audio but incomplete for images and lifecycle cleanup

The good part: audio URLs are canonicalized, limited to the next three, stale entries are deleted on reconcile, failures are opportunistic, and both owned buckets can be cleared (`web/src/media/managedCache.ts:27-30,52-62,79-120`). `PlayerProvider` recalculates the next audio URLs when queue identity/version changes (`web/src/player/PlayerProvider.tsx:477-488`).

Gaps:

- The provider supplies only the current artwork URL, not upcoming artwork or the browsing surfaces requested for light image caching (`web/src/player/PlayerProvider.tsx:484-487`).
- Each provider mount creates a random cache namespace (`web/src/player/PlayerProvider.tsx:590-596`). Cleanup on normal unmount is best effort (`web/src/player/PlayerProvider.tsx:490-499`), but there is no sweep for namespaces orphaned by a crash, killed tab, or interrupted browser process. This is an inference from the lifecycle design and can lead to accumulated Cache Storage buckets over time.

**Recommendation:** use a stable per-user/version namespace, reconcile/sweep old versions on startup/logout, prefetch current plus next-three artwork, and define byte/count limits and explicit clear-cache behavior.

### P2-12 — Playback preferences and audio processing are incomplete

- Android applies per-item loudness gain (`src/app/src/main/java/com/takeya/animeongaku/media/MediaPlaybackService.kt:45-77,157-164`). Web carries loudness fields but does not apply gain in playback (`web/src/lib/library.ts:1-4,20,52-54`; `web/src/player/PlayerProvider.tsx:143-153`).
- Android persists a preferred playback mode (`src/app/src/main/java/com/takeya/animeongaku/media/PlaybackPreferences.kt:27-50`). Web initializes mode to `TV_SIZE` on each provider mount (`web/src/player/PlayerProvider.tsx:90-118`), although per-theme and per-playlist overrides are supported elsewhere.
- Android exposes a Bluetooth metadata presentation preference (`src/app/src/main/java/com/takeya/animeongaku/ui/settings/SettingsScreen.kt:138-144`). Web sends sensible Media Session metadata, but offers no analogous display-style preference.

**Recommendation:** implement loudness normalization using Web Audio only if it can be done without compromising streaming/cross-origin reliability; persist the default mode server-side or as a scoped browser preference; treat Bluetooth metadata style as optional P3 unless users request it.

### P2-13 — Search is broad but not fully actionable or resilient

Web search covers local anime/themes/playlists plus server tracks/releases, but it has no artist result group, renders release results as plain text, and gives tracks only a Play button (`web/src/features/accountsearch/SearchPage.tsx:79,115-136`). On failure it displays one sentence with no Retry and discards server results (`web/src/features/accountsearch/SearchPage.tsx:58-77,111-114`).

Android search includes artist/release navigation and contextual actions, and distinguishes saved-result fallback from a hard failure (`src/app/src/main/java/com/takeya/animeongaku/ui/search/SearchScreen.kt:338-428,463-510`; `src/app/src/main/java/com/takeya/animeongaku/ui/search/SearchFailurePresentation.kt:3-4`).

**Recommendation:** add artists, link releases, attach shared track actions, keep last successful results during refresh errors, and add Retry.

### P2-14 — Current preference state can be stale

`CurrentTrackActions` reads normalized preferences imperatively with `queryClient.getQueryData()` rather than subscribing to the query (`web/src/player/CurrentTrackActions.tsx:7-16`). A preference update from another control, live event, or device can replace the cache without causing this component to render immediately.

**Recommendation:** derive current preference from a subscribed library selector/hook, or pass it from a reactive player-shell owner. Add a cross-surface test: dislike in playlist, confirm mini/full player changes without navigation.

### P2-15 — Web modal/menu keyboard behavior needs a focused accessibility pass

The custom track menu handles outside pointer dismissal, but not Escape, focus entry/return, arrow-key menu navigation, or focus containment (`web/src/features/libraryactions/TrackActionMenu.tsx:36-41,61-76`). Playlist and action dialogs are custom fixed overlays rather than native dialog primitives, with no shared focus-management layer.

**Recommendation:** adopt one accessible menu/dialog primitive, test keyboard-only behavior at desktop and half-width, restore focus to the opener, lock only the correct scroll container, and keep `prefers-reduced-motion` behavior.

### P2-16 — Reauthentication is abrupt

The web auth boundary treats an unauthorized session as logged out and redirects to login; it does not preserve a reconnect state (`web/src/auth/AuthProvider.tsx:103-110,193`). Android retains the current UI and offers a reconnect banner (`src/app/src/main/java/com/takeya/animeongaku/ui/AnimeOngakuApp.kt:646-675`).

**Recommendation:** distinguish expired/revoked authentication from a deliberate logout, preserve the requested return route and non-sensitive local playback context, and show a reconnect banner/modal.

### P3-17 — Low-cost copy and affordance cleanup

- The Library stat uses the internal tab value, producing “30 anime” but potentially awkward labels elsewhere; the tab itself uses “Animes” (`web/src/features/catalog/LibraryCatalogPage.tsx:67-77,96-98`). Prefer “Anime.”
- Signed-in devices are presented under “Security” but are informational only; either label the list accordingly or add revoke actions if desired (`web/src/features/accountsearch/SettingsPage.tsx:118-120`).
- Release/playlist rows frequently show `--:--` or `—` when duration metadata is absent. Consider omitting duration rather than making a large catalog look broken (`web/src/features/catalog/AnimeDetailPage.tsx:54-56`).
- Remove the inert notification bell and unread dot until there is a real notification model (`web/src/components/ResponsiveShell.tsx:162-166`).

## Recently requested fixes that are now present

These should be treated as regression requirements, not reopened as missing work:

- Playlist rows use real titles, anime/artist context, artwork, capability badges, duration, and an item overflow menu.
- Playlist rows no longer redundantly label every theme as TV Size; only additional Full Size/Video capability is called out.
- Tracks are added from song/theme actions rather than an active add row on the playlist page.
- Mini and full-screen player overflow controls are wired to a real menu.
- Hearts have been replaced by thumbs-up/thumbs-down in active player and row controls.
- The fake waveform is gone; the active player uses a real seek slider (`web/src/player/NowPlayingView.tsx:35-40`).
- The now-playing route is viewport-locked and has a reduced-motion-aware mini/full transition (`web/src/styles.css:70-85`; `web/src/player/viewTransition.ts:5-11`; `web/src/player/player.css:89-92,121`).

The queue clipping described in P0-02 is the remaining flaw in that viewport fix.

## Recommended delivery order

### Phase 1 — Core playback correctness

1. Implement dislike-aware queue eligibility/unskip behavior.
2. Replace clipped Up Next with a bounded accessible queue surface.
3. Preserve full collection context and add queue remove/reorder/history actions.
4. Add video warning policy and reactive current preference state.

### Phase 2 — Account/library parity

1. Build first-sync and ongoing Kitsu sync management.
2. Add dedicated artist and related-music discovery/request flows.
3. Complete shared actions on anime/release/search/player surfaces.
4. Add manual playlist reorder and snapshot refresh.

### Phase 3 — Scale and resilience

1. Virtualize/window long playlist and queue lists and pre-index song lookup.
2. Stabilize and sweep managed cache namespaces; broaden bounded artwork prefetch.
3. Add large-library browser benchmarks and repeated playback/navigation heap-soak tests.
4. Preserve useful state through reauthentication and improve search retry/fallback.

### Phase 4 — UX/accessibility polish

1. Fix URL-addressable library tabs and Home dead actions/sections.
2. Standardize accessible dialogs and menus.
3. Add loudness/default-mode preferences where browser constraints allow.
4. Remove placeholder affordances and refine copy/missing-duration presentation.

## Two independent pass summaries

### Pass A — Mobile-first parity pass

This pass inventoried Android navigation, onboarding/sync, home, library, artist, anime, related music, playlists, player, queue, preferences, and media behavior before checking for web equivalents. Its strongest findings were the missing sync lifecycle, artist/related-music routes, dislike playback semantics, video warnings, queue management, playlist reorder/refresh, loudness, and preferred-mode persistence. It explicitly ruled downloads/offline out of scope and confirmed dynamic playlist support, releases, Media Session, live updates, thumbs, and removal of the fake waveform.

### Pass B — Web-first UX/runtime pass

This pass started from every web route and shared component, then compared visible controls to their actual handlers and to Android behavior. Its strongest findings were the dead Home overflow and notification controls, broken `?tab=songs` destination, partial track actions, incomplete sync/reconnect UX, narrow managed image caching, clipped queue, stale current preference reads, accessibility gaps, and large-library computation/rendering risks. It confirmed the current playlist redesign, Media Session, audio reconciliation, live cleanup, auth/profile work, error surfaces, lazy routes, and reduced-motion support.

### Integrator reconciliation

Both passes independently agreed on the major sync, artist/related-music, queue, action-menu, image-cache, and performance gaps. The integrator also performed authenticated read-only runtime checks of Home, Library, Settings, Search, and the 134-track playlist.

One source-only candidate was downgraded: the numeric `PlaylistItemsEditor` looks like the rejected old add-row UX, but current-source call-site inspection found it is not mounted. It is cleanup debt, not an active defect. The explicit no-add-from-playlist product decision is therefore preserved.

## Verification boundaries

- The audit was read-only. No like/dislike, playlist mutation, profile mutation, sync start, or playback-count-producing action was executed against the live account.
- The authenticated QA runtime was used to verify route content, inert controls, URL-tab behavior, and DOM scale. Media Session behavior was source/test audited rather than verified on Windows, macOS, and mobile OS surfaces in this pass.
- No Android device UI replay was required for this comparison; Android behavior was traced from the mature source and its existing architecture/tests.
- Performance findings identify concrete unbounded DOM/lookup paths, but this pass did not run a formal CPU, network, or heap benchmark. Those measurements are part of the recommended follow-up gates.

## Implementation closeout — 2026-08-27

The findings above describe the pre-implementation audit snapshot. All four recommended phases have since been implemented on `codex/web-player`.

| Requirement | Closeout status |
|---|---|
| Mobile library parity | Complete for the web scope: anime, songs/themes, artists, releases, manual and smart playlists, creation/edit/delete, structured simple/advanced rules, manual reordering, snapshot refresh, shared row actions, and live query invalidation are wired. Playlist additions remain intentionally song-action-only. |
| Kitsu account lifecycle | Complete: login/lookup-or-creation, Full/Delta first sync, progress/status, ordinary sync, confirmed full re-sync, retained partial results, unmatched/upstream-blocked states, profile/avatar editing, device information, reconnect state, logout, and local unlink are present. Android's apparent pause/resume/cancel handlers are no-ops, so the web does not advertise controls that the platform cannot actually perform. |
| Playback and OS integration | Complete within browser APIs: contextual queue construction, stable duplicate identities, history/up-next removal and reordering, disliked-item skip/unskip, repeat/shuffle, TV/Full/Video switching, spoiler/NSFW warnings, thumbs, Media Session metadata/actions/position, persisted per-user TV/Full default, and safe loudness attenuation are covered. Video remains session-only and never overwrites the remembered audio mode. |
| Light caching | Complete: audio is reconciled strictly to the next three queue entries; artwork is bounded to current plus next three; cache ownership is stable per account/version; stale owned versions are swept; unrelated account caches are preserved; clear/logout cleanup is explicit. |
| Responsive UI and accessibility | Complete for the audited surfaces: desktop/compact/mobile shell, viewport-locked full player, bounded queue surface, reduced-motion handling, URL-addressable Library tabs, complete Home sections/actions, keyboard-navigable menus, focus-trapped dialogs, Escape/outside dismissal where appropriate, and focus restoration are implemented. |
| Large-library performance | Complete for the defined automated gates: playlist and queue DOM are bounded/windowed, song lookup is pre-indexed, 1,000/1,200-item contracts pass, and deterministic repeated playback/navigation resource-retention soak tests pass. |
| Search and resilience | Complete: artist/release navigation and shared actions are present; transient failures retain the last usable server results, label them as previous results, expose Retry, and recover without discarding local matches. Reauthentication preserves a bounded, expiring, non-sensitive route/queue/playback snapshot. |
| Home and presentation polish | Complete: Quick Picks Play all and overflow actions, Top songs, Recently added, the Show OSTs on Home preference, singular “Anime” copy, removal of the inert notification affordance, and omission of unknown-duration placeholders are implemented. |
| Root/API/error boundary | Complete: the SPA remains at `/`, browser requests use `/api`, server/external access stays behind server APIs, and safe expandable 404/500 diagnostics remain in place. |
| Downloads/offline, analytics, crash logging | Intentionally excluded, matching the original web scope. |

### Closeout verification

- Web: 62 test files and 283 tests pass; coverage is 83.99% statements, 77.18% branches, 81.46% functions, and 89.33% lines; TypeScript and the production Vite build pass.
- Server: 75 test files pass with 11 skipped; 628 tests pass with 40 skipped; TypeScript passes.
- Android reference: focused queue, API, playlist, sync-source, artist, and related-music suites pass. Pixel 7 Pro runtime checks confirmed the mature queue/sync semantics and no FATAL/ANR; the final Phase 4 visual replay was blocked when the device returned to its biometric lockscreen.
- QA runtime: the current server/web image is deployed to the isolated QA stack; database and API are healthy; `/healthz` and `/` return 200; the persisted synthetic fixture remains present.
- Browser automation limitation: after a failed localhost navigation was replaced with a `data:` error document, the in-app Browser URL policy refused navigation back to the healthy localhost origin. Current UI behavior is therefore covered by component/integration tests and the deployed HTTP runtime, but a final authenticated visual replay in that browser is not claimed.
- OS-specific Media Session presentation and live heap snapshots still require manual browser/OS observation on Windows/macOS/mobile; the implementation and deterministic lifecycle gates are complete, but those external observations are not overstated.
