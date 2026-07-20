/**
 * Provider-neutral music catalog and acquisition boundary. These records are
 * deliberately internal: no listener API DTO is allowed to cross it.
 */
export type MusicCatalogTargetKind = "FULL_SIZE" | "RELATED_RELEASE";
export type MusicReleaseType =
  | "SOUNDTRACK"
  | "CHARACTER"
  | "IMAGE"
  | "THEME"
  | "INSERT"
  | "OTHER";

export interface NormalizedProviderTrack {
  provider: string;
  providerTrackId: string;
  providerReleaseId: string;
  musicbrainzRecordingId?: string;
  title: string;
  normalizedTitle: string;
  artistCredit: string;
  normalizedArtist: string;
  discNumber: number;
  trackNumber?: number;
  durationSeconds?: number;
}

export interface NormalizedProviderRelease {
  provider: string;
  providerReleaseId: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  title: string;
  normalizedTitle: string;
  artistCredit: string;
  normalizedArtist: string;
  releaseDate?: string;
  artworkUrl?: string;
  tracks: NormalizedProviderTrack[];
}

/**
 * A provider-local path is retained only for server-side import. It must never
 * be returned to listeners or written to normal structured request logs.
 */
export interface NormalizedProviderFile {
  provider: string;
  providerFileId: string;
  providerReleaseId: string;
  providerTrackId: string;
  /** Original provider/container path; never listener-facing or routinely logged. */
  sourcePath: string;
  /** Server-readable path after the adapter's configured prefix mapping. */
  readablePath: string;
  title: string;
  normalizedTitle: string;
  artistCredit: string;
  normalizedArtist: string;
  durationSeconds?: number;
  sizeBytes?: number;
  contentType?: string;
  musicbrainzRecordingId?: string;
}

export type MusicMatchEvidenceKind =
  | "MUSICBRAINZ_RECORDING_EXACT"
  | "MUSICBRAINZ_RECORDING_CONFLICT"
  | "TITLE_MATCH"
  | "ARTIST_MATCH"
  | "DURATION_MATCH"
  | "RELEASE_ANIME_ALIAS"
  | "RELEASE_TYPE"
  | "EXCLUSION";

export interface MusicMatchEvidenceSignal {
  kind: MusicMatchEvidenceKind;
  points: number;
  detail?: string;
}

export type MusicCatalogResolutionReason =
  | "NO_CANDIDATE"
  | "BELOW_CONFIDENCE_THRESHOLD"
  | "INSUFFICIENT_MARGIN"
  | "CONFLICTING_RECORDING_ID"
  | "FULL_SIZE_EXCLUSION"
  | "TRACK_NOT_IDENTIFIABLE"
  | "RELEASE_NOT_SEASON_SPECIFIC"
  | "RELEASE_RELATIONSHIP_AMBIGUOUS";

export interface MusicMatchEvidence {
  query?: string;
  signals: MusicMatchEvidenceSignal[];
  reasons: MusicCatalogResolutionReason[];
}

export interface MusicCatalogTarget {
  kind: MusicCatalogTargetKind;
  animeThemesAnimeId: number;
  animeTitles: string[];
  animeThemesSongId?: number;
  musicbrainzRecordingId?: string;
  title?: string;
  artist?: string;
  durationSeconds?: number;
}

export interface MusicCatalogQuery {
  text: string;
  kind: MusicCatalogTargetKind;
}

export interface MusicCatalogResolverInput {
  target: MusicCatalogTarget;
  candidates: NormalizedProviderRelease[];
}

export interface MusicCatalogResolution {
  outcome: "ACCEPTED" | "REJECTED" | "AMBIGUOUS";
  confidence: number;
  evidence: MusicMatchEvidence;
  reasons: MusicCatalogResolutionReason[];
  release?: NormalizedProviderRelease;
  track?: NormalizedProviderTrack;
  releaseClassification?: MusicReleaseClassification;
}

export interface MusicReleaseClassification {
  releaseType: MusicReleaseType;
  relationship: "SEASON_SPECIFIC" | "UNRELATED" | "AMBIGUOUS";
  evidence: MusicMatchEvidence;
}

export interface MusicCatalogResolver {
  buildQueries(target: MusicCatalogTarget): MusicCatalogQuery[];
  resolve(input: MusicCatalogResolverInput): MusicCatalogResolution;
}

export interface MusicProviderHealth {
  available: boolean;
  detail?: string;
}

export interface MusicProviderReleaseLookup {
  query: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
}

export interface EnsureMusicProviderRelease {
  release: NormalizedProviderRelease;
}

/**
 * Persist this alongside a music acquisition. It has the same semantics as
 * the ownership/monitoring/metadata columns in music_acquisitions so a later
 * reconciliation job can clean up safely after a process restart.
 */
export interface MusicProviderResourceContext {
  provider: string;
  providerReleaseId: string;
  providerResourceCreated: boolean;
  priorProviderMonitoringState?: string;
  providerMetadata: Record<string, unknown>;
}

export interface EnsuredMusicProviderRelease {
  resource: MusicProviderResourceContext;
}

export interface StartMusicAcquisition {
  providerReleaseId: string;
}

export interface StartedMusicAcquisition {
  providerJobId: string;
}

export interface MusicAcquisitionStatusRequest {
  providerJobId: string;
}

export interface MusicAcquisitionStatus {
  state: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";
  detail?: string;
}

export interface MusicImportedFilesRequest {
  providerReleaseId: string;
}

export interface MusicProviderCleanupRequest {
  resource: MusicProviderResourceContext;
  restorePriorMonitoringState: boolean;
}

export interface MusicProviderCleanupResult {
  cleaned: boolean;
}

export interface MusicAcquisitionProvider {
  readonly provider: string;
  healthCheck(): Promise<MusicProviderHealth>;
  lookupReleases(input: MusicProviderReleaseLookup): Promise<NormalizedProviderRelease[]>;
  ensureRelease(input: EnsureMusicProviderRelease): Promise<EnsuredMusicProviderRelease>;
  startAcquisition(input: StartMusicAcquisition): Promise<StartedMusicAcquisition>;
  getAcquisitionStatus(input: MusicAcquisitionStatusRequest): Promise<MusicAcquisitionStatus>;
  listImportedFiles(input: MusicImportedFilesRequest): Promise<NormalizedProviderFile[]>;
  cleanup(input: MusicProviderCleanupRequest): Promise<MusicProviderCleanupResult>;
}
