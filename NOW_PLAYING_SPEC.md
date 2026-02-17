# Now Playing Queue — Detailed Specification

> Referenced from `PLAN.md` Phase 13. This document captures all acceptance criteria
> for the YouTube-Music-style "Now Playing" queue system.

---

## 1. Core Concept: Context Playlist → Now Playing Queue

Every play action originates from a **context** (Home screen, Anime page, Artist page,
Playlist page, Songs tab, Explore results). When the user triggers playback, the full
list of songs visible in that context becomes the **context playlist**. A mutable copy
of it is loaded into the **Now Playing Queue**, which the media player actually reads.

### Key State (managed by `NowPlayingManager` singleton)

| Field | Type | Description |
|---|---|---|
| `originalQueue` | `List<ThemeEntity>` | The unshuffled context playlist (immutable snapshot at play time) |
| `nowPlaying` | `List<ThemeEntity>` | The active playback order (may be shuffled, may have injected items) |
| `currentIndex` | `Int` | Index into `nowPlaying` of the currently playing track |
| `playNextStack` | `List<ThemeEntity>` | LIFO stack of "Play Next" items inserted after current track |
| `isShuffled` | `Boolean` | Whether shuffle mode is active |
| `contextLabel` | `String` | Display label, e.g. "Naruto", "Kitsu Library", "Quick Picks" |
| `history` | `List<ThemeEntity>` | Tracks that have already been played (for "scroll up" in Up Next) |

---

## 2. Playback Triggers

### 2a. Play Button (on Anime, Artist, Playlist pages)
- Loads **all** themes on the page as the context playlist.
- Starts playing from the **first** track (index 0).
- Shuffle is **off** (unless already active from a previous session — see 2d).

### 2b. Shuffle Button (on Anime, Artist, Playlist pages)
- Loads **all** themes on the page as the context playlist.
- Shuffles the list and starts playing from a **random** track.
- Shuffle mode is **on** (shuffle icon highlighted in player).

### 2c. Tapping an Individual Song Row
- Loads the **context** list (all songs visible on the current screen) as the context playlist.
- Starts playing from the **tapped** song's position.
- If shuffle was already active, it stays active — the tapped song becomes first,
  and the remaining songs are shuffled.
- If shuffle was not active, it stays off — plays in order from the tapped song.

### 2d. Home Screen
- "Quick Picks" section: context playlist = the quick picks list.
- "Top Songs" section: context playlist = the top songs list.
- Tapping a song in either section plays from that song's position within its section.

---

## 3. Shuffle Behavior

### Enabling Shuffle (Off → On)
1. The **current song** stays as-is (does not change).
2. All songs **after** the current index in the queue that have **not yet been played** are shuffled.
3. Songs in the `playNextStack` remain in their positions (immediately after current song)
   and are **not** shuffled.
4. Songs added via "Add to Queue" that haven't played yet **are** shuffled in.

### Disabling Shuffle (On → Off)
1. The **current song** stays as-is.
2. The queue is restored to the **original context playlist order**, starting from the
   current song's position in the original list.
3. Any "Play Next" items remain in their injected positions (right after current).
4. Any "Add to Queue" items that were shuffled in are moved to the **end** of the restored queue.

### Shuffle + New Context
- When a user starts a new context (taps Play/Shuffle or taps a song on a different page),
  the previous queue is fully replaced.

---

## 4. Queue Modifications

### 4a. Play Next
- Inserts the song(s) **immediately after** the currently playing track.
- Multiple "Play Next" calls stack: the most recent one plays first (LIFO on top of current).
- "Play Next" songs are **never** affected by shuffle toggle — they stay in position.
- Works for: single song, entire playlist, anime's themes, or artist's songs.

### 4b. Add to Queue
- Appends the song(s) to the **end** of the `nowPlaying` list.
- If shuffle is later toggled **Off → On**, these songs **are** shuffled into the remaining queue.
- If shuffle is toggled **On → Off**, these songs move to the end of the restored order.
- Works for: single song, entire playlist, anime's themes, or artist's songs.

### 4c. Save to Playlist
- Opens the existing "Add to Playlist" dialog (already built for `PlaylistDetailScreen`).
- Saves the selected song to the chosen playlist.
- Does **not** affect the Now Playing queue.

---

## 5. Song Overflow Menu (⋮ Bottom Sheet)

Every song row across the app gets a vertical three-dot (⋮) icon on the right side.
Tapping it opens a **modal bottom sheet** with:

### Header
- Anime cover art thumbnail (small)
- Primary text: "Anime Name · OP1" (using `ThemeDisplayInfo`)
- Secondary text: "Song Title · Artist"
- Close (X) button

