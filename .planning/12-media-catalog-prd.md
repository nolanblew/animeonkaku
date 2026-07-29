# PRD — TV Size, Full Size, Video, and Related Music

> **2026-07-21 acquisition change:** Anime Ongaku no longer uses Lidarr. The
> first acceptance iteration uses the custom Anime Music Fetcher service and a
> debug-build-only anime-detail **Request music** action. The listener-facing
> catalog remains ready-or-absent, and later automatic scheduling must invoke
> the same durable server workflow. Where this PRD says Lidarr or forbids every
> listener-triggered request, the narrowly scoped debug acceptance flow in
> [16-anime-fetcher-migration-plan.md](16-anime-fetcher-migration-plan.md)
> supersedes it.

**Status:** Product requirements resolved; ready for TDR

**Date:** 2026-07-19

**Initiative branch:** `feature/media-catalog-initiative`

**Baseline:** `feature/server-initiative` at `b44e2bf`

**Next artifacts:** TDR, then implementation tickets

## 1. Summary

Anime Ongaku will expand each anime theme from one TV-size audio item into up to three
core playback modes:

1. **TV Size** — the current short AnimeThemes audio edit.
2. **Full Size** — the exact complete song used by that anime theme.
3. **Video** — the matching AnimeThemes-hosted OP/ED video.

These are core modes of the theme itself. Full Size and Video are not classified as
Related Music.

Anime Ongaku will also add **Related Music** for season-specific releases such as
official soundtracks, character songs, image albums, and other music explicitly tied to
that anime season. Related Music lives under the anime, is reachable from the anime page
and Now Playing overflow, and is globally searchable without becoming a top-level
destination.

The server discovers, matches, downloads, and caches Full Size and Related Music
automatically. There is no listener request, waiting, or acquisition workflow. Media
appears in the app only after the server has a confident match and usable audio. Video
is the exception: it streams directly from AnimeThemes and is never stored by Anime
Ongaku.

## 2. Product principles

1. **The theme remains the core item.** TV Size, Full Size, and Video are modes of the
   same anime theme, not unrelated recommendations.
2. **Ready or absent.** Background search and acquisition states are operational
   concerns. Normal listeners see a mode or release only when it is usable.
3. **Exact matches over broad coverage.** The wrong version is worse than no Full Size.
4. **Season-specific relationships.** Related Music requires evidence tying it to the
   exact anime season/title, not merely to an artist who performed a theme.
5. **Provider-neutral product behavior.** Lidarr may be the first acquisition adapter,
   but no listener-facing behavior depends on Lidarr terminology.
6. **Server availability and device availability are separate.** Ready audio may stream
   from the server; Download saves the selected audio to the current device.
7. **Video remains remote.** AnimeThemes hosts the video. It is hidden when there is no
   valid link or the device is offline.
8. **Existing TV Size behavior must not regress.** Current queues, stable URLs, device
   downloads, and offline playback remain valid.
9. **Original quality is the product quality policy.** Audio is stored and streamed in
   its acquired original quality; video streams in the quality supplied by the selected
   AnimeThemes source. Listeners do not choose quality profiles.

## 3. Confirmed product decisions

### D1. Related Music scope

Related Music is scoped to the specific anime season/title. It may include:

- Official soundtracks.
- Character and image songs released for that season.
- Theme singles or albums when they have a season-specific relationship.
- Insert-song releases and other music with explicit season evidence.

An artist's general discography is not related merely because the artist performed an
OP or ED. Franchise-wide releases may appear only when they are explicitly related to
the current season as well.

### D2. Full Size scope

Full Size means the exact complete song used by the anime theme. It excludes:

- Instrumental and karaoke versions.
- Live versions.
- Covers or alternate performers.
- Remixes or materially different arrangements.
- Other songs that happen to be on the acquired single or album.

Where the same original studio recording appears on multiple releases, Anime Ongaku
keeps one playable Full Size identity with release relationships rather than duplicate
copies.

