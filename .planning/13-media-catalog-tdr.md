# TDR — Media Catalog, Playback Modes, and Related Music

**Status:** Approved technical direction

**Date:** 2026-07-19

**Branch:** feature/media-catalog-initiative

**Product source:** [12-media-catalog-prd.md](12-media-catalog-prd.md)

**Implementation backlog:** [14-media-catalog-tickets.md](14-media-catalog-tickets.md)

## 1. Decision summary

Anime Ongaku will add a small server-owned music catalog beside the existing
theme catalog. The existing anime theme remains the queue item for TV Size,
Full Size, and Video. A separate catalog song is the queue item for Related
Music.

The implementation will:

1. Keep the existing TV-size media URL and file layout unchanged.
2. Store an accepted complete song once as a catalog song, then link one or
   more anime themes to it as their Full Size mode.
3. Store season-related releases and tracks under the owning anime.
4. Stream Full Size and Related Music from the Anime Ongaku server in the
   original acquired format.
5. Stream Video directly from AnimeThemes with no Anime Ongaku proxy, server
   cache, Media3 cache, or device download.
6. Reuse the existing PostgreSQL job queue, upstream HTTP policies, media
   store, Fastify API, Room cache, Media3 session, and WorkManager download
   pipeline.
7. Put acquisition behind a provider interface. Lidarr is the first adapter,
   not part of the product domain or Android API.
8. Use deterministic, conservative matching and expose only ready media to
   listeners.

This is a private self-hosted application. The design intentionally avoids
microservices, message brokers, webhooks, distributed locks, full-text search
infrastructure, transcoding profiles, complex role systems, and production
scale hardening.

## 2. Existing foundation

### 2.1 Server

The current Node 22 server already provides the correct building blocks:

- Fastify 5 routes with Zod validation and a consistent error envelope.
- PostgreSQL and Drizzle migrations.
- A durable jobs table, retry/backoff, two worker lanes, priority handling,
  and operator retry routes.
- Thin Kitsu and AnimeThemes clients on a shared upstream HTTP abstraction
  with token buckets, retries, and circuit breakers.
- A media store that writes temporary files, hashes them, atomically moves
  them, and tracks readiness in media_files.
- A multi-variant media schema spike with the TV-size canonical invariant.
- A delta-oriented changes feed used by Android.

The server is theme-centric today. It has no general song, release, related
track, acquisition, or discovery-run model.

### 2.2 Android

The Android app already has:

- Room as a local-first cache.
- A queue with per-occurrence queueId identity.
- NowPlayingManager, MediaControllerManager, MediaPlaybackService, and
  ExoPlayer/Media3.
- Persisted queue state.
- A WorkManager device-download pipeline with retry, pause, Wi-Fi-only, and
  offline behavior.
- Anime Detail, Search, Home, Settings, expanded Now Playing, action sheets,
  and playlist screens.

The queue and playlists are ThemeEntity-only today. Related tracks require a
real playable-item abstraction; synthetic themes would corrupt theme
preferences, anime ownership, sync, and queue restoration.

## 3. Architectural boundaries

~~~mermaid
flowchart LR
    AT["AnimeThemes API and video CDN"] -->|"theme, song, entry, video metadata"| Catalog["Anime Ongaku catalog"]
    LP["Lidarr adapter"] -->|"search, acquire, imported file metadata"| Resolver["Music resolver and matcher"]
    Resolver --> Jobs["Existing PostgreSQL job queue"]
    Jobs --> Importer["Validated original-file importer"]
    Importer --> Media["Anime Ongaku media root"]
    Importer --> Catalog
    Catalog --> API["Fastify v1 API"]
    Media --> API
    API --> Sync["Android Room sync/cache"]
    Sync --> Queue["Unified queue and mode resolver"]
    Queue --> Media3["Media3 session and player"]
    AT -->|"direct video URL"| Media3
    Queue --> Downloads["WorkManager device downloads"]
~~~

The ownership rules are:

- AnimeThemes is authoritative for anime theme, song relationship, entry, and
  direct video metadata.
- The acquisition provider is authoritative only for its own release,
  command, and imported-file state.
- Anime Ongaku is authoritative for anime-season relationships, match
  confidence, listener visibility, playlists, preferences, and its cached
  audio.
- Android is authoritative for device downloads, current queue/session state,
  and device-local playback settings.

## 4. Domain model

### 4.1 Playable identities

There are two playable catalog identities.

| Identity | Purpose | Supported playback modes |
|---|---|---|
| THEME | Existing anime OP/ED queue item | TV_SIZE, FULL_SIZE when linked and ready, VIDEO when online and linked |
| SONG | A Related Music track | AUDIO only |

