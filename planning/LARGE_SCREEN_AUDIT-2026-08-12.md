# Large-screen screen audit

This checklist defines the foldable/tablet coverage for the adaptive UI branch. The shared app shell applies the window policy to every navigable destination; individual browse and hero screens add responsive grids or media sizing where a width cap alone is not sufficient.

## Window behavior

- Compact (`<600dp`): bottom navigation, full-width mini player, full-screen Now Playing.
- Medium (`600-839dp`): bottom navigation with a dedicated right-side mini-player region; Now Playing opens as a scrimmed right-side panel and can expand full-screen.
- Expanded (`>=840dp`): navigation rail, responsive route content, right-side mini/player panel, and full-screen expansion.
- Browse destinations cap at `1440dp`; detail, search, settings, import, and smart-playlist flows cap at `960dp` for readable line lengths.

## Screen coverage

| Screen / state | Large-screen treatment |
| --- | --- |
| Onboarding / reconnect | Centered `960dp` surface with full-height background; preserves IME scrolling. |
| First sync: delta | Uses the centered onboarding surface so progress copy and indicator do not stretch. |
| First sync: carousel | Uses the centered onboarding surface; pager remains full width within the readable pane. |
| Home | Adaptive `320dp` grid for quick picks and top songs; headings, filters, empty states, and playlist carousel span the grid. |
| Search | Centered readable route pane; result rows retain compact touch targets. |
| Library: playlists | Adaptive `220dp` cards. |
| Library: songs | Readable route pane with full-width collection controls and rows. |
| Library: albums | Adaptive `180dp` cards. |
| Library: artists | Adaptive `150dp` cards. |
| Playlist detail | Centered detail pane and larger `220dp` cover outside compact width. |
| Anime detail | Centered detail pane; wide hero is height-capped at `380dp` instead of scaling to an oversized phone aspect ratio. |
| Related music | Centered detail pane for release/track lists. |
| Artist detail | Centered detail pane with a wider `320dp` hero and `132dp` portrait outside compact width. |
| Settings | Centered form pane. |
| Download manager | Centered form/list pane. |
| About | Centered form pane. |
| Import | Centered form pane. |
| Smart playlist: simple | Centered form pane. |
| Smart playlist: preview | Centered form/list pane. |
| Smart playlist: advanced | Centered form pane; modal sheets retain Material large-screen constraints. |
| Smart playlist: sort | Centered form pane; modal sheets retain Material large-screen constraints. |
| Smart playlist: edit | Reuses the adaptive simple/advanced destinations. |
| Explore (currently not routed) | Explicit `960dp` cap so it is safe if restored to navigation. |
| Mini player | Full-width above navigation on compact; Apple Music-style right-side region on medium/expanded. |
| Now Playing | Full-screen on compact; rounded scrimmed side panel on medium/expanded with an explicit full-screen action. |
| Up Next / history | Opens inline inside the side panel, keeps queue reordering/actions, and adds persistent seek/transport controls; compact retains the modal sheet. |

## Verification checklist

- Unit policy thresholds and player-state transitions.
- Full Android unit suite and lint.
- Debug APK assembly and install.
- Compact device: Home, Search, all Library tabs, detail screens, settings/import/download/about, smart-playlist screens, mini player, full player, queue.
- Expanded-width device: bottom/rail threshold, every route width, adaptive grids, hero sizing, side player, inline queue, full-screen expansion, back sequence, rotation/resize.
- Logcat check for fatal/unhandled exceptions after the route pass.
