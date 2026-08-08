import { amfJobCreateSchema, type AmfJobCreate } from "../animeMusicFetcher/schemas.js";
import { SUPPORTED_AUDIO_FORMATS } from "./deliveryImporter.js";
import type { MusicRequestScope } from "./types.js";

type LocalizedNames = { english?: string | null; romaji?: string | null; japanese?: string | null };

export interface MusicRequestTheme {
  id: number;
  themeType: string | null;
  title: string;
  artists: string[];
  /** Localized song title from a full song already matched to this theme, if
   * any. Falls back to `title` (as romaji) when nothing has been matched yet. */
  titleEnglish?: string | null;
  titleJapanese?: string | null;
  titleRomaji?: string | null;
  /** Localized per-artist names from a matched full song, if any. Falls back
   * to romaji-only entries built from `artists` when nothing has matched yet. */
  artistNames?: LocalizedNames[] | null;
}

export interface MusicRequestMetadata {
  kitsuId: string;
  requestId: string;
  /** AnimeThemes' own URL slug (e.g. "toradora"), when synced. Pins the exact
   * AnimeThemes entry for AMF instead of letting it re-derive identity from
   * translated titles. */
  animeThemesSlug?: string | null;
  titles: {
    title?: string | null;
    english?: string | null;
    japanese?: string | null;
    romaji?: string | null;
    animeThemesName?: string | null;
    animeThemesNameEn?: string | null;
  };
  themes: MusicRequestTheme[];
}

export interface BuiltMusicRequestBatch {
  index: number;
  body: AmfJobCreate;
  items: Array<{ itemIndex: number; kind: string; number: number | null; themeId: number | null }>;
}

export function buildMusicRequestBatches(
  input: MusicRequestMetadata,
  options: { includeRelated?: boolean; scope?: MusicRequestScope } = {},
): BuiltMusicRequestBatch[] {
  const primary = {
    english: clean(input.titles.english) ?? clean(input.titles.animeThemesNameEn),
    japanese: clean(input.titles.japanese),
    romaji: clean(input.titles.romaji) ?? clean(input.titles.animeThemesName) ?? clean(input.titles.title),
  };
  if (!primary.english && !primary.japanese && !primary.romaji) {
    throw new Error("Anime has no primary title for Anime Music Fetcher.");
  }
  const names = unique([
    input.titles.title,
    input.titles.animeThemesName,
    input.titles.animeThemesNameEn,
  ].map(clean).filter((value): value is string => Boolean(value)))
    .filter((value) => !Object.values(primary).includes(value));

  const themesByNumber = new Map<string, {
    theme: MusicRequestTheme;
    kind: "OP" | "ED";
    number: number;
  }>();
  const unnumberedThemes: Record<"OP" | "ED", MusicRequestTheme[]> = { OP: [], ED: [] };
  for (const theme of input.themes) {
    const match = /^(OP|ED)([1-9]\d?)?$/i.exec(theme.themeType?.trim() ?? "");
    if (!match) continue;
    const kind = match[1]!.toUpperCase() as "OP" | "ED";
    if (!match[2]) {
      unnumberedThemes[kind].push(theme);
      continue;
    }
    const number = Number(match[2]);
    const key = `${kind}:${number}`;
    const existing = themesByNumber.get(key);
    if (!existing || theme.id < existing.theme.id) {
      themesByNumber.set(key, { theme, kind, number });
    }
  }
  for (const kind of ["OP", "ED"] as const) {
    const [onlyTheme] = unnumberedThemes[kind];
    const key = `${kind}:1`;
    if (unnumberedThemes[kind].length === 1 && onlyTheme && !themesByNumber.has(key)) {
      themesByNumber.set(key, { theme: onlyTheme, kind, number: 1 });
    }
  }
  const numbered = [...themesByNumber.values()].sort((a, b) => {
    const kind = (a.kind === "OP" ? 0 : 1) - (b.kind === "OP" ? 0 : 1);
    return kind || a.number - b.number || a.theme.id - b.theme.id;
  }).map(({ theme, kind, number }) => {
    const artists = unique(theme.artists.map(clean).filter((value): value is string => Boolean(value)));
    return {
      kind,
      number,
      themeId: theme.id,
      version: "FULL" as const,
      release_preference: "INDIVIDUAL" as const,
      song_titles: songTitlesFor(theme),
      artists,
      artist_names: artistNamesFor(theme, artists),
    };
  });
  const categories = (["OST", "CHARACTER_SONG", "DRAMA", "OTHER"] as const).map((kind) => ({
    kind,
    themeId: null,
    release_preference: kind === "OTHER" ? "ANY" as const : "COLLECTION" as const,
  }));
  const items = options.scope === "FULL_SONGS" ? numbered
    : options.scope === "EXTRA_MUSIC" ? categories
      : options.includeRelated === false ? numbered : [...numbered, ...categories];
  const animeThemesSlug = clean(input.animeThemesSlug);
  const batches: BuiltMusicRequestBatch[] = [];
  for (let offset = 0; offset < items.length; offset += 12) {
    const index = offset / 12;
    const slice = items.slice(offset, offset + 12);
    const body = amfJobCreateSchema.parse({
      titles: { ...primary, ...(names.length > 0 ? { names } : {}) },
      items: slice.map(({ themeId: _themeId, ...item }) => item),
      metadata_lookup: true,
      ...(animeThemesSlug ? { animethemes_slug: animeThemesSlug } : {}),
      // Restrict AMF's own selection to formats Anime Ongaku can actually
      // import (see deliveryImporter.ts SUPPORTED_AUDIO_EXTENSIONS). This
      // prevents AMF from ever delivering e.g. ape/wv, rather than us
      // rejecting them after the fact (F6 in the AMF robustness review).
      quality: { preferred_formats: SUPPORTED_AUDIO_FORMATS },
      destination: `anime-ongaku-staging/request-${input.requestId}/batch-${index}`,
      selection_mode: "automatic",
    });
    batches.push({ index, body, items: slice.map((item, itemIndex) => ({
      itemIndex, kind: item.kind, number: "number" in item ? item.number : null, themeId: item.themeId,
    })) });
  }
  return batches;
}

