# Anime Ongaku web player prototypes

Desktop-first visual direction for the first web-player milestone. Mobile should remain functional through a collapsible navigation rail and reflowing content, but these prototypes intentionally optimize the laptop/desktop experience.

## Screens

- `01-home.png` — discovery, quick picks, playlists, recent additions, and the persistent player.
- `02-anime-album.png` — anime/album hero, library state, theme table, and recommendations.
- `03-now-playing-song.png` — expanded Song mode with artwork, full controls, and the queue panel.
- `04-now-playing-video.png` — Video mode with a 16:9 stage and inline video controls.
- `05-now-playing-fullscreen.png` — fullscreen video with transient overlays and an exit-fullscreen control.

## Shared direction

- Near-black desktop canvas with restrained artwork-derived color washes.
- Coral pink is the primary action and playback color; cyan is reserved for informational state and secondary emphasis.
- A persistent left navigation and top search define the desktop shell. The bottom player appears on browsing/detail pages and is replaced by expanded controls on Now Playing.
- Anime-first metadata remains visible: anime title, OP/ED sequence, song, artist, and playback mode.
- Song and Video are explicit sibling modes. Fullscreen is a video-player state, not a separate navigation destination.
- Responsive implementation should collapse the sidebar, stack the player and queue, and reduce multi-column content without changing the underlying information hierarchy.

These are visual prototypes rather than pixel-locked specifications. Artwork and copy are representative; the implementation should use server-provided media and metadata.