Full Size is not a separate queue item. A theme links to a catalog song and
uses that song's original audio when FULL_SIZE resolves.

Related Music uses SONG because it may not be an opening or ending and must not
inherit theme-only behavior.

### 4.2 Server tables

The next Drizzle migration adds the following global catalog tables.

#### songs

One accepted original recording used either as Full Size, Related Music, or
both.

| Column | Notes |
|---|---|
| id | bigserial primary key |
| animethemes_song_id | nullable unique AnimeThemes song identity |
| musicbrainz_recording_id | nullable unique preferred cross-provider identity |
| title | display title |
| normalized_title | deterministic matcher/search key |
| artist_credit | display artist string |
| normalized_artist | deterministic matcher/search key |
| duration_seconds | nullable evidence and display value |
| updated_at, deleted_at | sync and tombstone fields |

The first implementation intentionally treats the accepted original studio
recording as the song identity. Alternate recordings, remasters, live versions,
and covers remain excluded rather than adding a recording hierarchy.

#### music_releases

| Column | Notes |
|---|---|
| id | bigserial primary key |
| provider | LIDARR initially |
| provider_release_id | provider/MusicBrainz release-group identity |
| title, normalized_title | display and matching |
| artist_credit | display |
| release_type | SOUNDTRACK, CHARACTER, IMAGE, THEME, INSERT, OTHER |
| release_date | nullable |
| artwork_url | nullable remote artwork |
| updated_at, deleted_at | sync fields |

Unique provider plus provider_release_id prevents repeated catalog releases.

#### release_tracks

Joins music_releases to songs with disc_number, track_number, and display_order.
A song may appear on more than one release without duplicating its audio.

#### anime_music_releases

Joins animethemes_anime to music_releases and stores:

- relationship type.
- confidence score.
- compact JSON evidence used by operator diagnostics.

This table is the season-specific ownership boundary.

#### theme_full_songs

One row per theme:

- theme_id primary key.
- song_id.
- source_release_id when known.
- confidence score.
- JSON evidence.
- matched_at and updated_at.

A unique theme link guarantees one Full Size choice. Multiple themes may point
to the same song.

#### theme_video_sources

Stores remote AnimeThemes descriptors, never media files:

- AnimeThemes video ID and entry ID.
- theme ID and entry version/order.
- direct link and MIME type.
- resolution and source.
- spoiler, NSFW, creditless, subbed, and lyrics flags when supplied.
- stable preference rank and updated_at.

The server computes one selected descriptor for normal clients using the PRD
ordering. The full set remains available for re-selection and diagnostics.

#### music_discovery_state

One scheduling row per AnimeThemes anime:

- last_attempt_at, last_success_at, next_scan_at.
- status: NEVER, DUE, RUNNING, COMPLETE, FAILED.
- missing_full_count.
- failure_count and last_error.

#### music_acquisitions

Durable adapter workflow state:

- provider and provider job/release IDs.
- AnimeThemes anime ID.
- purpose: FULL_SIZE or RELATED_RELEASE.
- target theme/song/release IDs as applicable.
- state: REQUESTED, ACQUIRING, IMPORTING, READY, FAILED, AMBIGUOUS.
- whether Anime Ongaku created the provider resource.
- prior provider monitoring state for safe cleanup.
- timestamps, retry time, error, and compact provider metadata JSON.

Provider state never appears in listener APIs.

### 4.3 Existing table changes

#### media_files

Keep the table and lifecycle, adding:

- content_type.
- source_file_name.

Media reference keys are:

- Existing TV Size: kind AUDIO, ref_id equal to the raw theme ID, variant
  SHORT. This is frozen.
- Catalog song audio: kind AUDIO, ref_id equal to song:{songId}, variant
  ORIGINAL.
- Images remain DEFAULT.

ORIGINAL is added to the TypeScript MediaVariant union. It describes the stored
source file; Full Size remains a user-facing playback mode.

#### playlists and playlist_entries

Add playlists.default_mode with TV_SIZE as its default.

Playlist entries become polymorphic and independently identifiable:

- id bigserial primary key.
- playlist_id.
- item_type: THEME or SONG.
- item_id.
- order_index.
- mode_override: null, TV_SIZE, or FULL_SIZE.

Related SONG entries ignore playlist default and mode_override because they
have one audio representation. Duplicate items remain valid because entry ID,
not item ID, identifies an occurrence.

#### theme_prefs

Keep the existing broad disliked value and add:

- disliked_tv_size.
- disliked_full_size.

Broad Dislike suppresses all modes of the theme's song. A mode-specific action
clears broad Dislike and sets only the chosen audio-mode flag. There is no
video-only dislike.

