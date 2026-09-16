# Queue playback and version selection

Android and web keep a desired version for the current queue: **TV Size**, **Full Size**, or **Video**. This is separate from a theme's saved **Prefer** setting and from the version actually playing. A fallback changes the current song's actual version without changing the queue's desired version.

For example, a Full Size queue plays **Full → Full → TV → Full** when only its third song lacks Full Size.

## Choosing the first version of a song

Availability and strict playlist requirements always apply. Automatic playback excludes whole-song dislikes and disliked audio versions. After those constraints, the player uses:

1. An explicit current-song version selection, when there is one. You can deliberately select an available disliked version.
2. Video when it is the effective queue choice. Audio preferences and audio-version dislikes do not apply to Video.
3. The theme's saved audio preference.
4. The queue's desired version, including an applicable playlist preference.
5. TV Size by default.

| Desired version | Automatic candidates, in order |
| --- | --- |
| TV Size | TV Size, Full Size, then skip |
| Full Size | Full Size, TV Size, then skip |
| Video | Video, TV Size, then skip |
| Strict playlist audio | Required audio, then skip |
| Video in a strict playlist | Video, required audio, then skip |

Candidates must exist and must not be disliked. Video is never an automatic fallback from audio. A strict entry must have its required audio version even when Video exists. Whole-song dislikes still prevent automatic Video playback; Video itself has no version-specific dislike.

Android applies availability to downloaded media when offline. An uncached server URL can still be playable online: a cache state such as `MISSING` does not by itself mean that the version does not exist. Standalone songs and OST tracks play their own audio and do not change the desired theme version.

## Changing a preference during playback

Selecting a version in Now Playing immediately switches this song and makes that version the queue's new desired version. It does not change the theme's saved **Prefer** setting. Available disliked versions remain selectable and have a visual indicator.

Changing the saved **Prefer** setting while the song is playing reevaluates that song immediately, subject to strict requirements. A later manual version selection overrides it for the current occurrence again.

Disliking the audio version currently playing tries the other allowed audio version immediately. If neither audio version is allowed, playback advances. This records the new actual version but preserves the queue's desired version. Disliking the whole song also advances. A new dislike takes precedence over an older manual override for the affected current occurrence.

## Playlist preferences and requirements

Starting any song, Play, or Shuffle from a playlist seeds the new queue with that playlist's preference. The preference survives a first-song fallback. Starting a playlist without a preference uses the normal new-queue default.

Within an existing queue, a manual selection supersedes older soft playlist preferences. A later Play Next or Add to Queue action from a playlist with a preference applies that newer preference to the inserted entries; it does not rewrite the desired version for unrelated queue entries. A playlist without a preference leaves the active queue's desired version alone. Saved per-theme audio preferences still take priority on automatic first play.

**Require selected version** is attached to each queue occurrence from that playlist. A conflicting saved audio preference does not defeat the requirement. Missing or automatically disliked required audio causes that occurrence to be skipped. You can create a strict playlist even when some songs lack the required version.

The picker for a strict occurrence offers only its required audio and available Video. Video may continue playing, but the other audio size is not selectable. Songs inserted from another source keep their own source rules. Moving or shuffling an entry does not remove its requirement.

Android downloads likewise honor the required audio size and ignore conflicting saved audio preferences. They never download Video as an audio fallback and exclude disliked audio.

## Back, repeat, and explicit replay

Every copy of a song in the queue has its own identity and playback memory. Back and repeat return to that occurrence's last actual version when it is still allowed, even if the queue's desired version has since changed. If that media has become unavailable or newly disallowed, the player resolves an allowed fallback or skips the occurrence. Ordinary transport navigation does not grant permission to play a disliked song or version.

Tapping a queue or history row is an explicit replay request. It restores that occurrence's last actual version and allows it through dislike filtering. This **unskip** exception belongs to that copy; it survives reorder, shuffle, repeat, and queue restoration. It does not unskip other copies, bypass missing media, or relax a strict requirement. Skipped entries remain selectable in the queue.

Replacing the queue or letting it finish completely resets its desired-version preference. Restoring an unfinished queue after an app restart retains the desired version, occurrence history, and unskip state. Queues and this transient preference are local to the device; they are not synchronized through the API.

## Sonos

Sonos uses audio only: saved theme preference, then playlist preference, then TV Size, with the same audio fallback, dislike, availability, and strict-requirement rules. It does not inherit another device's Now Playing selection and has no version picker. Playlist-qualified playback is reevaluated against its originating playlist rules when its media URI is requested.

## Implementation and regression coverage

- Web and Sonos share the stateless selection policy in `shared/queueModePolicy.ts`.
- Android centralizes source selection in `PlaybackResolver`; `NowPlayingManager` owns queue identity and history, and `MediaControllerManager` reconciles those decisions with Media3.
- `shared/queue-mode-policy.fixtures.json` supplies matching cases for TypeScript and Kotlin. Player tests additionally cover action ordering, duplicate occurrences, replay, restoration, and strict mixed-source queues.
- Queue identity and insertion invariants are documented in [the Now Playing specification](../NOW_PLAYING_SPEC.md). Saved reactions and library dates are described in [Version preferences and watched dates](variant-preferences-and-watched-dates.md).
