# Shared Top picks

## Problem

Android Home shuffled its theme list on every Room emission. A startup library
pull produces multiple emissions, so the six visible picks repeatedly changed.
Web selected a separate collection from its local library projection, played
only that preview, and sent See all to the generic Songs tab.

## Decisions

- The authenticated server API selects the collection for both clients.
- Home requests six items. Play and See all request up to sixty items from the
  same snapshot; the Home preview is its ordered prefix.
- The server interleaves favorites, most-played tracks, and discovery tracks
  (unplayed first, then less-played tracks). Stable tie-breaking and diversity
  across anime prevent repeated requests from acting as a shuffle button.
- Selection is limited to the user's active library. Disliked/unavailable items
  and duplicate full-size songs are excluded.
- Disabling OSTs/extra tracks limits picks to openings and endings. OP/ED chips
  narrow the same server selection even when extras are otherwise enabled.
- Snapshots last thirty minutes and are scoped to the user and filter settings.
  Expired snapshots are replaced coherently when an expanded collection is
  requested. Newly ineligible items may be removed without inserting substitutes.
- Sync emissions and playback history updates do not rerank a visible preview.
- The Top picks action is called Play. Web Songs also gains Play and Shuffle
  for the complete matching collection, independent of rendered pagination.

## Acceptance checks

- Preview/full prefix, deterministic selection, account/scope isolation, expiry,
  concurrent requests, favorites/history/discovery, media eligibility and extras.
- Startup and subsequent library sync do not replace the visible picks.
- Play queues the expanded collection; See all shows the same collection.
- Changing filters cannot apply stale responses from the previous scope.
- Offline/error handling preserves a usable, account-scoped last collection.
- Songs Play/Shuffle include results beyond the first rendered page.
- Real browser and connected-device checks are reported separately from unit
  and database tests. Local QA uses synthetic data and audio, not production.

Server changes must be deployed with the clients; old servers do not implement
the new endpoint. This PR does not itself deploy production.

## Verification

- Server: 755 tests passed, 2 skipped, including the PostgreSQL snapshot and
  migration integration tests; TypeScript typecheck passed. The final full run
  used two workers to avoid local database contention with the Android build.
- Web: 372 tests passed; TypeScript typecheck and production build passed.
- Android: 707 unit tests passed; debug APK assembly and lint passed (zero
  errors; 127 lint warnings).
- Browser against the real shared API with synthetic library/audio: six stable
  preview items during 35 seconds of repeated sync updates; See all and Play use
  sixty items; OST exclusion and OP filtering; Songs Play and Shuffle include all
  seventy-five themes beyond the first rendered page; full-only audio plays from
  the song endpoint. Expanded UI was checked at a narrow phone viewport.
- Physical Pixel 7 Pro: six unchanged picks across more than one minute of sync
  updates; sixty-item expanded snapshot/queue; full-size-only audio reached
  PLAYING; OST-enabled soundtrack rows and OST-off/OP/ED scopes; cold restart
  retained the sixty-item queue; cached Home remained available offline. The
  final expanded UI was visually checked after removing inactive overflow icons.
- The device's original APK, Room database/WAL, queue, auth/session preferences,
  and WorkManager data were restored and independently checked against hashes.
  Test port forwarding was removed. No production deployment was performed.
