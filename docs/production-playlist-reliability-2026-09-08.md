# Production playlist reliability follow-up

Date: 2026-09-08

This records the production fixes and verification for the sign-in and dynamic-playlist incident. The application source keeps the existing Kitsu date contract: `finishedAt` is used when present, with `startedAt` as the fallback. The fixes described here were operational configuration and persisted library/playlist state changes.

## Sign-in recovery

After signing out, the web client rejected valid Kitsu credentials before authentication completed. The production `WEB_PUBLIC_ORIGIN` configuration was corrected to the deployed web origin. Browser sign-in and sign-out then succeeded repeatedly with the test account, and the production health endpoint reported a healthy API and database.

## Library refresh

A full Kitsu library sync was run for every configured account. The existing sync pipeline refreshed all five library statuses, repopulated watched dates from Kitsu, refreshed auto-updating dynamic playlists, and tombstoned entries no longer present upstream. The follow-up theme mapping queue completed without pending work.

The refresh confirmed that `on_hold`, `dropped`, and `planned` entries can retain a historical `startedAt` date. That value remains valid viewing history under the generic watched-date contract; status-specific playlist behavior belongs in the playlist filter tree rather than in a parser-side exception.

## `6 Months & Liked`

The saved playlist now uses this explicit rule:

```text
AND(
  OR(
    current,
    AND(completed, watched_on > relative MONTHS 6),
    liked
  ),
  NOT(disliked)
)
```

The playlist remains auto-updating and retains its existing sort order. Production verification showed 134 tracks, zero disliked tracks, and 14 liked tracks retained outside the current/recently-completed branches. Recent completed titles with individual disliked themes were excluded at the theme level while their other eligible themes remained available.

## Verification

- Browser sign-in and sign-out succeeded after the origin configuration repair.
- Production health checks reported both API and database healthy.
- The persisted playlist specification matched the rule above after save.
- Focused server parser/evaluator tests passed after restoring the generic watched-date implementation: 28 passed.
- No runtime source workaround was retained for planned, on-hold, or dropped statuses.
