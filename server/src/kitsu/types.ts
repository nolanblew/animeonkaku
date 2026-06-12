export interface KitsuTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export interface KitsuSelfUser {
  id: string;
  name: string;
}

/** Library/catalog entry as consumed by the sync pipeline (port of the Android `KitsuAnimeEntry`). */
export interface KitsuAnimeEntry {
  id: string;
  title: string | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJa: string | null;
  abbreviatedTitles: string[];
  posterUrl: string | null;
  posterUrlLarge: string | null;
  coverUrl: string | null;
  coverUrlLarge: string | null;
  watchingStatus: string | null;
  subtype: string | null;
  startDate: string | null;
  endDate: string | null;
  episodeCount: number | null;
  ageRating: string | null;
  averageRating: number | null;
  userRating: number | null;
  /** Kitsu's ISO-8601 `updatedAt` on the library entry. */
  libraryUpdatedAt: string | null;
  slug: string | null;
}

export interface KitsuGenre {
  slug: string;
  displayName: string;
  source: string;
}
