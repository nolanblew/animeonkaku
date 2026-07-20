export interface AnimeThemesArtistCredit {
  name: string;
  asCharacter: string | null;
  alias: string | null;
}

export interface AnimeThemesSongResource {
  site: string;
  externalId: string;
}

/** A stable, remotely hosted AnimeThemes video descriptor. */
export interface AnimeThemesVideoCandidate {
  animeThemesVideoId: number;
  animeThemesEntryId: number;
  themeId: number;
  animeThemesSongId: number | null;
  entryVersion: number | null;
  entryOrder: number | null;
  link: string;
  mimeType: string | null;
  resolution: number | null;
  source: string | null;
  spoiler: boolean;
  nsfw: boolean;
  creditless: boolean;
  subbed: boolean;
  lyrics: boolean;
  preferenceRank: number;
}

export interface AnimeThemeEntry {
  animeId: number;
  animeName: string | null;
  animeNameEn: string | null;
  animeSynonyms: string[];
  kitsuId: string | null;
  coverUrl: string | null;
  themeId: number;
  animeThemesSongId: number | null;
  title: string;
  artistName: string | null;
  audioUrl: string;
  videoUrl: string | null;
  themeType: string | null;
  artists: AnimeThemesArtistCredit[];
  songResources: AnimeThemesSongResource[];
  videoCandidates: AnimeThemesVideoCandidate[];
  videoFallback: boolean;
}

export interface AnimeThemesLookupResult {
  themes: AnimeThemeEntry[];
  mappings: Map<string, number>;
}

