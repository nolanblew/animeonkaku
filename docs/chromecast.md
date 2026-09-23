# Chromecast playback

The Android Now Playing header has a Cast button. Choose a device on the same network to hand audio playback and the resolved queue to it. The existing play/pause, seek, next/previous, repeat, shuffle, Play Next, and Add to Queue controls continue through the MediaSession. Disconnecting restores the latest queue and position to the phone **paused**.

## Enable the custom TV screen

1. Deploy the server and web assets from this change. The receiver is at `https://<your-server>/cast/index.html`. It must be reachable by the Chromecast over HTTPS with a trusted certificate. The phone's configured server address must also be reachable by the TV; localhost/ADB reverse addresses cannot work.
2. In the [Google Cast SDK Developer Console](https://cast.google.com/publish/), register a Custom Receiver using that URL. Register your test device for an unpublished receiver. See Google's [registration instructions](https://developers.google.com/cast/docs/registration).
3. Build Android with the issued app ID, using one of:
   - Environment variable `ONGAKU_CAST_APP_ID`
   - Gradle property `-PongakuCastAppId=<app-id>`
   - `ongaku.castAppId=<app-id>` in `src/local.properties`
4. Install the resulting APK and cast from the Now Playing screen.

Without a custom ID, Android uses Google's Default Media Receiver (`CC1AD845`). Audio and queue controls work through that receiver; the custom artwork screen, visualizer, and Up Next card require registration of our receiver. No production deployment or Cast registration is performed by building the code.

The TV view shows artwork, title, artist, a bottom progress bar, and the next queue occurrence in the final 20 seconds. It respects repeat-one and repeat-all and continues automatically. Web Audio analysis drives the visualizer where supported; unsupported devices and reduced-motion mode show quiet bars. Audio output does not depend on visualization support.

## Transport and access

- `POST /v1/cast/session` requires the Android bearer session and returns a random, media-only credential lasting 12 hours. It does not authorize other API endpoints.
- `/v1/cast/audio/themes/:id.mp3` and `/v1/cast/audio/songs/:id.mp3` accept that credential as `castToken`. GET, HEAD, range reads and CORS are supported. They reuse the existing bounded MP3 conversion/cache used by Sonos. FFmpeg and server-cached source audio are required; the first conversion can take time.
- The server stores hashes of Cast credentials and the parent bearer token. Parent logout/revocation invalidates subsequent reads. Credentials are in memory, so reconnect after a server restart or expiry. Cast request logging is disabled in Fastify; reverse proxies must also omit/redact the `castToken` query parameter. Responses use private/no-store caching.
- Downloads still cast the matching server variant, never a phone file path. Offline-only audio cannot be sent from the phone. Video queues are rejected with a message; choose TV Size/Full Size or disconnect to play video.
- Queue identities remain occurrence IDs, including duplicate songs. Cast queue mutations use one queue load to avoid asynchronous index races; position is retained, but edits may cause a brief rebuffer. Receiver playback continues without an active phone UI. The phone must reconnect to edit the queue.

## Validation

Android unit tests cover media-key mapping, handoff position/pause policy, and duplicate queue occurrences. Server tests cover authentication, expiry, revocation, CORS, range forwarding, HEAD, and capacity limits. Receiver tests exercise countdown, repeat, duplicates, unknown duration, and queue end. `cast-tests/receiver-smoke.js` drives the receiver in a browser with a documented CAF API stub; it does not emulate Chromecast hardware.

Run the pure receiver tests with `node --test cast-tests/receiver.test.mjs`. A browser layout preview is available at `/cast/index.html?preview=1` and uses fictional metadata, without starting a Cast session.

Before release, verify on a real phone and Chromecast: paused/playing handoff mid-song, actual audio output and analysis, next track with the phone locked, duplicate songs, single/multi-song insertions under shuffle, repeat-one/all, reconnect, queue exhaustion, server restart, and disconnect without unexpected phone playback. Physical Cast verification remains required.