#### song_prefs and play_events

Add song_prefs for Related Music likes/dislikes and aggregate play state.

Add a simple append-only play_events table with user ID, client_event_id, item
type, item ID, actual mode, and played_at. The unique user ID plus
client_event_id pair makes offline upload retries idempotent. The existing
theme play count continues to be updated for compatibility. No analytics
warehouse, partitioning, or retention service is needed.

## 5. Media storage and serving

### 5.1 Frozen TV Size behavior

These invariants remain:

- GET and HEAD /v1/media/audio/{themeId} address TV Size.
- audio/{themeId}.ogg remains its server path.
- Existing Android downloads remain valid.
- Existing queue and preference theme IDs remain valid.

### 5.2 Catalog-song audio

Accepted Full Size and Related Music files are copied byte-for-byte into:

audio/songs/{songId}/original.{safeExtension}

The importer:

1. Resolves the provider path through configured path mapping.
2. Confirms the source is inside the read-only mounted provider root.
3. Allows supported original audio extensions and rejects non-audio files.
4. Copies to a temporary file under MEDIA_ROOT.
5. Hashes during copy.
6. Verifies non-zero size and optional duration evidence.
7. Atomically moves the file into place.
8. Marks media_files READY with content type, size, hash, and original name.

No transcoding, normalization, volume adjustment, or quality choice occurs.

The server streams it through:

- GET /v1/media/songs/{songId}/audio
- HEAD /v1/media/songs/{songId}/audio

Both use the current authenticated media-read policy, byte-range behavior,
ETag, content type, and immutable cache headers.

Unlike TV Size, catalog songs are exposed only after READY. There is no
listener request route and no proxy-on-miss behavior.

### 5.3 Video

Video uses the selected theme_video_sources.link directly.

The server does not:

- add a VIDEO media_files row.
- enqueue a video fetch job.
- proxy video bytes.
- copy video to MEDIA_ROOT.

Android must route direct AnimeThemes video through an unauthenticated,
non-caching HTTP data source. This prevents both accidental video caching and
sending the Anime Ongaku bearer token to AnimeThemes.

The previous spike's downloadable VIDEO/FULL descriptor is superseded by this
remote-descriptor design.

## 6. AnimeThemes catalog changes

The AnimeThemes include graph will retain:

- anime theme and theme song IDs.
- song title, artists, and song resources when available.
- every theme entry and video candidate needed for selection.
- entry version/order and spoiler/NSFW data.
- video link, MIME type, resolution, source, and presentation flags.

The parser must stop flattening candidates and selecting the first usable
video. It will parse all candidates, persist them, and select deterministically:

1. Exact current theme and song.
2. Non-NSFW and non-spoiler.
3. Earliest matching entry/version.
4. Preferred/default source and best usable resolution.
5. Stable AnimeThemes video ID tie-breaker.

If only warned content exists, the descriptor is returned with its warning
flags so Android can apply the approved confirmation behavior.

## 7. Discovery, matching, and acquisition

### 7.1 Provider contracts

Catalog reasoning and acquisition stay separate.

MusicCatalogResolver owns:

- multilingual query generation.
- candidate normalization.
- confidence scoring and evidence.
- Full Size exclusions.
- season-specific relationship classification.

MusicAcquisitionProvider owns:

- health check.
- release lookup.
- ensuring a release exists in the provider.
- starting acquisition.
- reporting acquisition/command state.
- listing imported tracks and file paths.
- cleanup of adapter-created provider resources.

LidarrAcquisitionProvider will be a thin TypeScript adapter using the existing
UpstreamHttp and Zod patterns. No third-party Lidarr SDK is necessary.

### 7.2 Lidarr configuration

When MUSIC_PROVIDER is LIDARR, require:

- LIDARR_BASE_URL.
- LIDARR_API_KEY.
- LIDARR_ROOT_FOLDER_PATH.
- LIDARR_SHARED_ROOT.
- LIDARR_PATH_PREFIX_FROM and LIDARR_PATH_PREFIX_TO when container paths
  differ.
- LIDARR_QUALITY_PROFILE_ID.
- LIDARR_METADATA_PROFILE_ID.
- optional LIDARR_OWNERSHIP_TAG_ID.

The operator configures Lidarr indexers, download client, quality profile,
metadata profile, and root folder. Anime Ongaku does not implement those
systems.

The API key is sent only from the server in X-Api-Key and is redacted from
logs.

### 7.3 Lidarr adapter flow

Lidarr is album-oriented and cannot independently acquire one track.

For a selected target release, the adapter:

