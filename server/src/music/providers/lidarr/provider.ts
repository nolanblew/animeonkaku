import { z } from "zod";
import type { UpstreamHttp } from "../../../http/upstream.js";
import type {
  EnsureMusicProviderRelease,
  EnsuredMusicProviderRelease,
  MusicAcquisitionProvider,
  MusicAcquisitionStatus,
  MusicAcquisitionStatusRequest,
  MusicImportedFilesRequest,
  MusicProviderCleanupRequest,
  MusicProviderCleanupResult,
  MusicProviderHealth,
  MusicProviderReleaseLookup,
  NormalizedProviderFile,
  NormalizedProviderRelease,
  StartMusicAcquisition,
  StartedMusicAcquisition,
} from "../../types.js";
import {
  LidarrProviderError,
  malformedResponse,
  networkError,
  responseError,
} from "./errors.js";
import { mapLidarrPath, type LidarrPathMapping } from "./pathMapping.js";
import {
  lidarrAlbumSchema,
  lidarrAlbumsSchema,
  lidarrArtistSchema,
  lidarrCommandSchema,
  lidarrHistorySchema,
  lidarrQueueSchema,
  lidarrSystemStatusSchema,
  lidarrTrackFilesSchema,
  lidarrTracksSchema,
  type LidarrAlbum,
  type LidarrTrack,
  type LidarrTrackFile,
} from "./schemas.js";

export interface LidarrProviderOptions extends LidarrPathMapping {
  http: UpstreamHttp;
  baseUrl: string;
  qualityProfileId: number;
  metadataProfileId: number;
  ownershipTagId?: number;
}

export class LidarrMusicAcquisitionProvider implements MusicAcquisitionProvider {
  readonly provider = "LIDARR";
  private readonly baseUrl: string;
  private readonly lookupResources = new Map<string, LidarrAlbum>();