### Top Action Buttons (horizontal row)
| Button | Icon | Action |
|---|---|---|
| **Play Next** | `PlaylistAdd` | Insert after current track |
| **Save to Playlist** | `PlaylistAdd` variant | Open playlist picker dialog |

### List Items
| Item | Icon | Action |
|---|---|---|
| **Add to Queue** | `Queue` | Append to end of queue |

> Future items (not in this phase): "Go to Anime", "Go to Artist", "Download"

---

## 6. Up Next / Now Playing Screen

Accessed by tapping "Up Next" or swiping up from the player (or a dedicated tab/button
in the player screen).

### Layout
- **Header**: "Playing from [contextLabel]"  +  "Save" button (saves current queue as playlist)
- **History section** (scrollable upward, dimmed):
  - Shows previously played tracks in original play order.
  - Tracks are dimmed (lower alpha).
  - Tapping a history track "rewinds" the queue to that point — it becomes the current
    track, and all tracks after it in the original order become upcoming again.
- **Current track**: highlighted (brighter, maybe a "now playing" indicator/bars icon).
- **Up Next section**:
  - Shows remaining tracks in playback order.
  - "Play Next" items shown with a subtle badge/divider.
  - Each row has a drag handle for manual reorder (future — not required for MVP).

### Behavior
- The list auto-scrolls to keep the current track visible.
- Tapping any upcoming track jumps to it (skipping intermediate tracks, which go to history).
- Tapping a history track rewinds to it (tracks between it and the previous current
  go back to "upcoming").

---

## 7. Implementation Architecture

### `NowPlayingManager` (Singleton, `@Inject`)
- Central source of truth for the queue.
- Exposes `StateFlow<NowPlayingState>`.
- Methods: `play(context, themes, startIndex, shuffle)`, `playNext(themes)`,
  `addToQueue(themes)`, `skipTo(index)`, `next()`, `previous()`,
  `toggleShuffle()`, `currentTheme()`.
- Syncs with `MediaController` — pushes `setMediaItems` when queue changes,
  listens for `onMediaItemTransition` to update `currentIndex` and `history`.

### Navigation Changes
- Remove `themeId`, `playlistId`, `queue` nav arguments from Player route.
- Player route becomes just `"player"` — it reads from `NowPlayingManager`.
- All `onPlayTheme` callbacks become `NowPlayingManager.play(...)` calls.
- `PlayerViewModel` is simplified or removed — `NowPlayingManager` replaces it.

### `SongOptionsSheet` (New Composable)
- Modal bottom sheet with `ThemeEntity` + `AnimeEntity?` context.
- Renders header, action buttons, and list items.
- Calls `NowPlayingManager.playNext()` / `addToQueue()` / opens playlist picker.

---

## 8. Migration Steps (Incremental)

1. **Create `NowPlayingManager`** with queue state, play/shuffle/playNext/addToQueue logic.
2. **Refactor `PlayerScreen`** to read from `NowPlayingManager` instead of `PlayerViewModel`.
3. **Refactor navigation** — remove queue params from player route, all screens call
   `NowPlayingManager.play(...)` directly.
4. **Add ⋮ overflow menu** to all song rows + bottom sheet.
5. **Build Up Next screen** as a new composable accessible from the player.
6. **Implement shuffle toggle** logic (shuffle remaining / unshuffle restore).
7. **Wire up Play/Shuffle buttons** on Anime, Artist, Playlist pages.
8. **Test and polish**.

---

## 9. Acceptance Criteria Checklist

- [ ] Tapping a song on any screen starts playback with that screen's songs as the queue.
- [ ] "Play" button starts unshuffled from track 1.
- [ ] "Shuffle" button starts shuffled from a random track, shuffle icon lit.
- [ ] Enabling shuffle reshuffles remaining (not played, not play-next) songs.
- [ ] Disabling shuffle restores original context order from current song.
- [ ] "Play Next" inserts after current, stacks LIFO, unaffected by shuffle toggle.
- [ ] "Add to Queue" appends to end, shuffled in if shuffle toggled on.
- [ ] ⋮ menu appears on every song row across all screens.
- [ ] Bottom sheet shows: Play Next (top), Save to Playlist (top), Add to Queue (bottom).
- [ ] Up Next screen shows history (dimmed, scrollable up) + current + upcoming.
- [ ] Tapping history track rewinds queue.
- [ ] Tapping upcoming track jumps to it.
- [ ] Queue persists across screen navigation (no queue loss on back press).
- [ ] MiniPlayer reflects current queue state at all times.