1. Looks up the album/release group.
2. Reuses an existing operator album when present, recording prior state.
3. Otherwise creates and tags an adapter-owned album.
4. Starts AlbumSearch and records the command ID.
5. Polls command, queue, history, track, and track-file state through durable
   Anime Ongaku jobs.
6. Returns imported file metadata and MusicBrainz IDs.
7. Cleans up only adapter-owned temporary resources after Anime Ongaku copies
   validated files.

Anime Ongaku never deletes a pre-existing operator album. Download-client
cleanup and seeding remain provider concerns.

### 7.4 Query generation

For Full Size, generate a deduplicated query matrix from:

- theme song title plus artist.
- song title alone.
- English, romaji, and Japanese anime title plus song title.
- AnimeThemes song and resource IDs when available.

For Related Music, use each anime title alias with:

- original soundtrack and OST.
- character song.
- image song/image album.
- insert song.
- official soundtrack terminology in English and Japanese.

Queries run sequentially through the background upstream budget. Results are
merged by provider/MusicBrainz identity before scoring.

### 7.5 Matching

Matching is deterministic and conservative. Normalization uses Unicode NFKC,
case folding, punctuation/whitespace removal, and token comparison. The first
implementation does not need an ML service or a generic recommendation engine.

Full Size hard gates:

- Exact MusicBrainz recording identity when both sides provide it, or strong
  title plus artist agreement.
- Duration must be plausibly longer than TV Size and close to provider track
  duration when both are known.
- Reject instrumental, off-vocal, karaoke, live, remix, cover, TV-size, short,
  edit, and alternate-performer indicators.
- A single target track must be identifiable inside the release.

Suggested Full Size score:

| Evidence | Points |
|---|---:|
| MusicBrainz recording ID exact | 60 |
| normalized song title exact/near-exact | 30 |
| normalized artist exact/near-exact | 25 |
| duration within tolerance | 15 |
| release title contains anime alias | 10 |
| official/expected release type and date | 5 |

Accept at 85 or above with at least a 10-point margin over the next candidate.
An exact conflicting MusicBrainz ID is an automatic rejection.

Related release hard gates:

- The release title, explicit metadata, or provider identity must tie it to an
  anime title alias.
- Artist membership alone is insufficient.
- Relationship type must be classifiable.

Accept at 80 or above with a 10-point margin. Store the score and evidence JSON.
Below-threshold or close candidates become AMBIGUOUS and remain operator-only.

Thresholds are named constants with fixture-based tests, not environment
settings in the first release.

### 7.6 Automatic schedule

Reuse the existing scheduler and jobs table:

- MUSIC_CATALOG_SCAN runs daily and only enqueues bounded work.
- New anime mappings enqueue immediate DISCOVER_ANIME_MUSIC.
- Anime released within the previous year are due weekly.
- Any anime still missing at least one Full Size song is due monthly,
  regardless of age.
- Older anime with all Full Size matches and no recent-release rule are not
  repeatedly scanned.

The daily scan chooses the oldest due rows first and enqueues at most 25 anime.
This keeps a private server responsive without pagination or distributed work.

New job types:

| Job | Purpose |
|---|---|
| MUSIC_CATALOG_SCAN | Select due anime and enqueue discovery |
| DISCOVER_ANIME_MUSIC | Run query matrix, score, create links/acquisitions |
| RECONCILE_MUSIC_ACQUISITION | Poll provider without holding a worker |
| IMPORT_MUSIC_AUDIO | Copy only validated files into Anime Ongaku |

Provider download waits never block a worker loop. Reconciliation jobs requeue
themselves with next_run_at and increment attempts only for real failures.

### 7.7 Retention

For Full Size, only the validated target file is copied into Anime Ongaku.

For a Related Release, only tracks classified as belonging to that accepted
release are copied. The release can retain all of those tracks.

Unrelated files may remain in Lidarr or its download client, but they never
enter the Anime Ongaku catalog or media cache. This is the operational meaning
of discarding unrelated tracks.

## 8. Server API

### 8.1 Compatibility strategy

Keep /v1 and make read contracts additive. Existing fields remain until all
installed Android clients have migrated.

The private deployment permits a coordinated server/app update for playlist
writes. To prevent accidental data loss, the server returns 409
PLAYLIST_REQUIRES_NEW_CLIENT if a legacy entries-only update would overwrite a
playlist containing SONG entries or mode overrides.

### 8.2 Theme modes

OngakuThemeDto keeps audioUrl, videoUrl, audioState, durationSeconds, and
fileSize for old clients. videoUrl remains null for old semantics until the new
client uses mediaModes.

Add:

~~~json
{
  "mediaModes": {
    "tvSize": {
      "url": "/v1/media/audio/4567",
      "durationSeconds": 90,
      "fileSize": 5242880
    },
    "fullSize": {
      "songId": 91,
      "url": "/v1/media/songs/91/audio",
      "durationSeconds": 247,
      "fileSize": 38124567,
      "sourceReleaseId": 22
    },
    "video": {
      "url": "https://v.animethemes.moe/example.webm",
      "mimeType": "video/webm",
      "spoiler": false,
      "nsfw": false,
      "entryVersion": 1
    }
  }
}
~~~

fullSize and video are null when not usable. TV Size remains present.

Themes.updated_at is bumped when a selected Full Size link or video descriptor
changes so the normal changes cursor delivers the update.

### 8.3 Related Music

Add:

- GET /v1/anime/{kitsuId}/music
- GET /v1/music/releases/{releaseId}
- GET /v1/media/songs/{songId}/audio
- HEAD /v1/media/songs/{songId}/audio

Anime music returns ready releases only, each with relationship, artwork,
artist, year, and ordered ready tracks. A release with no ready tracks is
omitted.

The existing GET /v1/search response gains a music field containing ready
release and track matches with their owning anime summary. Search uses simple
PostgreSQL ILIKE over normalized title, artist, release, and anime aliases with
a limit of 25 results per kind. PostgreSQL full-text search is unnecessary at
this scale.

### 8.4 Changes feed

GET /v1/changes retains its current delta arrays and adds musicCatalog:

- a complete snapshot of ready releases/tracks for anime in the user's current
  library.
- theme Full Size mode data remains on changed theme DTOs.
- songPrefs is a normal updated-at delta array with tombstones, parallel to
  theme prefs.

Android replaces its anime-music junction snapshot transactionally on each
successful pull. A full snapshot is deliberately simpler than tombstoning
every release junction and is small for a private library.

Downloads remain valid because they are keyed by stable item/media keys, not by
the snapshot row instance.

### 8.5 Playlist contract

Playlist response adds:

~~~json
{
  "defaultMode": "TV_SIZE",
  "items": [
    {
      "entryId": 10,
      "itemType": "THEME",
      "itemId": 4567,
      "modeOverride": null
    },
    {
      "entryId": 11,
      "itemType": "SONG",
      "itemId": 91,
      "modeOverride": null
    }
  ]
}
~~~

Legacy entries remains a theme-ID projection for old reads. New writes send
defaultMode and items. The server validates:

- THEME overrides are null, TV_SIZE, or FULL_SIZE.
- SONG overrides are null.
- FULL_SIZE may be stored before it is locally downloaded, but the referenced
  theme must exist.
- entry order and duplicate occurrences are preserved.

### 8.6 Preferences and plays

Theme preference reads/writes add dislikedTvSize and dislikedFullSize.

Add song preference routes:

- GET /v1/prefs/songs
- PUT /v1/prefs/songs/{songId}

Play batches accept clientEventId, itemType, itemId, actualMode, and playedAt.
New Android clients generate a UUID when the local pending event is created and
reuse it for every retry. For a transition period, themeId-only events map to
THEME plus TV_SIZE and retain the existing aggregate behavior. Server
aggregation keeps existing theme play counts working.

### 8.7 Error behavior

Use the existing error envelope and these codes:

| Status | Code | Meaning |
|---:|---|---|
| 404 | MUSIC_NOT_FOUND | Song/release is not in the ready catalog |
| 409 | PLAYLIST_REQUIRES_NEW_CLIENT | Legacy write would lose new entry data |
| 416 | RANGE_NOT_SATISFIABLE | Existing media range semantics |
| 503 | MUSIC_MEDIA_UNAVAILABLE | A catalog row exists but its cached file is missing |
| 502 | MUSIC_PROVIDER_FAILED | Operator/admin provider call failed |

Listener routes do not return SEARCHING, DOWNLOADING, FAILED, or AMBIGUOUS
catalog candidates.

## 9. Android data architecture

### 9.1 Room

Add:

- SongEntity.
- MusicReleaseEntity.
- ReleaseTrackEntity.
- AnimeMusicReleaseEntity.
- ThemeModeEntity as the one-to-one theme mode cache.
- SongPreferenceEntity.
- PlayEvent mode fields.
- polymorphic PlaylistEntryEntity with entryId.
- generalized DownloadItemEntity and DownloadGroupItemEntity.

ThemeEntity may expose joined convenience data but must not duplicate a Full
Size file path or related-release rows.

The migration:

1. Preserves every ThemeEntity.
2. Migrates each existing playlist theme row into a THEME entry with null
   override and generated stable entry ID.
3. Migrates existing completed downloads into TV_SIZE media keys.
4. Preserves existing TV local paths and isDownloaded compatibility during the
   transition.