  constructor(private readonly options: LidarrProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async healthCheck(): Promise<MusicProviderHealth> {
    try {
      const status = await this.get("/api/v1/system/status", lidarrSystemStatusSchema);
      return { available: true, detail: `Lidarr ${status.version}` };
    } catch (error) {
      const providerError = networkError(error);
      return { available: false, detail: `${providerError.code}: ${providerError.message}` };
    }
  }

  async lookupReleases(input: MusicProviderReleaseLookup): Promise<NormalizedProviderRelease[]> {
    // Lidarr's explicit lookup syntax accepts a MusicBrainz release-group ID,
    // not an individual release ID.
    const term = input.musicbrainzReleaseGroupId
      ? `lidarr:${input.musicbrainzReleaseGroupId}`
      : input.query.trim();
    if (term.length === 0) return [];
    const albums = await this.get(
      `/api/v1/album/lookup?${new URLSearchParams({ term })}`,
      lidarrAlbumsSchema,
    );
    for (const album of albums) this.lookupResources.set(album.foreignAlbumId, album);
    return albums.map(normalizeRelease);
  }

  async ensureRelease(input: EnsureMusicProviderRelease): Promise<EnsuredMusicProviderRelease> {
    const foreignAlbumId = input.release.providerReleaseId;
    const existing = await this.get(
      `/api/v1/album?${new URLSearchParams({ foreignAlbumId })}`,
      lidarrAlbumsSchema,
    );
    const album = existing.find((candidate) => candidate.foreignAlbumId === foreignAlbumId);
    if (album) {
      if (album.id === undefined || album.id <= 0) {
        throw new LidarrProviderError(
          "MALFORMED_RESPONSE",
          "Existing Lidarr album is missing its numeric id",
          false,
        );
      }
      const monitoringChanged = !album.monitored;
      if (monitoringChanged) {
        await this.send(
          "/api/v1/album/monitor",
          "PUT",
          { albumIds: [album.id], monitored: true },
          lidarrAlbumsSchema,
        );
      }
      return {
        resource: {
          provider: this.provider,
          providerReleaseId: String(album.id),
          providerResourceCreated: false,
          priorProviderMonitoringState: String(album.monitored),
          providerMetadata: {
            lidarrAlbumId: album.id,
            foreignAlbumId,
            adapterOwned: false,
            monitoringChanged,
          },
        },
      };
    }

    let lookupAlbum = this.lookupResources.get(foreignAlbumId);
    if (!lookupAlbum) {
      const lookedUp = await this.get(
        `/api/v1/album/lookup?${new URLSearchParams({ term: `lidarr:${foreignAlbumId}` })}`,
        lidarrAlbumsSchema,
      );
      lookupAlbum = lookedUp.find((candidate) => candidate.foreignAlbumId === foreignAlbumId);
    }
    if (!lookupAlbum) {
      throw new LidarrProviderError(
        "INVALID_RESOURCE",
        "Lidarr lookup resource is unavailable for the selected album",
        false,
      );
    }
    const artistAlreadyExists = lookupAlbum.artist.id > 0;
    const artist = artistAlreadyExists
      ? lookupAlbum.artist
      : {
          ...lookupAlbum.artist,
          monitored: true,
          monitorNewItems: "none" as const,
          qualityProfileId: this.options.qualityProfileId,
          metadataProfileId: this.options.metadataProfileId,
          rootFolderPath: this.options.rootFolderPath,
          tags: this.options.ownershipTagId === undefined ? [] : [this.options.ownershipTagId],
          addOptions: { monitor: "none", searchForMissingAlbums: false },
        };
    const added = await this.send(
      "/api/v1/album",
      "POST",
      {
        ...lookupAlbum,
        monitored: true,
        artist,
        addOptions: { searchForNewAlbum: false },
      },
      lidarrAlbumSchema,
    );
    if (added.id === undefined || added.id <= 0) {
      throw new LidarrProviderError(
        "MALFORMED_RESPONSE",
        "Added Lidarr album is missing its numeric id",
        false,
      );
    }
    return {
      resource: {
        provider: this.provider,
        providerReleaseId: String(added.id),
        providerResourceCreated: true,
        providerMetadata: {
          lidarrAlbumId: added.id,
          foreignAlbumId,
          adapterOwned: true,
          monitoringChanged: false,
          artistCreated: !artistAlreadyExists,
          ...(!artistAlreadyExists && added.artist.id > 0
            ? {
                createdArtistId: added.artist.id,
                createdArtistForeignId: added.artist.foreignArtistId,
                ...(this.options.ownershipTagId === undefined
                  ? {}
                  : { ownershipTagId: this.options.ownershipTagId }),
              }
            : {}),
        },
      },
    };
  }

  async startAcquisition(input: StartMusicAcquisition): Promise<StartedMusicAcquisition> {
    const albumId = parsePositiveId(input.providerReleaseId, "provider release");
    const command = await this.send(
      "/api/v1/command",
      "POST",
      { name: "AlbumSearch", albumIds: [albumId] },
      lidarrCommandSchema,
    );
    return { providerJobId: String(command.id) };
  }

  async getAcquisitionStatus(
    input: MusicAcquisitionStatusRequest,
  ): Promise<MusicAcquisitionStatus> {
    const commandId = parsePositiveId(input.providerJobId, "provider job");
    const command = await this.get(`/api/v1/command/${commandId}`, lidarrCommandSchema);
    const status = command.status?.toLowerCase();
    if (status === "queued") return { state: "QUEUED" };
    if (status === "started" || status === "running") return { state: "RUNNING" };
    if (
      status === "failed" ||
      status === "aborted" ||
      status === "cancelled" ||
      status === "orphaned"
    ) {
      return { state: "FAILED", ...(command.message ? { detail: command.message } : {}) };
    }
    if (status !== "completed") {
      throw new LidarrProviderError(
        "MALFORMED_RESPONSE",
        `Lidarr command has unsupported status ${command.status ?? "missing"}`,
        false,
      );
    }

    const albumId = command.body?.albumIds?.[0];
    if (albumId === undefined) return { state: "COMPLETE" };
    const queue = await this.get(
      `/api/v1/queue/details?${new URLSearchParams({ albumIds: String(albumId) })}`,
      lidarrQueueSchema,
    );
    const queued = queue.records.find((record) => record.albumId === albumId);
    if (queued) {
      const queueState = `${queued.status ?? ""} ${queued.trackedDownloadStatus ?? ""}`.toLowerCase();
      if (/fail|error|warning/.test(queueState)) {
        return {
          state: "FAILED",
          ...(queued.errorMessage ? { detail: queued.errorMessage } : {}),
        };
      }
      return { state: "RUNNING" };
    }

    const history = await this.get(
      `/api/v1/history?${new URLSearchParams({ albumId: String(albumId), page: "1", pageSize: "20", sortKey: "date", sortDirection: "descending" })}`,
      lidarrHistorySchema,
    );
    const imported = history.records.some(
      (record) => record.albumId === albumId && /import/i.test(record.eventType ?? ""),
    );
    return imported
      ? { state: "COMPLETE" }
      : { state: "COMPLETE", detail: "AlbumSearch completed without a queued download" };
  }

  async listImportedFiles(input: MusicImportedFilesRequest): Promise<NormalizedProviderFile[]> {
    const albumId = parsePositiveId(input.providerReleaseId, "provider release");
    const [album, tracks, files] = await Promise.all([
      this.get(`/api/v1/album/${albumId}`, lidarrAlbumSchema),
      this.get(`/api/v1/track?${new URLSearchParams({ albumId: String(albumId) })}`, lidarrTracksSchema),
      this.get(`/api/v1/trackFile?${new URLSearchParams({ albumId: String(albumId) })}`, lidarrTrackFilesSchema),
    ]);
    const tracksByFile = new Map(
      tracks
        .filter((track) => track.trackFileId !== undefined && track.trackFileId > 0)
        .map((track) => [track.trackFileId!, track]),
    );
    return files.flatMap((file) => {
      const track = tracksByFile.get(file.id);
      return track ? [this.normalizeFile(albumId, album, track, file)] : [];
    });
  }

  async cleanup(input: MusicProviderCleanupRequest): Promise<MusicProviderCleanupResult> {
    const resource = input.resource;
    if (resource.provider !== this.provider) {
      return { cleaned: false };
    }
    const albumId = parsePositiveId(resource.providerReleaseId, "provider release");
    if (resource.providerMetadata.lidarrAlbumId !== albumId) return { cleaned: false };

    if (!resource.providerResourceCreated) {
      if (
        !input.restorePriorMonitoringState ||
        resource.providerMetadata.monitoringChanged !== true ||
        resource.priorProviderMonitoringState === undefined
      ) {
        return { cleaned: false };
      }
      const monitored = resource.priorProviderMonitoringState === "true";
      const album = await this.get(`/api/v1/album/${albumId}`, lidarrAlbumSchema);
      if (album.foreignAlbumId !== resource.providerMetadata.foreignAlbumId) {
        return { cleaned: false };
      }
      await this.send(
        "/api/v1/album/monitor",
        "PUT",
        { albumIds: [albumId], monitored },
        lidarrAlbumsSchema,
      );
      return { cleaned: true };
    }

    if (resource.providerMetadata.adapterOwned !== true) return { cleaned: false };
    const album = await this.get(`/api/v1/album/${albumId}`, lidarrAlbumSchema);
    if (album.foreignAlbumId !== resource.providerMetadata.foreignAlbumId) return { cleaned: false };
    const cleanupArtist = await this.canCleanupCreatedArtist(resource, albumId);
    await this.request(
      `/api/v1/album/${albumId}?${new URLSearchParams({ deleteFiles: "false", addImportListExclusion: "false" })}`,
      { method: "DELETE" },
    );
    if (cleanupArtist !== undefined) {
      await this.request(
        `/api/v1/artist/${cleanupArtist}?${new URLSearchParams({ deleteFiles: "false", addImportListExclusion: "false" })}`,
        { method: "DELETE" },
      );
    }
    return { cleaned: true };
  }

  private async canCleanupCreatedArtist(
    resource: MusicProviderCleanupRequest["resource"],
    albumId: number,
  ): Promise<number | undefined> {
    if (
      resource.providerMetadata.artistCreated !== true ||
      this.options.ownershipTagId === undefined ||
      resource.providerMetadata.ownershipTagId !== this.options.ownershipTagId
    ) {
      return undefined;
    }
    const artistId = metadataPositiveId(resource.providerMetadata.createdArtistId);
    if (artistId === undefined) return undefined;
    const artist = await this.get(`/api/v1/artist/${artistId}`, lidarrArtistSchema);
    if (
      artist.id !== artistId ||
      artist.foreignArtistId !== resource.providerMetadata.createdArtistForeignId ||
      !artist.tags?.includes(this.options.ownershipTagId)
    ) {
      return undefined;
    }
    const albums = await this.get(
      `/api/v1/album?${new URLSearchParams({ artistId: String(artistId) })}`,
      lidarrAlbumsSchema,
    );
    const ownedForeignId = resource.providerMetadata.foreignAlbumId;
    const onlyOwnedAlbum = albums.length === 1 &&
      albums[0]?.id === albumId &&
      albums[0]?.foreignAlbumId === ownedForeignId;
    return onlyOwnedAlbum ? artistId : undefined;
  }

  private normalizeFile(
    albumId: number,
    album: LidarrAlbum,
    track: LidarrTrack,
    file: LidarrTrackFile,
  ): NormalizedProviderFile {
    const artist = artistName(album.artist);
    const duration = durationSeconds(track.duration);
    const mime = contentType(file.path);
    return {
      provider: this.provider,
      providerFileId: String(file.id),
      providerReleaseId: String(albumId),
      providerTrackId: track.foreignTrackId ?? String(track.id),
      sourcePath: file.path,
      readablePath: mapLidarrPath(file.path, this.options),
      title: track.title,
      normalizedTitle: normalizeText(track.title),
      artistCredit: artist,
      normalizedArtist: normalizeText(artist),
      ...(duration === undefined ? {} : { durationSeconds: duration }),
      ...(file.size === undefined ? {} : { sizeBytes: file.size }),
      ...(mime === undefined ? {} : { contentType: mime }),
      ...(track.foreignRecordingId
        ? { musicbrainzRecordingId: track.foreignRecordingId }
        : {}),
    };
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.send(path, "GET", undefined, schema);
  }

  private async send<T>(
    path: string,
    method: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await this.request(path, {
      method,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new LidarrProviderError(
        "MALFORMED_RESPONSE",
        `Lidarr returned invalid JSON for ${path.split("?")[0]}`,
        false,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw malformedResponse(path.split("?")[0]!, parsed.error);
    return parsed.data;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      const response = await this.options.http.request(`${this.baseUrl}${path}`, init);
      if (!response.ok) throw responseError(response.status);
      return response;
    } catch (error) {
      throw networkError(error);
    }
  }
}

function normalizeRelease(album: LidarrAlbum): NormalizedProviderRelease {
  const artist = artistName(album.artist);
  const artwork = album.images.find((image) => /cover/i.test(image.coverType ?? ""));
  const artworkUrl = artwork?.remoteUrl ?? artwork?.url;
  return {
    provider: "LIDARR",
    providerReleaseId: album.foreignAlbumId,
    musicbrainzReleaseGroupId: album.foreignAlbumId,
    title: album.title,
    normalizedTitle: normalizeText(album.title),
    artistCredit: artist,
    normalizedArtist: normalizeText(artist),
    ...(album.releaseDate ? { releaseDate: album.releaseDate } : {}),
    ...(artworkUrl ? { artworkUrl } : {}),
    tracks: [],
  };
}

function artistName(artist: LidarrAlbum["artist"]): string {
  return artist.artistName;
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function parsePositiveId(value: string, description: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new LidarrProviderError(
      "INVALID_RESOURCE",
      `Invalid Lidarr ${description} id`,
      false,
    );
  }
  return Number(value);
}

function metadataPositiveId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function durationSeconds(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value >= 1000 ? Math.round(value / 1000) : Math.round(value);
}

function contentType(path: string): string | undefined {
  const extension = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension === "flac"
    ? "audio/flac"
    : extension === "mp3"
      ? "audio/mpeg"
      : extension === "m4a"
        ? "audio/mp4"
        : extension === "ogg" || extension === "opus"
          ? "audio/ogg"
          : undefined;
}