### D3. Automatic discovery only

Listeners never request Full Size songs or Related Music. An automatic updater:

- Revisits anime that still lack a Full Size match.
- Revisits anime released within the previous year so later releases can be discovered.
- Discovers season-scoped Related Music releases during those catalog passes.
- Searches using available English, romaji, and Japanese anime/song metadata.
- Compares anime, theme song, artist, release, and other available metadata across
  multiple queries.
- Accepts only confident matches.
- Keeps ambiguous or unconfirmed matches out of the listener app.

The TDR will define the updater's schedule, scoring, adapters, and reconciliation rules
without changing this user-visible contract.

### D4. Acquisition and retention

The provider may need to acquire a whole single or album to obtain one Full Size song.
For a Full Size match, Anime Ongaku retains only the wanted song and discards unrelated
tracks from that acquisition.

For an in-scope Related Music release, the server retains the release's related tracks.
Ready Full Size and Related Music audio is stored and cached on the Anime Ongaku server
and becomes available to every server user.

Only an operator may remove server-cached media. Listeners may remove only their current
device's downloads.

### D5. Ambiguous matches

Ambiguous matches are hidden from normal listeners and are never automatically accepted.
A later operator-only resolution surface may allow a match to be approved or rejected.

### D6. Now Playing mode selector

Expanded Now Playing has a persistent selector at the top, modeled after the compact
top-center segmented control in YouTube Music:

`TV Size | Full Size | Video`

- The selector is a small pill above the artwork/video region, not a full-width tab bar.
- Each available mode has a clearly labeled segment. The actual playing mode uses the
  filled, high-emphasis selected state; unselected modes remain visually quiet.
- Only usable modes are selectable for the current theme.
- Changing mode keeps the same logical queue entry and surrounding queue.
- Selecting Full Size starts that recording at 0:00.
- The user's preferred mode is retried on the next queue item.
- If preferred Full Size is unavailable, playback falls back to TV Size.
- If preferred Video is unavailable, playback falls back to TV Size.
- If preferred TV Size is genuinely unavailable, playback may fall back to Full Size.
- Playback never enters Video automatically unless Video is the preferred session mode.
- During fallback, the selector highlights the actual playing mode. A subtle nearby
  status such as **Full Size unavailable · retrying next song** preserves the user's
  intent without making an unavailable mode look active.
- Queue swipes remain previous/next queue navigation; they are not used for mode
  switching.
- The player, Up Next, history, Android media controls, restored sessions, downloads,
  Bluetooth, and car displays identify the actual mode being played where confusion is
  possible.

### D7. Mode persistence

- TV Size is the initial default.
- If the user manually selects Full Size, Anime Ongaku remembers that preference and
  attempts Full Size on later eligible themes.
- Video is session-only. If Video is selected, Anime Ongaku returns to TV Size after an
  app restart or when the queue is replaced by another playlist/context.
- A temporary fallback does not erase the user's preferred mode; the app tries it again
  on the next track.

### D8. Browse-surface playback actions

The overflow menu for a song, anime, or playlist may show **Play Video**.

- Play Video starts that item/context with Video as the session preference.
- Items in the resulting queue without video fall back according to the mode rules.
- The action is hidden when the device is offline.
- For a single song, the action is hidden when no valid video link exists.
- For an anime or playlist, the action appears only when at least one contained theme
  has a usable video.

There is no browse-surface **Play Full Size** action. Full Size is selected through the
Now Playing mode selector or resolved by playlist playback policy.

### D9. Playlist version policy

Playlists remain based on the underlying theme/song so they can be shared across users.
They do not store a separate TV Size and Full Size catalog entry for the same theme.

Each playlist has a shared default audio mode:

- **Default TV Size**, or
- **Default Full Size**.

An individual playlist entry may override that default. When a track or anime is added,
the add flow offers **Inherit playlist default**, **TV Size**, and **Full Size**, with
**Inherit playlist default** preselected.