5. Defaults every playlist to TV_SIZE.
6. Defaults Show OSTs on Home to true.

### 9.2 Unified queue

Introduce:

~~~text
PlayableKey(type, id)
PlayableItem.Theme(theme, cached mode descriptors)
PlayableItem.RelatedSong(song, owning anime/release)
QueueEntry(queueId, playableItem, baseModePolicy)
~~~

NowPlayingManager continues to own queue order, shuffle, history, Play Next,
Add to Queue, suggestions, and per-occurrence queue identity.

Queue persistence stores queueId plus PlayableKey and resolves the entity from
the correct DAO. Legacy persisted themeId entries restore as THEME.

All existing duplicate-song queue invariants remain mandatory.

### 9.3 Mode state and precedence

Define:

- PlaybackMode: TV_SIZE, FULL_SIZE, VIDEO, RELATED_AUDIO.
- ThemeModePolicy: INHERIT, TV_SIZE, FULL_SIZE.
- preferredMode: the current user intent.
- actualMode: the resolved mode currently in Media3.
- sessionOverride: a manual selector choice for subsequent theme entries.

Device-persistent remembered audio mode is TV_SIZE or FULL_SIZE. VIDEO is never
persisted as a remembered mode.

On queue/context replacement:

1. Clear sessionOverride.
2. If the context starts with Play Video, preferredMode is VIDEO.
3. Otherwise each playlist theme entry resolves entry override, then playlist
   default, then remembered audio mode.
4. A manual selector choice becomes sessionOverride for subsequent theme
   entries without editing the playlist.

Fallback:

- FULL_SIZE to TV_SIZE.
- VIDEO to TV_SIZE.
- TV_SIZE to FULL_SIZE only if TV Size is unavailable.
- Never automatically enter VIDEO unless preferred.
- Related songs resolve only RELATED_AUDIO.

Offline resolution requires the exact local media key. It never substitutes a
different mode.

### 9.4 Media3

PlaybackResolver produces a ResolvedPlaybackItem containing:

- queueId.
- playable key.
- preferred and actual mode.
- URI and optional local file URI.
- title, artist, anime/release, artwork.
- warning flags.

MediaItem.mediaId remains the queueId string. Actual mode and playable identity
go into MediaMetadata extras so MediaController synchronization continues to
use queue occurrence identity.

When mode changes:

1. Resolve the current entry and upcoming theme entries.
2. Replace Media3 items while keeping their mediaId/queueId.
3. Keep the current queue index.
4. Start Full Size and Video at 0:00.
5. Preserve play/pause intent.

On the next queue item, resolve preferred mode again rather than copying the
previous actual fallback.

### 9.5 Origin-aware data sources

Replace the single authenticated cached HTTP path with routing:

- Anime Ongaku audio host: authenticated and CacheDataSource-enabled.
- Direct AnimeThemes video host: unauthenticated and no SimpleCache.
- file/content URIs: DefaultDataSource local handling.

The routing decision is made from the final URI and active server base URL.
Bearer headers must never be sent to a non-server host.

### 9.6 Video UI

Add the Media3 UI dependency and host PlayerView through AndroidView.

Portrait:

- Compact top-center TV Size, Full Size, Video segmented pill.
- Video replaces the art region edge-to-edge.
- Existing Now Playing content and queue controls remain.

Landscape while Video is actual:

- Player fills the screen.
- A tap toggles a hideable bottom control center.
- Like/dislike, previous, next, play/pause, seek, and exit are available.
- System bars may hide while controls are hidden.

During fallback, select the actual mode segment and show a subtle retained
preference message. Hide unavailable Video while offline or without a link.

### 9.7 Related Music UI

Repository queries expose releases by anime and ready track search results.

Add:

- Related Music preview section on Anime Detail.
- Nested Related Music route and release/track list.
- Now Playing overflow link for the owning anime.
- Music sections in global Search.
- standard play, Play Next, Add to Queue, Save to Playlist, like, and Download
  actions for SONG.

There is no top-level album destination.

### 9.8 Device downloads

Use stable MediaKey values:

- THEME:{themeId}:TV_SIZE
- SONG:{songId}:AUDIO

A theme Full Size download resolves to its SONG key. This permits one physical
file even when the same complete song is linked to multiple themes or a source
release.

Suggested device paths:

- Existing TV path remains supported.
- songs/{songId}/original.{extension} for Full Size and Related Music.

Download groups become display relationships:

- Full Size SONG key appears under its anime/theme group.
- Related SONG keys appear under expandable album groups.
- Playlist groups point to the exact resolved media keys.
- Multiple groups may reference one DownloadItemEntity.

DownloadWorker reads server content type/filename where available and preserves
the original bytes. Video never creates a download row.

