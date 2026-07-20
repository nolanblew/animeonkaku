import type {
  AnimeThemeEntry,
  AnimeThemesArtistCredit,
  AnimeThemesSongResource,
  AnimeThemesVideoCandidate,
} from "./types.js";

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
  const animeSynonyms = synonymTitles(animeObject);
  const kitsuId = externalIdForSite(animeObject, "Kitsu");
  const coverUrl = coverImageUrl(animeObject);

  return asRecordArray(animeObject.animethemes).map((theme) => {
    const themeId = numericId(theme.id);
    if (themeId === null) {
      throw new AnimeThemesParseError(`AnimeThemes theme has non-numeric id: ${String(theme.id)}`);
    }

    // Keep the historical TV-size behavior: its audio comes from the first
    // usable video record returned by AnimeThemes, independently of video
    // descriptor ranking.
    const audioSource = flattenedVideos(theme).find(hasUsableAudioOrVideo);
    if (!audioSource) return null;

    const resolvedAudio = resolveAudioUrl(audioSource);
    if (!resolvedAudio) return null;

    const song = asRecord(theme.song);
    const animeThemesSongId = numericId(song?.id);
    const videoCandidates = rankedVideoCandidates(theme, themeId, animeThemesSongId);
    const artists = artistCredits(song);

    return {
      animeId,
      animeName,
      animeNameEn,
      animeSynonyms,
      kitsuId,
      coverUrl,
      themeId,
      animeThemesSongId,
      title: themeTitle(theme, song),
      artistName: artistName(song),
      audioUrl: resolvedAudio.url,
      videoUrl: videoCandidates[0]?.link ?? null,
      themeType: themeType(theme),
      artists,
      songResources: songResources(song),
      videoCandidates,
      videoFallback: resolvedAudio.videoFallback,
    };
  }).filter((entry): entry is AnimeThemeEntry => entry !== null);
}

/**
 * Parse and rank all stable AnimeThemes video descriptors for a theme.
 * Candidates without numeric entry/video IDs or a direct link cannot be
 * refreshed safely and are deliberately omitted from the remote catalog.
 */
function rankedVideoCandidates(
  theme: Record<string, unknown>,
  themeId: number,
  animeThemesSongId: number | null,
): AnimeThemesVideoCandidate[] {
  const candidates = asRecordArray(theme.animethemeentries).flatMap((entry) => {
    const animeThemesEntryId = numericId(entry.id);
    if (animeThemesEntryId === null) return [];

    const entryVersion = integerValue(entry.version);
    // Upstream order is optional metadata. Do not replace it with response
    // array position: API response order is not a stable selection signal.
    const entryOrder = integerValue(entry.order);
    const entrySpoiler = booleanValue(entry.spoiler);
    const entryNsfw = booleanValue(entry.nsfw);

    return asRecordArray(entry.videos).flatMap((video) => {
      const animeThemesVideoId = numericId(video.id);
      const link = stringValue(video.link);
      if (animeThemesVideoId === null || link === null) return [];

      return [{
        animeThemesVideoId,
        animeThemesEntryId,
        themeId,
        animeThemesSongId,
        entryVersion,
        entryOrder,
        link,
        mimeType: stringValue(video.mimetype ?? video.mime_type ?? video.mimeType),
        resolution: resolutionValue(video.resolution),
        source: stringValue(video.source),
        spoiler: entrySpoiler || booleanValue(video.spoiler),
        nsfw: entryNsfw || booleanValue(video.nsfw),
        creditless: booleanValue(video.nc ?? video.creditless),
        subbed: booleanValue(video.subbed),
        lyrics: booleanValue(video.lyrics),
        preferenceRank: 0,
      }];
    });
  });

  return candidates
    .sort(compareVideoCandidates(themeId, animeThemesSongId))
    .map((candidate, preferenceRank) => ({ ...candidate, preferenceRank }));
}

function compareVideoCandidates(
  themeId: number,
  animeThemesSongId: number | null,
): (left: AnimeThemesVideoCandidate, right: AnimeThemesVideoCandidate) => number {
  return (left, right) =>
    exactCandidateRank(left, themeId, animeThemesSongId) - exactCandidateRank(right, themeId, animeThemesSongId) ||
    warningRank(left) - warningRank(right) ||
    nullableAscending(left.entryVersion, right.entryVersion) ||
    nullableAscending(left.entryOrder, right.entryOrder) ||
    sourceRank(left.source) - sourceRank(right.source) ||
    nullableDescending(left.resolution, right.resolution) ||
    left.animeThemesVideoId - right.animeThemesVideoId;
}

function exactCandidateRank(
  candidate: AnimeThemesVideoCandidate,
  themeId: number,
  animeThemesSongId: number | null,
): number {
  if (candidate.themeId !== themeId) return 2;
  if (animeThemesSongId !== null && candidate.animeThemesSongId !== animeThemesSongId) return 1;
  return 0;
}

function warningRank(candidate: AnimeThemesVideoCandidate): number {
  return candidate.spoiler || candidate.nsfw ? 1 : 0;
}

function sourceRank(source: string | null): number {
  switch (source?.trim().toUpperCase()) {
    case "BD": return 0;
    case "WEB": return 1;
    case "DVD": return 2;
    case "LD": return 3;
    case "VHS": return 4;
    case undefined: return 5;
    default: return 6;
  }
}

function nullableAscending(left: number | null, right: number | null): number {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function nullableDescending(left: number | null, right: number | null): number {
  return (right ?? Number.MIN_SAFE_INTEGER) - (left ?? Number.MIN_SAFE_INTEGER);
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

function synonymTitles(anime: Record<string, unknown>): string[] {
  return [
    ...new Set(
      asRecordArray(anime.animesynonyms ?? anime.synonyms)
        .map((candidate) => stringValue(candidate.text)?.trim())
        .filter((title): title is string => title !== undefined && title.length > 0),
    ),
  ];
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

function songResources(song: Record<string, unknown> | null): AnimeThemesSongResource[] {
  return asRecordArray(song?.resources).flatMap((resource) => {
    const site = stringValue(resource.site)?.trim();
    const externalId = externalIdValue(resource.external_id ?? resource.externalId);
    return site && externalId ? [{ site, externalId }] : [];
  });
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

function integerValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function resolutionValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:p)?$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

function externalIdValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" ||
    (typeof value === "string" && value.toLowerCase() === "true");
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
