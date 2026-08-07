export interface LegacyLibraryImportEntry {
  themeId: number;
  liked: boolean;
  disliked: boolean;
  playCount: number;
  lastPlayedAt?: number | null | undefined;
}

export interface LegacyLibraryImportPayload {
  entries: LegacyLibraryImportEntry[];
}

export interface LegacyLibraryImportResult {
  requestedEntries: number;
  importedEntries: number;
  skippedEntries: number;
  importedLikes: number;
  importedDislikes: number;
  importedPlayCounts: number;
}

export interface LegacyLibraryImportService {
  importLegacyLibrary(
    userId: string,
    payload: LegacyLibraryImportPayload,
  ): Promise<LegacyLibraryImportResult>;
}