The playlist default's primary product purpose is to define which audio mode Download
Playlist saves to a device. On playlist start, an entry override takes precedence over
the playlist default, and the playlist default takes precedence over the user's
remembered personal mode. If neither playlist policy applies, the remembered mode is
used.

A manual Now Playing mode change becomes a temporary session override for subsequent
entries until the queue or playback context is replaced. It does not mutate the shared
playlist, its default, or its entry overrides.

If a playlist entry resolves to Full Size, a locally downloaded TV Size copy does not
satisfy it offline; that entry is unavailable until the Full Size copy is on the device.

Video is never a stored playlist default or entry override. **Play Video** is a temporary
session action.

### D10. Likes, dislikes, plays, and history

- A like applies to the underlying song by default and therefore follows TV Size and
  Full Size.
- Play events and positions record the actual mode that played and may also roll up to
  the underlying song.
- Related tracks can be liked independently. A specifically liked related track may be
  eligible for Home recommendations.
- A normal Dislike applies to all modes of the current specific song, including its TV
  Size, Full Size, and Video presentation. It does not dislike every song from the anime.
- A subtle secondary action, available by long-pressing Dislike and through an accessible
  overflow equivalent, allows **Dislike TV Size only** or **Dislike Full Size only** so
  the other audio mode may still play.
- Disliking an entire anime is not the default gesture and requires a separate,
  explicitly labeled action if introduced later.

### D11. Related Music information architecture

- Anime Detail contains a **Related Music** section with release previews.
- Selecting the section opens a nested Related Music screen for that anime season.
- Expanded Now Playing overflow links to the current anime's Related Music when ready
  releases exist.
- Search can return ready related releases and tracks. Selecting a result opens it in
  the owning anime's nested Related Music experience.
- There is no top-level Related Music or Albums destination.
- Full Size does not appear in Related Music merely because its source is a single or
  album; it remains a core theme mode.

### D12. Home and Quick Picks

- Non-OST Related Music does not enter general Quick Picks unless the specific item is
  liked.
- OST inclusion on Home is controlled by a **Show OSTs on Home** setting that defaults
  to on.
- Full Size is a core mode, so it follows theme playback preferences rather than being
  treated as a Related Music recommendation.

### D13. Embedded video experience

Video plays inside Now Playing rather than opening a browser or external player.

**Portrait**

- The video replaces the album-art region and displays edge-to-edge within Now Playing.
- The rest of the player continues to provide the current theme's queue and reaction
  controls.

**Landscape**

- Video becomes a full-screen player.
- Like/dislike, previous, next, play/pause, and related playback controls appear in a
  control center along the bottom.
- Controls can hide to leave an unobstructed full-screen video.

Entering Video pauses the audio mode. Leaving Video resumes the prior audio mode only
when it had been playing and the user did not start other media. Video previous/next
actions navigate the existing queue and apply the mode fallback rules.

### D14. AnimeThemes video selection

When several AnimeThemes videos exist, selection prioritizes:

1. A video attached to the current theme song.
2. A safe/default entry under the app's content-warning policy.
3. The earliest matching entry/version when multiple song matches remain.
4. The best appropriate source/resolution among otherwise equivalent candidates.

The app warns before content marked spoiler or NSFW. Technical codec, source, and
resolution choices are not exposed in the normal listener flow.

### D15. Availability visibility

- Full Size and Related Music appear only after audio is ready on the server.
- Unavailable, unmatched, ambiguous, searching, downloading, and failed background
  candidates do not appear in normal listener surfaces.
- Ready Full Size and Related Music appear in Search and relevant anime screens.
- There are no listener request buttons, request progress, completion notifications,
  cancellation controls, or retry controls.
- Operator diagnostics may expose background discovery/acquisition state separately.

### D16. Video availability

