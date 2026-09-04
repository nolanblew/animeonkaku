# Version preferences and watched dates

Theme reactions apply to the whole theme. A size-only dislike excludes that audio size while leaving the other size eligible. Choosing a size-only dislike clears a whole-theme dislike; liking the theme clears its dislikes. Related catalog songs retain their own reactions.

The saved song preference takes precedence over a playlist's preferred version (including an entry override). An unavailable preferred size falls back to the other allowed audio size, online or from downloaded audio. A disliked size is never an audio fallback.

Playlists expose **Require selected version**. When enabled, a missing or disliked size, or a conflicting saved song preference, skips that theme for playback and downloads. This uses the existing `overrideUserPreference` wire field for compatibility; existing playlists with that flag enabled now use required-version semantics. When disabled, the playlist version is preferred. Song entries remain full audio.

Android reconciles tracked theme downloads when saved preferences or their media descriptors change. It replaces obsolete group membership and deletes a physical file only after its last download-group reference disappears. A size unavailable at the time of a dislike is not requested; arrival of that size can refresh a tracked theme download.

Kitsu library sync now includes Current, Completed, Planned, On hold, and Dropped on both clients. Watched-date filters and sorting use `finishedAt`, falling back to `startedAt`; unknown dates remain unknown. Neither `updatedAt` nor `progressedAt` is a viewing date: Kitsu updates the latter on status changes too. Legacy watched filter nodes follow the same rule.

The server migration adds `watched_at` and resets the Kitsu status-sync cursor so the next successful sync reads historical dates and all statuses. The Android Room migration adds a nullable `watchedAt` column without inventing dates. Recently liked planned shows can still match an explicit Liked branch of an OR filter.

Kitsu source: https://github.com/hummingbird-me/kitsu-server/blob/master/app/models/library_entry.rb
