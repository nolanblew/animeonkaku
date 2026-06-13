import type { AnimeThemesClient } from "../animethemes/client.js";
import type { AnimeThemeEntry, AnimeThemesLookupResult } from "../animethemes/types.js";
import type { JobQueue } from "../jobs/jobQueue.js";
import type { JobRecord } from "../jobs/types.js";
import type { KitsuClient } from "../kitsu/kitsuClient.js";
import type { KitsuAnimeEntry, KitsuGenre } from "../kitsu/types.js";

export interface SyncUserAuth {
  userId: string;
  accessToken: string | null;
  kitsuAuthState: string;
  lastSyncAt: Date | null;
  lastStatusSyncAt: Date | null;
}

export interface KitsuCatalogRecord {
  kitsuId: string;
  title: string | null;
  titleEn: string | null;
  titleRomaji: string | null;
  titleJa: string | null;
  abbreviatedTitles: string[];
  animethemesAnimeId: number | null;
  mappingState: string;
}

export interface SyncRepository {
  getUserSyncAuth(userId: string): Promise<SyncUserAuth | null>;
  upsertKitsuAnime(entries: KitsuAnimeEntry[]): Promise<void>;
  upsertLibraryEntries(userId: string, entries: KitsuAnimeEntry[]): Promise<void>;
  tombstoneMissingLibraryEntries(userId: string, activeKitsuIds: string[]): Promise<void>;
  upsertAnimeGenres(kitsuId: string, genres: KitsuGenre[]): Promise<void>;
  updateUserSyncTimestamps(
    userId: string,
    timestamps: { lastSyncAt?: Date; lastStatusSyncAt?: Date },
  ): Promise<void>;
  refreshAutoPlaylists?(userId: string): Promise<void>;
  getKitsuAnimeForMapping?(kitsuIds: string[]): Promise<KitsuCatalogRecord[]>;
  saveAnimeThemesCatalog?(themes: AnimeThemeEntry[]): Promise<void>;
  setAnimeThemeMappings?(mappings: Map<string, number>): Promise<void>;
  markAnimeUnmatched?(kitsuIds: string[]): Promise<void>;
  getThemeIdsMissingReadyAudio?(userId?: string): Promise<number[]>;
  getFailedAudioThemeIds?(): Promise<number[]>;
  markAudioMediaMissing?(themeIds: string[]): Promise<void>;
  listReadyMediaFilePaths?(): Promise<string[]>;
  listActiveUserIds?(): Promise<string[]>;
}

export interface KitsuClientLike
  extends Pick<KitsuClient, "getLibraryEntries" | "getLibraryEntriesUpdatedSince" | "getAnimeCategories"> {
  getAnimeMappings?: KitsuClient["getAnimeMappings"];
}

export type AnimeThemesClientLike = Pick<
  AnimeThemesClient,
  "fetchByKitsuIds" | "fetchByMalIds" | "searchByTitle"
> & {
  fetchByKitsuIds(kitsuIds: string[]): Promise<AnimeThemesLookupResult>;
  fetchByMalIds(malIds: string[]): Promise<AnimeThemesLookupResult>;
  searchByTitle(title: string): Promise<AnimeThemesLookupResult>;
};

export interface SyncJobInput {
  userId: string;
  full: boolean;
  job: JobRecord;
}

export interface MapThemesInput {
  kitsuIds: string[];
  userId?: string | undefined;
  job: JobRecord;
}

export interface LibrarySyncPipelineDeps {
  repo: SyncRepository;
  kitsu: KitsuClientLike;
  animeThemes: Partial<AnimeThemesClientLike>;
  queue: JobQueue;
  now?: () => Date;
  mappingBatchSize?: number;
}