- Video streams directly from AnimeThemes through its source link.
- Anime Ongaku does not proxy, cache, or device-download video.
- If there is no valid video link, Video does not appear for that theme.
- If the device is offline, Video and Play Video controls do not appear.
- If a link fails after playback starts, the player reports a finite error, falls back
  to an available audio mode for the current item, and retains the user's Video
  preference for the next queue item.

### D17. Shared server behavior

- The automatically discovered catalog and server-cached audio are shared by all users
  of the Anime Ongaku server.
- Personal likes, dislikes, history, and device downloads remain user/device scoped.
- Shared playlist definitions, defaults, and entry overrides are visible to users with
  access to that playlist.

### D18. Device downloads and offline behavior

- TV Size and Full Size are independently downloadable audio modes.
- Related tracks and albums may be downloaded to the device.
- Device downloads always save the original-quality server audio.
- Playlist download resolves the playlist default and every entry override before
  choosing device files.
- Offline playback requires the exact resolved audio mode on the device; another mode
  is not silently substituted.
- Video is never available offline.
- Existing Wi-Fi-only, retry, pause, remove, and airplane-mode playback behavior extends
  to Full Size and Related Music audio.
- Downloads groups Full Size under its anime/theme and Related Music under its source
  album.
- A Full Size song may cross-link to its known source release, but the device stores and
  displays only one physical download.
- Related album groups are expandable and permit individual track removal.

## 4. Product terminology

| Term | Meaning in Anime Ongaku |
|---|---|
| **Anime Theme** | The OP/ED relationship among an anime season, a song, and its theme entries. |
| **Song** | The underlying musical work shared by TV Size and Full Size. |
| **TV Size** | The short AnimeThemes audio edit and initial playback default. |
| **Full Size** | The exact complete original song used by the theme; no instrumental, cover, live, remix, or unrelated album tracks. |
| **Video** | The matching AnimeThemes-hosted visual theme played inside Now Playing. |
| **Preferred Mode** | The user's current TV Size, Full Size, or Video intent that the player retries across queue items. |
| **Actual Mode** | The mode currently playing after availability fallback. |
| **Related Release** | A season-specific soundtrack, character/image album, theme release, or other explicitly related collection. |
| **Related Track** | A ready track within a Related Release. |
| **Ready on server** | The Anime Ongaku server has usable original-quality audio. |
| **Downloaded** | The current device has the exact audio mode required for offline playback. |
| **Music provider** | An operator-configured acquisition integration such as Lidarr; invisible to normal listeners. |

User-facing copy should prefer **TV Size**, **Full Size**, **Video**, **Related Music**,
and **Download**. It should not use **Get**, **Request**, Lidarr, indexer, release profile,
or download-client terminology.

## 5. Primary user journeys

### 5.1 Switch a playing theme to Full Size

1. The user expands Now Playing.
2. Full Size is present only if the server already has the exact song.
3. The user selects **Full Size** in the mode selector.
4. Playback stays on the same logical queue entry and begins Full Size at 0:00.
5. The player remembers Full Size as the user's preferred mode.
6. On the next item, Full Size plays when available; otherwise the player temporarily
   falls back and retries Full Size on the following item.

### 5.2 Watch a theme video

1. The user selects **Video** in Now Playing or chooses **Play Video** from a song,
   anime, or playlist overflow.
2. Audio pauses and the AnimeThemes video replaces the artwork area.
3. Portrait retains the Now Playing experience; landscape becomes a hideable-control
   full-screen player.
4. Previous/next move through the existing queue.
5. Missing-video items fall back temporarily while Video remains the session preference.
6. Video resets to TV Size after app restart or queue/context replacement.

### 5.3 Find Related Music

1. The user opens an anime season and sees Related Music only when ready releases exist.
2. Release previews open the nested Related Music screen.
3. The user browses release artwork, title, relationship, artist, year, and tracks.
4. Ready tracks support play, Play Next, Add to Queue, Save to Playlist, like, and
   device Download.
5. A global search result for the release or track returns the user to this anime-owned
   experience.

