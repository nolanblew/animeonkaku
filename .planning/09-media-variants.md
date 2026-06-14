# Spike 09 — Multi-variant media storage

> Scaffolding for storing more than one media binary per theme. Implemented as the
> storage/model layer only — today the server still fetches just the canonical short
> audio. Full-length audio and opening video are future work that plug into this model.

## Why

A theme (one OP/ED) maps to a single AnimeThemes "song", but several *binaries*:

- **Short audio** — the ~90 s audio cut AnimeThemes serves at `a.animethemes.moe`. This is what we store and play today.
- **Full-length audio** — the complete track (future; no public AnimeThemes source yet — likely derived from the video or a different origin).
- **Opening video** — the webm at `v.animethemes.moe` (full-length, with picture).

The original schema stored exactly one binary per theme (`media_files` unique on
`(kind, ref_id)`, with `ref_id = themeId` for audio). That can't represent "this theme
has a short audio cut *and* a full video." This spike makes the storage model able to.

## Model

Two orthogonal axes identify a stored binary:

| Axis | Column | Values | Meaning |
|---|---|---|---|
| **kind** | `media_files.kind` | `AUDIO`, `VIDEO`, `ANIME_POSTER`, `ANIME_COVER`, `ARTIST_IMAGE` | content class |
| **variant** | `media_files.variant` (new) | `SHORT`, `FULL`, `DEFAULT` | which cut/source |

A theme can therefore hold rows such as:

```
(AUDIO, theme 3040, SHORT)  ← today's canonical playable audio
(AUDIO, theme 3040, FULL)   ← future full-length audio
(VIDEO, theme 3040, FULL)   ← future opening video
```

Images have no "cut" and use `variant = DEFAULT`.

### Canonical audio invariant

`(AUDIO, SHORT)` is the **canonical playable audio**. `GET /v1/media/audio/{themeId}`
resolves to it and must do so **forever** — changing what that URL serves, or the
on-disk path `audio/{themeId}.ogg`, would break already-cached clients and offline
downloads (FINAL_PLAN key invariant #3). New variants are always *additive* and get
their own URLs/paths. The constant lives in code as `CANONICAL_AUDIO` (`src/media/types.ts`).

## What changed in this spike

- **Schema** (`migration 0003_media_variants`): added `media_files.variant`
  (`text not null default 'DEFAULT'`); replaced unique `(kind, ref_id)` with
  `(kind, ref_id, variant)`; backfilled existing `AUDIO` rows to `SHORT`.
- **Types** (`src/media/types.ts`): `MediaKind` gained `VIDEO`; new `MediaVariant`,
  `MediaDescriptor`, `CANONICAL_AUDIO`, `IMAGE_VARIANT`.
- **On-disk layout** (`src/media/mediaLayout.ts`): `themeMediaFilePath(kind, variant, themeId)`
  — `(AUDIO, SHORT)` stays `audio/{id}.ogg`; other variants get distinct, non-colliding
  paths (`audio/{id}.full.ogg`, `video/{id}.webm`, …).
- **Catalog enumeration** (`src/media/catalogLookup.ts`): `deriveThemeMediaSources` /
  `listThemeMediaSources(themeId)` enumerate the variants a theme can currently supply
  from its origin URLs — `(AUDIO, SHORT)` always, `(VIDEO, FULL)` when a distinct video
  origin exists. This is the single place new sources slot in.
- **Repo + fetch + reads**: `media_files` writes/reads are keyed by `(kind, ref_id, variant)`;
  `FETCH_AUDIO`, the API audio/image resolvers, and the backfill/requeue/orphan scans all
  pin to the canonical variant so behavior is unchanged today.

Backward compatibility: `FETCH_AUDIO` payloads stay `{ themeId }` and resolve to the
canonical audio; no API surface changed.

## Future work (not in this spike)

1. **Add origin sources.** Give `themes` (or a `theme_media_sources` table) origins for
   full audio / extra video qualities, then extend `deriveThemeMediaSources`.
2. **Fetch other variants.** Generalize the fetch job to `{ themeId, kind, variant }`
   (default canonical) so the queue can warm `(AUDIO, FULL)` / `(VIDEO, FULL)`. The media
   store already takes a `variant` and writes distinct paths — no store changes needed.
3. **Expose other variants to clients.** Add `GET /v1/media/{type}/{themeId}` (or
   `/v1/media/audio/{themeId}?variant=full`) returning the requested variant, defaulting
   to canonical so old clients are unaffected. Surface a per-theme `mediaVariants[]` in
   `/v1/library` so the app can offer "play full version" / "watch video".
4. **Client + downloads.** Let the Android player/downloader pick a variant; keep the
   existing short-audio path as the default everywhere.

## Acceptance (this spike)

- `media_files` stores multiple variants per theme without constraint conflicts.
- Existing short audio still served at the same URL/path; full server test suite green.
- The model + on-disk layout + catalog enumeration are variant-aware and unit-tested
  (`test/media.variants.test.ts`), with no behavior change for current callers.
