export interface AnimeThemesArtistCredit {
  name: string;
  asCharacter: string | null;
  alias: string | null;
}

export interface AnimeThemeEntry {
  animeId: number;
  animeName: string | null;
  animeNameEn: string | null;
  animeSynonyms: string[];
  kitsuId: string | null;
  coverUrl: string | null;
  themeId: number;
  title: string;
  artistName: string | null;
  audioUrl: string;
  videoUrl: string;
  themeType: string | null;
  artists: AnimeThemesArtistCredit[];
  videoFallback: boolean;
}

export interface AnimeThemesLookupResult {
  themes: AnimeThemeEntry[];
  mappings: Map<string, number>;
}