### 5.4 Download a shared playlist

1. Each entry resolves its entry override first, then the shared playlist default.
2. Download Playlist saves the exact resolved TV Size or Full Size audio for each entry.
3. The Downloads experience identifies which mode is stored.
4. Offline playback uses only that exact local mode.
5. If the required mode is missing locally, the entry is unavailable even when another
   mode of the same song is downloaded.

## 6. Functional requirements

### 6.1 Catalog and automatic updater

- **CAT-001:** The server shall automatically revisit missing Full Size matches and
  anime released within the previous year.
- **CAT-002:** Discovery shall search across English, romaji, and Japanese metadata when
  available and compare anime, song, artist, and release context.
- **CAT-003:** Only confident, exact Full Size matches shall enter the listener catalog.
- **CAT-004:** Full Size shall exclude instrumental, karaoke, live, cover, remix, and
  unrelated album tracks.
- **CAT-005:** An acquisition may fetch a release, but a Full Size result shall retain
  only the wanted song.
- **CAT-006:** Related Music shall require evidence tied to the specific anime season.
- **CAT-007:** Ready catalog audio shall be shared across server users.
- **CAT-008:** Listener surfaces shall expose ready media only; background operational
  states shall remain hidden.
- **CAT-009:** The same Full Size recording found through multiple releases shall not
  become duplicate playable items.
- **CAT-010:** Automatic catalog passes shall discover both missing Full Size songs and
  season-scoped Related Music.
- **CAT-011:** Ready Full Size shall participate in theme/song search as a core mode,
  not as a Related Music result.

### 6.2 Now Playing modes

- **MOD-001:** Expanded Now Playing shall show the `TV Size | Full Size | Video`
  selector as a compact top-center segmented pill above the media region.
- **MOD-002:** Only usable current-item modes shall be selectable.
- **MOD-003:** Mode switching shall preserve the logical queue entry and surrounding
  queue.
- **MOD-004:** Full Size selection shall begin at 0:00.
- **MOD-005:** The player shall track preferred mode separately from actual fallback
  mode.
- **MOD-006:** Temporary fallback shall not erase preferred mode.
- **MOD-007:** Full Size preference shall persist; Video preference shall reset to TV
  Size after app restart or queue replacement.
- **MOD-008:** Player surfaces and external media displays shall label actual mode where
  confusion is possible.
- **MOD-009:** Horizontal artwork swipes shall remain queue navigation.
- **MOD-010:** Full Size and Video shall each fall back to TV Size when preferred but
  unavailable; TV Size may fall back to Full Size only when TV Size is unavailable.
- **MOD-011:** Fallback shall never enter Video unless Video is the preferred session
  mode.
- **MOD-012:** The selector shall visually select the actual playing mode, using a filled
  high-emphasis segment while keeping unselected modes low-emphasis.
- **MOD-013:** During temporary fallback, the player shall communicate the retained
  preferred mode with a subtle status without presenting it as the active mode.

### 6.3 Video

- **VID-001:** Valid video shall play inside the Now Playing surface from its direct
  AnimeThemes source.
- **VID-002:** Portrait video shall replace the artwork area edge-to-edge.
- **VID-003:** Landscape video shall become full-screen with hideable bottom controls.
- **VID-004:** Video controls shall include play/pause, previous, next, like, and dislike.
- **VID-005:** Entering Video shall pause audio; leaving shall follow D13's conditional
  resume behavior.
- **VID-006:** Selection shall follow D14's song, safety, entry-order, and quality
  priorities.
- **VID-007:** Spoiler and NSFW flags shall use the approved warning behavior.
- **VID-008:** Video and Play Video controls shall be hidden without a link or while
  offline.
- **VID-009:** Video shall never be cached by the server or downloaded to the device.
- **VID-010:** A failed video shall produce a finite error and temporary audio fallback
  without erasing Video session preference.

### 6.4 Playlists