### 9.9 Reactions, Home, and settings

Normal theme Dislike sets broad dislike. Long-press and an accessible overflow
action set TV-only or Full-only dislike.

Related songs use SongPreferenceEntity.

Add device-local settings:

- remembered audio mode, default TV_SIZE.
- Show OSTs on Home, default true.

Home combines existing theme candidates with:

- ready OST songs when the setting is on.
- other Related Music only when that song is liked.

## 10. End-to-end flows

### 10.1 Full Size discovery

~~~mermaid
sequenceDiagram
    participant S as Scheduler
    participant R as Resolver
    participant L as Lidarr
    participant I as Importer
    participant D as Database
    S->>R: DISCOVER_ANIME_MUSIC
    R->>L: multilingual release lookups
    L-->>R: candidate releases/tracks
    R->>D: score and evidence
    R->>L: ensure album and AlbumSearch
    S->>L: reconcile command/import state
    L-->>S: track files and IDs
    S->>I: validated target file
    I->>D: copy/hash and mark READY
    D->>D: link theme to song and bump theme updated_at
~~~

### 10.2 Switch mode

The selector writes session intent, PlaybackResolver resolves the same
QueueEntry, MediaControllerManager replaces the current MediaItem with the same
mediaId, starts the new source at zero, and retains the surrounding queue.

### 10.3 Video failure

If direct playback fails, Android reports a finite error, resolves TV Size for
the same queue entry, replaces only that item, and keeps VIDEO preferred for the
next queue item. Offline state removes Video availability before selection.

### 10.4 Playlist download

Each THEME item resolves entry override, playlist default, then remembered mode
when no playlist policy exists. SONG items resolve their only audio. WorkManager
downloads those exact MediaKeys. Offline playback treats a missing required key
as unavailable.

## 11. Operations and deployment

The server remains one API container plus PostgreSQL.

When Lidarr integration is enabled:

- Add environment variables documented in .env.example and README.
- Mount the Lidarr-imported music root read-only into the Anime Ongaku API
  container.
- Mount MEDIA_ROOT read-write as today.
- Prefer a dedicated Lidarr root folder or instance.

Health:

- /healthz continues to cover database and media root.
- Operator music diagnostics report provider configured/reachable separately;
  a down Lidarr does not make Anime Ongaku unhealthy.

Operator routes:

- GET /v1/jobs?status=failed continues to show failed jobs.
- GET /v1/admin/music/acquisitions lists non-ready workflows.
- POST /v1/admin/music/acquisitions/{id}/retry requeues a failed workflow.
- DELETE /v1/admin/music/songs/{id}/media removes only Anime Ongaku's cached
  file and marks it missing. It does not alter personal likes/playlists or
  provider media.

Manual candidate approval is deferred. Ambiguous matches stay absent until a
later operator-resolution feature or a future scan becomes confident.

## 12. Basic security and reliability

Required basics:

- Keep listener/catalog writes authenticated as current routes are.
- Keep Lidarr API credentials server-only and redact them from logs.
- Never send Anime Ongaku bearer headers to AnimeThemes.
- Resolve and validate mounted provider paths before copying.
- Validate all new route bodies with Zod.
- Copy through a temporary file, hash, and atomically rename.
- Only delete provider resources explicitly recorded as adapter-created.
- Keep acquisition and discovery idempotent through database uniqueness and
  job dedupe keys.
- Preserve existing retry/backoff and circuit-breaker behavior.

Explicitly not required:

- New user roles or cross-account playlist ACLs.
- Per-user media encryption.
- Multi-node job leases beyond the current jobs table.
- Webhook signature infrastructure.
- Virus scanning.
- Complex quotas or abuse rate limits.
- Transcoding or adaptive bitrate.

## 13. Logging and diagnostics

Structured logs include:

- anime/theme/song/release internal IDs.
- provider command/acquisition ID.
- discovery query count, candidate count, selected score, and rejection reason.
- import source basename, byte size, hash, and final media key.
- preferred and actual mode transitions on Android debug logs.

Do not log:

- Lidarr API keys.
- session bearer tokens.
- full provider query responses.
- complete local provider filesystem paths at info level.

Discovery evidence JSON is compact and operator-only. No metrics platform is
required.

## 14. Testing strategy

### 14.1 Server

Unit tests:

- AnimeThemes candidate parsing and deterministic video ordering.
- title/artist normalization and multilingual query generation.
- Full Size exclusion keywords.
- confidence thresholds, margin rules, and evidence.
- Lidarr response parsing and ownership-safe cleanup.
- provider path mapping and traversal rejection.
- original-format import, hash, content type, and idempotency.
- job scheduling/reconciliation without long worker blocking.

