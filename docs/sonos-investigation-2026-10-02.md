# Sonos content availability investigation — October 2, 2026

## Findings

The reported Sonos app failure has not yet been reproduced. There is no evidence
from these checks that the sandbox registration expired or that Sonos changed
the SMAPI contract used by this integration.

- Production `/healthz` returned HTTP 200 with healthy database status.
- The public `/sonos/smapi` endpoint returned HTTP 200 for `getLastUpdate`.
- An unauthenticated `getMetadata` request returned HTTP 500 with
  `Client.AuthTokenExpired`, as expected for the integration's manual
  reauthorization flow. This was a deliberate unauthenticated probe, not proof
  that the user's Sonos token has expired.
- A live Sonos speaker's `ListAvailableServices` response still included
  **Anime Ongaku**, service ID **1630**, SMAPI version **1.1**, AppLink
  authentication, and the correct `https://ongaku.takeya.ninja/sonos/smapi`
  endpoint. Its Sonos-hosted manifest and presentation map were reachable.
  This confirms registration on that speaker, not successful browsing in the
  updated mobile app.
- Five Sonos device sessions exist on the server. Their explicit expiry dates
  are in 2126. One was last used on September 30; four were last used on
  September 2. Session tokens and hashes were not printed or saved.
- `AuthService.authenticate` also imposes **30 days of inactivity**. The older
  sessions therefore require reauthorization if used now. The recently used
  session is within this limit. We cannot identify which session the failing
  Sonos app uses from these observations.
- Browser linking codes expire after **10 minutes**. This only limits the
  setup flow; it is separate from the account session and sandbox registration.
- The developer portal was signed out, with no prefilled login credentials.
  Portal settings were not changed, and the integration remains sandbox-only.

## What Sonos currently documents

- [Test your service](https://docs.sonos.com/docs/test-your-service) describes
  sandbox activation for specified Sonos IDs, configuration Refresh/Send, and
  up to ten minutes for changes to take effect. It does **not state a fixed
  sandbox lifetime**. Absence of an expiration policy on this page is not a
  guarantee that a particular account's registration cannot expire.
- [Sonos Music API](https://docs.sonos.com/docs/smapi) still documents SOAP 1.1
  and the browse/playback methods used here.
- The [September 29 app release notes](https://support.sonos.com/en-us/article/release-notes-sonos-app-updates)
  list new hardware support, not a SMAPI migration or sandbox expiration
  change. The September 8 release changed app navigation. These notes do not
  rule out an unlisted regression. The inspected speaker reports system
  version 97.1-80312, matching the
  [September 8 system release](https://support.sonos.com/en-us/article/release-notes-sonos-system-updates).
- [Use authentication tokens](https://docs.sonos.com/docs/use-authentication-tokens)
  documents manual reauthorization with `Client.AuthTokenExpired` for services
  without refresh tokens. This integration intentionally uses that model;
  absence of automatic refresh alone is not evidence of an API regression.
- [refreshAuthToken](https://docs.sonos.com/docs/refreshauthtoken) is part of
  the optional token-refresh flow. Do not infer that the app update began
  calling it without observing an actual request.

## Next diagnostic step

Retry browsing Anime Ongaku in the Sonos app while observing the server's
request logs. Record the time and exact on-screen error. A request reaching
SMAPI narrows the problem to the service response or account; no request
points toward the app's cached service configuration or Sonos's upstream path.
If the account is expired, reauthorize Anime Ongaku in Sonos. If registration
needs refreshing, sign into the developer portal, confirm the intended Sonos
ID, and use the documented Refresh/Send flow without converting to production.

Do not change session lifetimes, disable authentication, or reset existing
accounts as a speculative fix. End-to-end Sonos browsing and playback remain
unverified until the reported failure can be reproduced and retried.