- **PLY-001:** A playlist entry shall reference the underlying theme/song rather than a
  duplicated media item for each audio mode.
- **PLY-002:** Each playlist shall have a shared default of TV Size or Full Size.
- **PLY-003:** Individual entries shall support TV Size or Full Size overrides.
- **PLY-004:** Adding a track or anime shall allow an audio-mode policy to be selected.
- **PLY-005:** Video shall not be stored as a playlist default or entry override.
- **PLY-006:** Play Video shall create only a temporary Video session preference.
- **PLY-007:** Playlist download shall resolve the playlist default and entry overrides.
- **PLY-008:** Offline playlist playback shall require the exact resolved audio mode.
- **PLY-009:** On playlist start, mode policy precedence shall be entry override, then
  playlist default, then the user's remembered mode.
- **PLY-010:** A manual Now Playing selection shall temporarily override subsequent
  entries until queue/context replacement without modifying the playlist definition.
- **PLY-011:** The add-to-playlist mode choices shall be Inherit playlist default, TV
  Size, and Full Size, with Inherit playlist default preselected.
- **PLY-012:** The playlist default shall determine the baseline exact-mode device
  download policy while still allowing a temporary streaming-session override.

### 6.5 Related Music, Search, and Home

- **REL-001:** Ready Related Music shall live under its owning anime season.
- **REL-002:** Anime Detail and current-theme Now Playing overflow shall link to the
  nested Related Music screen.
- **REL-003:** Related releases and tracks shall be searchable globally.
- **REL-004:** Search results shall retain and display the owning anime relationship.
- **REL-005:** There shall be no top-level Related Music or Albums destination.
- **REL-006:** Full Size shall remain a core mode and shall not be listed as Related Music.
- **REL-007:** Ready tracks shall support standard playback, queue, playlist, reaction,
  and device-download actions.
- **REL-008:** Non-OST related items shall enter Quick Picks only when specifically liked.
- **REL-009:** OST Home eligibility shall respect the Show OSTs on Home setting, which
  shall default to on.
- **REL-010:** Unready, unavailable, ambiguous, or metadata-only related releases shall
  not appear in normal listener surfaces.

### 6.6 Likes, dislikes, plays, and history

- **REA-001:** A normal song Dislike shall apply to every mode of the current specific
  song and shall not apply to every song from its anime.
- **REA-002:** A subtle secondary reaction action shall allow TV Size-only or Full
  Size-only dislike while leaving the other audio mode eligible to play.
- **REA-003:** Mode-specific dislike shall be accessible through both a long-press
  gesture and a discoverable non-gesture equivalent.
- **REA-004:** Likes shall apply to the underlying song by default, while Related Music
  tracks may be liked independently.
- **REA-005:** Play events and positions shall identify the actual mode played while
  remaining attributable to the underlying song.

### 6.7 Device downloads and offline behavior

- **DWN-001:** TV Size and Full Size shall have independent device-download state.
- **DWN-002:** Related releases and tracks shall support device downloads.
- **DWN-003:** Downloads shall preserve original audio quality.
- **DWN-004:** Removing a device copy shall not remove server-cached audio.
- **DWN-005:** Existing Wi-Fi-only, retry, pause, remove, and airplane-mode behavior
  shall extend to Full Size and Related Music.
- **DWN-006:** Offline playback shall not silently substitute another mode for a
  playlist-required mode.
- **DWN-007:** Video shall not appear in Downloads and shall not be available offline.
- **DWN-008:** Downloads shall group Full Size under its anime/theme and Related Music
  under its source album.
- **DWN-009:** A Full Size download may cross-link to its source release but shall appear
  as only one physical device download.
- **DWN-010:** Related album download groups shall be expandable and allow individual
  track removal.

### 6.8 Existing behavior that must not regress

- **REG-001:** Existing TV Size stable URLs and downloaded files shall continue to play.
- **REG-002:** Queue entries shall retain independent identity through duplicate songs,
  shuffle, Play Next, Add to Queue, history, persistence, and Media3 synchronization.
