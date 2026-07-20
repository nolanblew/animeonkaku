import type {
  EnsureMusicProviderRelease,
  EnsuredMusicProviderRelease,
  MusicAcquisitionProvider,
  MusicAcquisitionStatus,
  MusicAcquisitionStatusRequest,
  MusicImportedFilesRequest,
  MusicProviderReleaseTracksRequest,
  MusicProviderCleanupRequest,
  MusicProviderCleanupResult,
  MusicProviderHealth,
  MusicProviderReleaseLookup,
  NormalizedProviderFile,
  NormalizedProviderRelease,
  NormalizedProviderTrack,
  StartMusicAcquisition,
  StartedMusicAcquisition,
} from "./types.js";

export class MusicProviderDisabledError extends Error {
  constructor() {
    super("Music acquisition provider is disabled");
    this.name = "MusicProviderDisabledError";
  }
}

/** Safe default while catalog acquisition/discovery is switched off. */
export class DisabledMusicAcquisitionProvider implements MusicAcquisitionProvider {
  readonly provider = "disabled";

  async healthCheck(): Promise<MusicProviderHealth> {
    return { available: false, detail: "Music acquisition provider is disabled" };
  }

  async lookupReleases(_input: MusicProviderReleaseLookup): Promise<NormalizedProviderRelease[]> {
    return [];
  }

  async ensureRelease(_input: EnsureMusicProviderRelease): Promise<EnsuredMusicProviderRelease> {
    throw new MusicProviderDisabledError();
  }

  async startAcquisition(_input: StartMusicAcquisition): Promise<StartedMusicAcquisition> {
    throw new MusicProviderDisabledError();
  }

  async getAcquisitionStatus(
    _input: MusicAcquisitionStatusRequest,
  ): Promise<MusicAcquisitionStatus> {
    throw new MusicProviderDisabledError();
  }

  async listImportedFiles(_input: MusicImportedFilesRequest): Promise<NormalizedProviderFile[]> {
    throw new MusicProviderDisabledError();
  }

  async listReleaseTracks(_input: MusicProviderReleaseTracksRequest): Promise<NormalizedProviderTrack[]> {
    throw new MusicProviderDisabledError();
  }

  async cleanup(_input: MusicProviderCleanupRequest): Promise<MusicProviderCleanupResult> {
    throw new MusicProviderDisabledError();
  }
}
