import { amfJobCreateSchema, type AmfJobCreate } from "../animeMusicFetcher/schemas.js";

export interface MusicRequestTheme {
  id: number;
  themeType: string | null;
  title: string;
  artists: string[];
}

export interface MusicRequestMetadata {
  kitsuId: string;
  requestId: string;
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

export function buildMusicRequestBatches(input: MusicRequestMetadata): BuiltMusicRequestBatch[] {
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

  const numbered = input.themes.flatMap((theme) => {
    const match = /^(OP|ED)([1-9]\d?)$/i.exec(theme.themeType?.trim() ?? "");
    if (!match) return [];
    return [{
      theme,
      kind: match[1]!.toUpperCase() as "OP" | "ED",
      number: Number(match[2]),
    }];
  }).sort((a, b) => {
    const kind = (a.kind === "OP" ? 0 : 1) - (b.kind === "OP" ? 0 : 1);
    return kind || a.number - b.number || a.theme.id - b.theme.id;
  }).map(({ theme, kind, number }) => ({
    kind,
    number,
    themeId: theme.id,
    version: "FULL" as const,
    release_preference: "INDIVIDUAL" as const,
    song_titles: clean(theme.title) ? { romaji: clean(theme.title)! } : undefined,
    artists: unique(theme.artists.map(clean).filter((value): value is string => Boolean(value))),
  }));
  const categories = (["OST", "CHARACTER_SONG", "DRAMA", "OTHER"] as const).map((kind) => ({
    kind,
    themeId: null,
    release_preference: kind === "OTHER" ? "ANY" as const : "COLLECTION" as const,
  }));
  const items = [...numbered, ...categories];
  const batches: BuiltMusicRequestBatch[] = [];
  for (let offset = 0; offset < items.length; offset += 12) {
    const index = offset / 12;
    const slice = items.slice(offset, offset + 12);
    const body = amfJobCreateSchema.parse({
      titles: { ...primary, ...(names.length > 0 ? { names } : {}) },
      items: slice.map(({ themeId: _themeId, ...item }) => item),
      metadata_lookup: true,
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