- **REG-003:** Provider outages shall not block existing TV Size, ready server audio, or
  device-downloaded playback.
- **REG-004:** Anime-wide theme Play/Shuffle/Add/Download behavior shall not silently add
  soundtracks or character songs.
- **REG-005:** Existing offline browsing and downloaded playback shall remain usable when
  the server is unavailable.

## 7. Non-goals

- Building or distributing Lidarr, an indexer, or a download client.
- A listener request or approval workflow for missing media.
- Exposing background searches, downloads, failures, or retries in the normal app.
- Hosting, proxying, caching, or offline-downloading AnimeThemes video.
- Retaining unrelated tracks acquired while finding one Full Size song.
- Treating instrumental, karaoke, live, cover, or remix recordings as Full Size.
- Showing an artist's general discography as anime-related.
- Adding a top-level albums or Related Music destination.
- Letting listeners choose audio/video quality profiles.
- Automatically mixing Related Music into existing anime-theme bulk actions.
- Defining APIs, schemas, jobs, provider adapters, migrations, or scoring formulas in
  this PRD.

## 8. Audited foundation

### Android

- The player already persists a logical queue with per-occurrence identity, making a
  same-entry mode selector compatible with duplicate-song queue invariants.
- Expanded Now Playing already has anime/theme metadata, a large artwork region, and an
  overflow action that can host the new mode and Related Music experiences.
- `ThemeEntity` has a video field, but server-backed mapping currently forces it to null.
- Likes, plays, playlists, and device downloads are currently keyed to theme identity;
  the TDR must implement the approved mode and playlist policies without breaking queue
  entry identity.
- Existing device downloads already support pending, retrying, waiting-for-Wi-Fi,
  completed, failed, paused, and offline playback behavior.

Evidence: [`ThemeEntity.kt`](../src/app/src/main/java/com/takeya/animeongaku/data/local/ThemeEntity.kt),
[`LibraryPullMapper.kt`](../src/app/src/main/java/com/takeya/animeongaku/sync/LibraryPullMapper.kt),
[`NowPlayingManager.kt`](../src/app/src/main/java/com/takeya/animeongaku/media/NowPlayingManager.kt),
[`PlayerScreen.kt`](../src/app/src/main/java/com/takeya/animeongaku/ui/player/PlayerScreen.kt), and
[`ActionSheet.kt`](../src/app/src/main/java/com/takeya/animeongaku/ui/common/ActionSheet.kt).

### Server

- AnimeThemes audio and video origins are already stored, but video is deliberately
  suppressed from client payloads.
- The earlier media-variants spike prepared database identity and path scaffolding for
  short audio, full audio, and video without exposing or acquiring new modes.
- Existing client/media/playlists/history concepts are theme-centric; releases and
  general tracks do not yet exist.
- The existing short-audio URL and device-download compatibility must remain frozen.

Evidence: [`09-media-variants.md`](09-media-variants.md),
[`types.ts`](../server/src/media/types.ts),
[`catalogLookup.ts`](../server/src/media/catalogLookup.ts), and
[`mediaRoutes.ts`](../server/src/api/mediaRoutes.ts).

### External product constraints

- AnimeThemes represents songs, anime themes, entry versions, videos, and extracted
  audio as related resources. Video metadata includes edition/source/quality and
  spoiler/NSFW signals.
- Lidarr is release/album-oriented, so acquiring one exact song may require temporarily
  acquiring its containing release.
- Cross-language anime music matching is inherently uncertain; confidence must come
  from multiple metadata signals rather than title equality alone.

Sources:

