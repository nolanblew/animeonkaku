import type { AnimeThemeEntry, AnimeThemesArtistCredit } from "./types.js";

const AUDIO_BASE_URL = "https://a.animethemes.moe";
const IMAGE_BASE_URL = "https://i.animethemes.moe";

export class AnimeThemesParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnimeThemesParseError";
  }
}

export interface AnimeThemesPage {
  anime: Record<string, unknown>[];
  next: string | null;
}

export function parseAnimeThemesPage(body: unknown): AnimeThemesPage {
  const object = asRecord(body);
  return {
    anime: asRecordArray(object?.anime),
    next: stringValue(asRecord(object?.links)?.next),
  };
}

export function parseSingleAnime(body: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(body)?.anime);
}

export function toThemeEntries(anime: unknown): AnimeThemeEntry[] {
  const animeObject = asRecord(anime);
  if (!animeObject) return [];

  const animeId = numericId(animeObject.id);
  if (animeId === null) return [];

  const animeName = stringValue(animeObject.name);
  const animeNameEn = englishTitle(animeObject);
  const kitsuId = externalIdForSite(animeObject, "Kitsu");
  const coverUrl = coverImageUrl(animeObject);

  return asRecordArray(animeObject.animethemes).map((theme) => {
    const themeId = numericId(theme.id);
    if (themeId === null) {
      throw new AnimeThemesParseError(`AnimeThemes theme has non-numeric id: ${String(theme.id)}`);
    }

    const video = flattenedVideos(theme).find(hasUsableAudioOrVideo);
    if (!video) return null;

    const resolvedAudio = resolveAudioUrl(video);
    if (!resolvedAudio) return null;

    const videoUrl = stringValue(video.link) ?? resolvedAudio.url;
    const song = asRecord(theme.song);
    const artists = artistCredits(song);

    return {
      animeId,
      animeName,
      animeNameEn,
      kitsuId,
      coverUrl,
      themeId,
      title: themeTitle(theme, song),
      artistName: artistName(song),
      audioUrl: resolvedAudio.url,
      videoUrl,
      themeType: themeType(theme),
      artists,
      videoFallback: resolvedAudio.videoFallback,
    };
  }).filter((entry): entry is AnimeThemeEntry => entry !== null);
}

export function animeId(anime: unknown): number | null {
  return numericId(asRecord(anime)?.id);
}

export function externalIdForSite(anime: unknown, site: string): string | null {
  const animeObject = asRecord(anime);
  if (!animeObject) return null;

  const resource = asRecordArray(animeObject.resources).find((candidate) => {
    const candidateSite = stringValue(candidate.site);
    return candidateSite?.toLowerCase() === site.toLowerCase();
  });
  const externalId = resource?.external_id ?? resource?.externalId;
  if (typeof externalId === "string" && externalId.trim().length > 0) return externalId;
  if (typeof externalId === "number" && Number.isFinite(externalId)) {
    return Math.trunc(externalId).toString();
  }
  return null;
}

function flattenedVideos(theme: Record<string, unknown>): Record<string, unknown>[] {
  return asRecordArray(theme.animethemeentries).flatMap((entry) => asRecordArray(entry.videos));
}

function hasUsableAudioOrVideo(video: Record<string, unknown>): boolean {
  const audio = asRecord(video.audio);
  return (
    stringValue(audio?.link) !== null ||
    stringValue(audio?.path) !== null ||
    stringValue(video.link) !== null
  );
}

function resolveAudioUrl(video: Record<string, unknown>): { url: string; videoFallback: boolean } | null {
  const audio = asRecord(video.audio);
  const audioLink = stringValue(audio?.link);
  if (audioLink) return { url: audioLink, videoFallback: false };

  const audioPath = stringValue(audio?.path);
  if (audioPath) return { url: originUrl(AUDIO_BASE_URL, audioPath), videoFallback: false };

  const videoLink = stringValue(video.link);
  return videoLink ? { url: videoLink, videoFallback: true } : null;
}

function coverImageUrl(anime: Record<string, unknown>): string | null {
  const images = asRecordArray(anime.images);
  const preferred =
    images.find((image) => stringValue(image.facet)?.toLowerCase().includes("large cover")) ??
    images.find((image) => stringValue(image.facet)?.toLowerCase().includes("small cover")) ??
    images[0];

  const link = stringValue(preferred?.link);
  if (link) return link;

  const path = stringValue(preferred?.path);
  return path ? originUrl(IMAGE_BASE_URL, path) : null;
}

function englishTitle(anime: Record<string, unknown>): string | null {
  const synonym = asRecordArray(anime.animesynonyms ?? anime.synonyms).find(
    (candidate) => stringValue(candidate.type)?.toLowerCase() === "english",
  );
  return stringValue(synonym?.text);
}

function themeTitle(theme: Record<string, unknown>, song: Record<string, unknown> | null): string {
  const songTitle = stringValue(song?.title);
  if (songTitle) return songTitle;

  const type = stringValue(theme.type);
  const sequence = numericId(theme.sequence);
  if (sequence !== null) return `${type ?? "Theme"} ${sequence}`;
  return type ?? "Theme";
}

function themeType(theme: Record<string, unknown>): string | null {
  const type = stringValue(theme.type);
  if (!type) return null;

  const sequence = numericId(theme.sequence);
  return `${type}${sequence ?? ""}`;
}

function artistCredits(song: Record<string, unknown> | null): AnimeThemesArtistCredit[] {
  return asRecordArray(song?.artists)
    .map((artist) => {
      const name = stringValue(artist.name)?.trim();
      if (!name) return null;

      const artistSong = asRecord(artist.artistsong);
      return {
        name,
        asCharacter: blankToNull(stringValue(artistSong?.as)?.trim()),
        alias: blankToNull(stringValue(artistSong?.alias)?.trim()),
      };
    })
    .filter((artist): artist is AnimeThemesArtistCredit => artist !== null);
}

function artistName(song: Record<string, unknown> | null): string | null {
  const names = new Set(
    asRecordArray(song?.artists)
      .map((artist) => stringValue(artist.name)?.trim())
      .filter((name): name is string => name !== undefined && name.length > 0),
  );
  return names.size > 0 ? [...names].join(", ") : null;
}

function originUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}/${path.replace(/^\/+/, "")}`;
}

function numericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function blankToNull(value: string | null | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => asRecord(item) !== null)
    : [];
}