function clean(value: string | null | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Every known localization of a theme's song title. `titleRomaji` (from a
 * matched full song) is preferred over the bare AnimeThemes `title`, which is
 * kept only as the historical fallback so a theme with no full-song match yet
 * still sends the same single title AMF always got before this ticket.
 */
function songTitlesFor(theme: MusicRequestTheme): { english?: string; japanese?: string; romaji?: string } | undefined {
  const english = clean(theme.titleEnglish);
  const japanese = clean(theme.titleJapanese);
  const romaji = clean(theme.titleRomaji) ?? clean(theme.title);
  if (!english && !japanese && !romaji) return undefined;
  return {
    ...(english ? { english } : {}),
    ...(japanese ? { japanese } : {}),
    ...(romaji ? { romaji } : {}),
  };
}

/**
 * Localized per-artist names for `artist_names`. Prefers the richer shape
 * already retained on a matched full song; falls back to romaji-only entries
 * built from the plain artist names (the same identity the `artists` array
 * already sends) when nothing has matched yet.
 */
function artistNamesFor(theme: MusicRequestTheme, fallbackArtists: string[]): Array<{ english?: string; japanese?: string; romaji?: string }> | undefined {
  const fromMatchedSong = (theme.artistNames ?? [])
    .map((entry) => ({ english: clean(entry?.english), japanese: clean(entry?.japanese), romaji: clean(entry?.romaji) }))
    .filter((entry) => entry.english ?? entry.japanese ?? entry.romaji)
    .map((entry) => ({
      ...(entry.english ? { english: entry.english } : {}),
      ...(entry.japanese ? { japanese: entry.japanese } : {}),
      ...(entry.romaji ? { romaji: entry.romaji } : {}),
    }));
  if (fromMatchedSong.length > 0) return fromMatchedSong;
  return fallbackArtists.length > 0 ? fallbackArtists.map((name) => ({ romaji: name })) : undefined;
}