- [AnimeThemes resource types](https://animethemes-animethemes-server.mintlify.app/concepts/resource-types)
- [AnimeThemes media streaming](https://animethemes-animethemes-server.mintlify.app/concepts/media-streaming)
- [Lidarr product overview](https://lidarr.audio/docs/)
- [Lidarr API documentation](https://lidarr.audio/docs/api/)
- [Lidarr import and matching behavior](https://wiki.servarr.com/lidarr/import-troubleshooting)

## 9. Success measures

- No known false-positive Full Size match enters the curated acceptance catalog.
- A ready theme can switch among its available modes without losing or duplicating its
  queue entry.
- Preferred Full Size or Video behavior survives missing variants and returns on a later
  eligible queue item according to the approved fallback policy.
- Video plays inside portrait and landscape Now Playing directly from AnimeThemes and
  never enters server or device storage.
- Ready Full Size and Related Music are searchable and reachable through their anime
  without exposing background acquisition workflow.
- Playlist device downloads exactly match playlist defaults and entry overrides.
- Offline playlist playback never substitutes TV Size for a required Full Size item or
  vice versa.
- Existing TV Size downloads continue playing in airplane mode.
- Provider or AnimeThemes failure does not regress ready audio or existing offline
  behavior.

## 10. Product risks and mitigations

| Risk | Product mitigation |
|---|---|
| A wrong recording is accepted because titles differ across languages | Multi-query matching across anime, song, artist, and release; hide ambiguity. |
| A release acquisition retains unrelated songs | Retain only the exact Full Size target; retain whole-track sets only for in-scope Related Releases. |
| Users confuse preferred mode with temporary fallback | Select the actual mode in the compact control and show retained intent only as subtle status. |
| Playlist policy conflicts with personal mode preference | Apply entry override, playlist default, and remembered preference in that order; manual mode changes remain session-only. |
| Video consumes data or fails offline | Stream directly, never cache, and hide Video controls offline. |
| Video and audio overlap | Pause audio on Video entry and apply controlled resume behavior on exit. |
| Related Music becomes a generic artist catalog | Require season-specific evidence and preserve anime ownership in Search. |
| Automatic acquisition grows server storage | Exact-match filtering plus operator-only server retention controls. |
| A different local mode appears usable offline | Require exact playlist-resolved mode and label downloads clearly. |
| Full Size or video breaks existing queue behavior | Preserve logical queue entry and per-occurrence queue identity. |

## 11. Product decision closure

All product questions raised during the audit are resolved in this PRD:

| Topic | Final decision |
|---|---|
| Default dislike | Applies to all modes of the current specific song; a secondary action supports TV Size-only or Full Size-only dislike. |
| Mode fallback | Full Size → TV Size; Video → TV Size; TV Size → Full Size only if TV Size is unavailable; never automatically enter Video unless preferred. |
| Selector during fallback | Select the actual playing mode and communicate retained preference with subtle status. |
| Playlist precedence | Entry override → playlist default → remembered preference at start; a manual selection is a temporary session override. |
| OSTs on Home | Show OSTs on Home defaults to on. |
| Download grouping | Full Size groups under anime/theme; Related Music groups under expandable albums with individual removal and no duplicate physical downloads. |

## 12. Explicitly deferred to the TDR

All product behavior needed to begin technical design is resolved. The TDR should define
how the approved behavior is implemented:

- Song, mode, recording, release, related-track, playlist-policy, and media-file IDs.
- Automatic updater scheduling and the one-year revisit window.
- Cross-language query generation, match scoring, confidence thresholds, and operator
  resolution.
- Provider adapter capabilities, including Lidarr-specific release acquisition and
  unwanted-track cleanup.
- API contracts, sync/delta behavior, caching, authorization, and shared catalog state.
- Mode availability, preferred-versus-actual playback state, fallback, restoration,
  Media3 IDs, and embedded video playback.
- Playlist defaults, entry overrides, session overrides, and exact offline resolution.
- Related Music evidence sources, search indexing, anime ownership, and Home filtering.
- Original-quality storage, retention, download grouping, observability, tests, and
  rollout sequencing.

Implementation tickets should be written after the TDR establishes these technical
contracts and boundaries.
