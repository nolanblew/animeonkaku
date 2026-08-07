import type { MusicCatalogQuery, MusicCatalogTarget } from "../types.js";
import { normalizeMusicText } from "./normalize.js";

const RELATED_TERMS = [
  "original soundtrack",
  "OST",
  "character song",
  "image song",
  "image album",
  "insert song",
  "オリジナルサウンドトラック",
  "サウンドトラック",
  "キャラクターソング",
  "イメージソング",
  "挿入歌",
] as const;

export function buildMusicCatalogQueries(target: MusicCatalogTarget): MusicCatalogQuery[] {
  const values: string[] = [];
  const titles = cleanUnique([...target.animeTitles, ...(target.seasonSpecificTitles ?? [])]);

  if (target.kind === "FULL_SIZE") {
    const song = target.title?.trim();
    const artist = target.artist?.trim();
    if (song && artist) values.push(`${song} ${artist}`);
    if (song) values.push(song);
    if (song) for (const animeTitle of titles) values.push(`${animeTitle} ${song}`);
    if (target.animeThemesSongId !== undefined) values.push(`AnimeThemes song ${target.animeThemesSongId}`);
    for (const resourceId of target.resourceIds ?? []) values.push(`AnimeThemes resource ${resourceId}`);
    if (target.musicbrainzRecordingId) values.push(`MusicBrainz recording ${target.musicbrainzRecordingId}`);
  } else {
    for (const animeTitle of titles) {
      for (const term of RELATED_TERMS) values.push(`${animeTitle} ${term}`);
    }
  }

  return cleanUnique(values).map((text) => ({ text, kind: target.kind }));
}

function cleanUnique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const display = value.trim().replace(/\s+/g, " ");
    const key = normalizeMusicText(display);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(display);
  }
  return result;
}