Route/contract tests:

- additive theme mediaModes.
- ready-only Related Music and Search.
- catalog-song GET/HEAD and byte ranges.
- playlist polymorphic entries/default/overrides.
- legacy playlist overwrite conflict.
- mode-specific preferences and play events.
- authenticated media reads under current policy.

Migration tests:

- existing media_files and TV paths survive.
- existing playlists gain TV_SIZE default.
- duplicate playlist occurrences survive.

### 14.2 Android

Unit tests:

- Room DTO mapping and migration.
- PlayableKey queue restoration.
- every preferred/actual fallback pair.
- playlist precedence and session override reset.
- exact-mode offline resolution.
- mode switch preserves queueId and queue order.
- duplicate theme and SONG queue occurrences.
- origin-aware header/cache routing.
- reaction scopes.
- download MediaKey dedupe and group membership.
- OST Home filtering.

Compose/instrumented tests:

- top selector availability and actual-mode state.
- portrait video replacement.
- landscape controls and hide/show.
- Related Music navigation and search ownership.
- playlist add-mode choices.
- long-press and accessible mode-specific dislike.
- expandable album downloads and individual removal.

Device acceptance:

- TV to Full and back while playing.
- preferred Full fallback and return on the next eligible item.
- Video direct playback, rotation, controls, and next-item fallback.
- no Video while offline.
- playlist exact-mode download and airplane-mode playback.
- related album download and individual deletion.
- old TV-size download still plays.

## 15. Migration and rollout

Implement in four deployable stages:

1. **Server catalog foundation:** schema, AnimeThemes metadata, provider
   adapter, matcher, jobs, importer, and hidden operator diagnostics. Listener
   behavior remains unchanged.
2. **Additive read APIs and Android data model:** server begins returning
   mediaModes/musicCatalog; Android stores but does not yet expose them.
3. **Playback and UI:** unified queue, mode resolver, video, Related Music,
   playlists, reactions, Home, and downloads.
4. **Enable discovery:** configure Lidarr, run a small acceptance catalog,
   inspect matches, then enable the daily scheduler.

There is no feature-flag service. Use two simple server config switches:

- MUSIC_CATALOG_ENABLED controls listener exposure.
- MUSIC_DISCOVERY_ENABLED controls scheduled provider work.

Rollback:

- Disable discovery to stop new work.
- Disable catalog exposure to return clients to TV-size behavior.
- Do not delete new tables or audio during rollback.
- Existing TV Size and old Android clients continue on frozen fields/routes.

## 16. Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Treat Full Size as a second ThemeEntity | Duplicates preferences/queue identity and violates product semantics |
| Represent Related tracks as synthetic themes | Corrupts anime-theme behavior and cannot model albums cleanly |
| Store Full Size only by theme ID | Duplicates reused songs and source-release relationships |
| Proxy/cache AnimeThemes video | Explicitly outside product scope and wastes storage |
| Use Lidarr as the catalog authority | Lidarr cannot decide anime-season relationships or exact theme matches |
| Hold a server worker while Lidarr downloads | Blocks the existing queue for minutes or hours |
| Add Redis, Kafka, or a second service | No need at private-app scale |
| Transcode all audio to Ogg | Violates original-quality policy |
| Add a public Albums tab | Conflicts with the approved nested information architecture |
| Build manual listener requests | Product is automatic ready-or-absent |

## 17. Technical sources

- [AnimeThemes resource types](https://animethemes-animethemes-server.mintlify.app/concepts/resource-types)
- [AnimeThemes media streaming](https://animethemes-animethemes-server.mintlify.app/concepts/media-streaming)
- [Lidarr API documentation](https://lidarr.audio/docs/api/)
- [Lidarr current OpenAPI definition](https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json)
- [Lidarr release controller](https://github.com/Lidarr/Lidarr/blob/3d48a982d2addf5a84d22224c3ea03778cd8dc95/src/Lidarr.Api.V1/Indexers/ReleaseController.cs)
- [Lidarr command controller](https://github.com/Lidarr/Lidarr/blob/3d48a982d2addf5a84d22224c3ea03778cd8dc95/src/Lidarr.Api.V1/Commands/CommandController.cs)
- [Lidarr import and matching behavior](https://wiki.servarr.com/lidarr/import-troubleshooting)

## 18. Completion boundary

The TDR is complete when the implementation backlog references these contracts
and no ticket needs to invent a competing identity, storage, provider, API,
queue, mode, playlist, or download model.

Product behavior remains governed by the PRD. If implementation evidence
requires changing a product decision, update the PRD first. Otherwise, the
technical decisions in this document are authoritative for the initiative.
