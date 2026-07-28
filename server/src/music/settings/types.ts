export const MUSIC_SEARCH_MODES = ["MANUAL", "FAVORITES", "PLAYLISTS", "EVERYTHING"] as const;
export type MusicSearchMode = typeof MUSIC_SEARCH_MODES[number];

export interface MusicSearchSettingsRecord {
  mode: MusicSearchMode;
  updatedAt: Date;
}

export interface EligibleAnime {
  userId: string;
  kitsuId: string;
}

export interface MusicSearchSettingsRepository {
  getMode(): Promise<MusicSearchSettingsRecord>;
  setMode(mode: MusicSearchMode): Promise<MusicSearchSettingsRecord>;
  listEligibleAnime(mode: Exclude<MusicSearchMode, "MANUAL">): Promise<EligibleAnime[]>;
}

export interface MusicSearchSettingsDto {
  mode: MusicSearchMode;
  updatedAt: string;
}
