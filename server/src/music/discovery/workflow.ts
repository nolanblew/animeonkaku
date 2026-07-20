import type pg from "pg";
import type { JobQueue } from "../../jobs/jobQueue.js";
import type { JobRecord } from "../../jobs/types.js";
import type {
  MusicAcquisitionProvider,
  MusicCatalogResolver,
  MusicCatalogResolution,
  MusicCatalogTarget,
  MusicCatalogTargetKind,
  MusicProviderResourceContext,
  NormalizedProviderRelease,
  NormalizedProviderTrack,
} from "../types.js";
import { mergeMusicCandidates } from "../matching/candidates.js";
import { importMusicAudioDedupeKey, reconcileMusicAcquisitionDedupeKey } from "./keys.js";
import type { DiscoveryCompletion, MusicDiscoveryWorkflow as MusicDiscoveryWorkflowContract } from "./types.js";

export interface DiscoveryTargetRecord {
  target: MusicCatalogTarget;
  themeId?: number;
  excludedProviderReleaseIds?: string[];
}

export interface PersistedDiscoveryResolution {
  acquisitionId?: number;
  /** A durable provider job already exists, so retry/restart must never start a second command. */
  alreadyStarted: boolean;
}

export interface DiscoveryAcquisitionRecord {
  id: number;
  providerJobId: string | null;
  providerReleaseId: string | null;
  state: "REQUESTED" | "ACQUIRING" | "IMPORTING" | "READY" | "FAILED" | "AMBIGUOUS";
}

/**
 * The workflow is deliberately separated from the state scheduler repository:
 * this boundary contains catalog evidence and durable provider ownership, while
 * the scheduler only decides when an anime is eligible to be revisited.
 */
export interface DiscoveryCatalogRepository {
  loadTargets(animeId: number): Promise<DiscoveryTargetRecord[]>;
  persistResolution(input: {
    animeId: number;
    purpose: MusicCatalogTargetKind;
    themeId?: number;
    resolution: MusicCatalogResolution;
    resource?: MusicProviderResourceContext;
  }): Promise<PersistedDiscoveryResolution | undefined>;
  markAcquisitionStarted(acquisitionId: number, providerJobId: string): Promise<void>;
  getAcquisition(acquisitionId: number): Promise<DiscoveryAcquisitionRecord | null>;
  markAcquisitionImporting(acquisitionId: number): Promise<void>;
  markAcquisitionFailed(acquisitionId: number, error: string): Promise<void>;
  listRecoverableAcquisitionIds(): Promise<number[]>;
}

export class MusicDiscoveryWorkflowService implements MusicDiscoveryWorkflowContract {
  constructor(private readonly input: {
    catalog: DiscoveryCatalogRepository;
    provider: MusicAcquisitionProvider;
    resolver: MusicCatalogResolver;
    queue: JobQueue;
  }) {}

  async discoverAnime(input: { animeId: number; job: JobRecord }): Promise<DiscoveryCompletion> {
    const health = await this.input.provider.healthCheck();
    if (!health.available) throw new Error(`Music provider unavailable${health.detail ? `: ${health.detail}` : ""}`);

    const targets = await this.input.catalog.loadTargets(input.animeId);
    let missingFullCount = 0;
    let ambiguous = false;
    for (const targetRecord of targets) {
      const { resolution, resource } = await this.resolveTarget(targetRecord.target, targetRecord.excludedProviderReleaseIds);
      if (targetRecord.target.kind === "FULL_SIZE" && resolution.outcome !== "ACCEPTED") missingFullCount++;
      if (resolution.outcome === "AMBIGUOUS") ambiguous = true;

      // Ambiguity/rejection is durable operator evidence, not an operational
      // error. It must not consume job attempts or create a provider command.
      if (resolution.outcome !== "ACCEPTED") {
        await this.input.catalog.persistResolution({ animeId: input.animeId, purpose: targetRecord.target.kind, ...(targetRecord.themeId === undefined ? {} : { themeId: targetRecord.themeId }), resolution, ...(resource ? { resource } : {}) });
        continue;
      }

      if (!resource) throw new Error("Accepted music resolution is missing ensured provider ownership");

      // The provider resource is persisted before any external command. This
      // makes a crash/retry observable and gives later cleanup ownership data.
      const persisted = await this.input.catalog.persistResolution({
        animeId: input.animeId, purpose: targetRecord.target.kind, ...(targetRecord.themeId === undefined ? {} : { themeId: targetRecord.themeId }), resolution, resource,
      });
      if (!persisted?.acquisitionId || persisted.alreadyStarted) continue;

      const started = await this.input.provider.startAcquisition({ providerReleaseId: resource!.providerReleaseId });
      // Persist command ownership before queueing reconcile work. A retry after
      // this point sees alreadyStarted and cannot submit a duplicate command.
      await this.input.catalog.markAcquisitionStarted(persisted.acquisitionId, started.providerJobId);
      await this.input.queue.enqueue({
        type: "RECONCILE_MUSIC_ACQUISITION",
        priority: 30,
        payload: { acquisitionId: persisted.acquisitionId },
        dedupeKey: reconcileMusicAcquisitionDedupeKey(persisted.acquisitionId),
      });
    }
    return { missingFullCount, ambiguous };
  }

  async reconcileAcquisition(input: { acquisitionId: number; job: JobRecord }): Promise<"PENDING" | "COMPLETE"> {
    const acquisition = await this.input.catalog.getAcquisition(input.acquisitionId);
    if (!acquisition) return "COMPLETE";
    if (acquisition.state === "READY" || acquisition.state === "AMBIGUOUS") return "COMPLETE";
    if (acquisition.state === "IMPORTING") {
      await this.enqueueImport(acquisition.id);
      return "COMPLETE";
    }
    // A restart can recover a resource-persisted row before the external start
    // call returned. Leave it durable for an operator/retry; never invent a
    // second provider command without a provider-side idempotency key.
    if (!acquisition.providerJobId) {
      if (!acquisition.providerReleaseId) {
        const error = "Acquisition is missing durable provider release ownership";
        await this.input.catalog.markAcquisitionFailed(acquisition.id, error);
        throw new Error(error);
      }
      // Repairs a crash between resource persistence and command-id write. The
      // Lidarr adapter first reuses an active identical AlbumSearch command.
      const started = await this.input.provider.startAcquisition({ providerReleaseId: acquisition.providerReleaseId, recovery: true });
      await this.input.catalog.markAcquisitionStarted(acquisition.id, started.providerJobId);
      return "PENDING";
    }
    const status = await this.input.provider.getAcquisitionStatus({ providerJobId: acquisition.providerJobId });
      if (status.state === "QUEUED" || status.state === "RUNNING") return "PENDING";
    if (status.state === "FAILED") {
      const detail = status.detail ?? "Music provider acquisition failed";
      await this.input.catalog.markAcquisitionFailed(acquisition.id, detail);
      throw new Error(detail);
    }
    await this.input.catalog.markAcquisitionImporting(acquisition.id);
    await this.enqueueImport(acquisition.id);
    return "COMPLETE";
  }

  private async enqueueImport(acquisitionId: number): Promise<void> {
    await this.input.queue.enqueue({
      type: "IMPORT_MUSIC_AUDIO", priority: 30, payload: { acquisitionId },
      dedupeKey: importMusicAudioDedupeKey(acquisitionId),
    });
  }

  private async resolveTarget(target: MusicCatalogTarget, excludedProviderReleaseIds: string[] = []): Promise<{ resolution: MusicCatalogResolution; resource?: MusicProviderResourceContext }> {
    const lookedUp: NormalizedProviderRelease[] = [];
    // Do not use Promise.all: upstream background lanes are intentionally
    // budgeted and the query matrix must not stampede the provider.
    for (const query of this.input.resolver.buildQueries(target)) {
      lookedUp.push(...await this.input.provider.lookupReleases({ query: query.text }));
    }
    const excluded = new Set(excludedProviderReleaseIds);
    const candidates = mergeMusicCandidates(lookedUp).filter((release) => !excluded.has(candidateKey(release)));
    // First pass is deliberately side-effect-free. Related releases can be
    // accepted from release-level evidence; Full Size requires a unique
    // provisional release before asking the provider for its track list.
    const preliminary = this.input.resolver.resolve({ target, candidates });
    // A Full Size lookup has no tracks yet, so it cannot be accepted in this
    // pass. Enrich only one deterministic candidate; multiple hits remain
    // operator evidence instead of mutating every plausible provider album.
    const selected = preliminary.outcome === "ACCEPTED"
      ? preliminary.release
      : target.kind === "FULL_SIZE" && preliminary.outcome === "REJECTED" && candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!selected) {
      if (target.kind === "FULL_SIZE" && candidates.length > 1) {
        const reasons = ["INSUFFICIENT_MARGIN"] as const;
        return { resolution: { outcome: "AMBIGUOUS", confidence: 0, evidence: { signals: [], reasons: [...reasons] }, reasons: [...reasons], release: candidates[0]! } };
      }
      return { resolution: preliminary };
    }

    const ensured = await this.input.provider.ensureRelease({ release: selected });
    const tracks = await this.input.provider.listReleaseTracks({ providerReleaseId: ensured.resource.providerReleaseId });
    // Re-resolve only the selected release after the GET-only enrichment. The
    // first pass prevented provider mutation for ambiguous candidate sets.
    const resolution = this.input.resolver.resolve({ target, candidates: [{ ...selected, tracks }] });
    return { resolution, resource: ensured.resource };
  }
}

/** PostgreSQL implementation used by the runtime; raw SQL keeps the discovery
 * transaction compact and lets every idempotency predicate lock the same row. */
export class PgDiscoveryCatalogRepository implements DiscoveryCatalogRepository {
  constructor(private readonly pool: pg.Pool) {}

  async loadTargets(animeId: number): Promise<DiscoveryTargetRecord[]> {
    const result = await this.pool.query<{
      theme_id: number | string; title: string; duration_seconds: number | null; artists: string[] | null;
      song_id: number | string | null; animethemes_song_id: number | string | null; recording_id: string | null;
      anime_titles: string[] | null; season_titles: string[] | null; related_release_ids: string[] | null; has_ready_full: boolean;
    }>(`
      SELECT t.id AS theme_id, t.title, t.duration_seconds,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT ta.artist_name), NULL) AS artists,
        MIN(s.id) AS song_id, MIN(s.animethemes_song_id) AS animethemes_song_id,
        MIN(s.musicbrainz_recording_id) AS recording_id,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT title_alias.value), NULL) AS anime_titles,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT season_alias.value), NULL) AS season_titles,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT (mr.provider || ':' || mr.provider_release_id)), NULL) AS related_release_ids,
        BOOL_OR(full_media.id IS NOT NULL) AS has_ready_full
      FROM themes t
      JOIN animethemes_anime aa ON aa.id=t.animethemes_anime_id
      LEFT JOIN theme_artists ta ON ta.theme_id=t.id
      LEFT JOIN songs s ON s.animethemes_song_id=t.animethemes_song_id AND s.deleted_at IS NULL
      LEFT JOIN theme_full_songs tfs ON tfs.theme_id=t.id
      LEFT JOIN media_files full_media ON full_media.kind='AUDIO' AND full_media.variant='ORIGINAL'
        AND full_media.state='READY' AND full_media.ref_id=('song:' || tfs.song_id::text)
      LEFT JOIN anime_music_releases amr ON amr.animethemes_anime_id=aa.id
      LEFT JOIN music_releases mr ON mr.id=amr.release_id AND mr.deleted_at IS NULL
      LEFT JOIN LATERAL unnest(ARRAY[aa.name, aa.name_en]) AS title_alias(value) ON TRUE
      LEFT JOIN kitsu_anime ka ON ka.animethemes_anime_id=aa.id AND ka.deleted_at IS NULL
      LEFT JOIN LATERAL unnest(ARRAY[ka.title, ka.title_en, ka.title_romaji, ka.title_ja]) AS season_alias(value) ON TRUE
      WHERE t.animethemes_anime_id=$1 AND t.deleted_at IS NULL
      GROUP BY t.id, t.title, t.duration_seconds
      ORDER BY t.id
    `, [animeId]);
    // Pre-MC-S07 theme rows have no durable AnimeThemes song association.
    // Startup bootstrap must wait for the normal mapping refresh to backfill
    // that identity rather than guessing from a title-only join.
    const fullTargets = result.rows.filter((row) => !row.has_ready_full && row.animethemes_song_id !== null).map((row) => ({
      themeId: Number(row.theme_id),
      target: {
        kind: "FULL_SIZE" as const, animeThemesAnimeId: animeId,
        animeTitles: [...new Set([...(row.anime_titles ?? []), ...(row.season_titles ?? [])].filter((value) => value.trim().length > 0))],
        seasonSpecificTitles: [...new Set((row.season_titles ?? []).filter((value) => value.trim().length > 0))],
        ...(row.animethemes_song_id === null ? {} : { animeThemesSongId: Number(row.animethemes_song_id) }),
        ...(row.recording_id === null ? {} : { musicbrainzRecordingId: row.recording_id }),
        title: row.title,
        ...((row.artists ?? []).join(", ") ? { artist: (row.artists ?? []).join(", ") } : {}),
        ...(row.duration_seconds === null ? {} : { durationSeconds: row.duration_seconds }),
      },
    }));
    const first = result.rows[0];
    if (!first) return fullTargets;
    if (result.rows.every((row) => row.animethemes_song_id === null)) return [];
    const animeTitles = [...new Set([...(first.anime_titles ?? []), ...(first.season_titles ?? [])].filter((value) => value.trim().length > 0))];
    return [
      ...fullTargets,
      {
        target: {
          kind: "RELATED_RELEASE" as const,
          animeThemesAnimeId: animeId,
          animeTitles,
          seasonSpecificTitles: [...new Set((first.season_titles ?? []).filter((value) => value.trim().length > 0))],
        },
        excludedProviderReleaseIds: first.related_release_ids ?? [],
      },
    ];
  }

  async persistResolution(input: {
    animeId: number; purpose: MusicCatalogTargetKind; themeId?: number; resolution: MusicCatalogResolution; resource?: MusicProviderResourceContext;
  }): Promise<PersistedDiscoveryResolution | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.resolution.outcome === "ACCEPTED" && input.resolution.intent && input.resource) {
        const lockKey = `${input.resource.provider}:${input.animeId}:${input.resolution.intent.kind}:${input.resolution.release!.providerReleaseId}:${input.resolution.intent.kind === "FULL_SIZE" ? input.resolution.intent.animeThemesSongId ?? input.resolution.intent.song.providerTrackId : "release"}`;
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
      }
      if (input.resolution.outcome !== "ACCEPTED" || !input.resolution.intent) {
        if (input.resolution.outcome === "AMBIGUOUS" || input.resource) {
          const state = input.resolution.outcome === "AMBIGUOUS" ? "AMBIGUOUS" : "FAILED";
          const provider = input.resource?.provider ?? input.resolution.release?.provider ?? "catalog";
          const providerReleaseId = input.resource?.providerReleaseId ?? input.resolution.release?.providerReleaseId ?? null;
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`ambiguity:${provider}:${providerReleaseId ?? "none"}:${input.animeId}:${input.purpose}:${input.themeId ?? "none"}`]);
          const evidence = JSON.stringify({ evidence: input.resolution.evidence, candidate: input.resolution.release ? { provider: input.resolution.release.provider, providerReleaseId: input.resolution.release.providerReleaseId } : undefined, ...(input.resource?.providerMetadata ?? {}) });
          const existing = await client.query<{ id: number | string }>(`SELECT id FROM music_acquisitions WHERE provider=$1 AND provider_release_id IS NOT DISTINCT FROM $2
            AND animethemes_anime_id=$3 AND purpose=$4 AND theme_id IS NOT DISTINCT FROM $5 AND state=$6 ORDER BY id LIMIT 1 FOR UPDATE`, [provider, providerReleaseId, input.animeId, input.purpose, input.themeId ?? null, state]);
          if (existing.rows[0]) await client.query(`UPDATE music_acquisitions SET error_message=$2,provider_metadata=$3::jsonb,updated_at=now() WHERE id=$1`, [existing.rows[0].id, input.resolution.reasons.join(","), evidence]);
          else await client.query(`INSERT INTO music_acquisitions (provider,provider_release_id,animethemes_anime_id,purpose,theme_id,state,error_message,provider_resource_created,prior_provider_monitoring_state,provider_metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [provider, providerReleaseId, input.animeId, input.purpose,
            input.themeId ?? null, state, input.resolution.reasons.join(","), input.resource?.providerResourceCreated ?? false,
            input.resource?.priorProviderMonitoringState ?? null, evidence]);
        }
        await client.query("COMMIT");
        return undefined;
      }
      const release = input.resolution.release!;
      const releaseType = input.resolution.intent.kind === "RELATED_RELEASE" ? input.resolution.intent.releaseType : "THEME";
      const releaseRow = await client.query<{ id: number | string }>(`INSERT INTO music_releases
        (provider, provider_release_id, title, normalized_title, artist_credit, release_type, release_date, artwork_url, deleted_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,now())
        ON CONFLICT (provider,provider_release_id) DO UPDATE SET title=EXCLUDED.title, normalized_title=EXCLUDED.normalized_title,
          artist_credit=EXCLUDED.artist_credit, release_type=EXCLUDED.release_type, release_date=EXCLUDED.release_date,
          artwork_url=EXCLUDED.artwork_url, deleted_at=NULL, updated_at=now() RETURNING id`,
        [release.provider, release.providerReleaseId, release.title, release.normalizedTitle, release.artistCredit, releaseType, release.releaseDate ?? null, release.artworkUrl ?? null]);
      const releaseId = Number(releaseRow.rows[0]!.id);
      const tracks = input.resolution.intent.kind === "FULL_SIZE" ? [input.resolution.intent.song] : input.resolution.intent.songs;
      const songIds = new Map<string, number>();
      for (const [index, track] of tracks.entries()) {
        const songId = await upsertSong(client, track, input.resolution.intent.kind === "FULL_SIZE" ? input.resolution.intent.animeThemesSongId : undefined);
        songIds.set(track.providerTrackId, songId);
        await client.query(`INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (release_id,display_order) DO UPDATE SET song_id=EXCLUDED.song_id,
          disc_number=EXCLUDED.disc_number,track_number=EXCLUDED.track_number`, [releaseId, songId, track.discNumber, track.trackNumber ?? null, index]);
      }
      let purpose: "FULL_SIZE" | "RELATED_RELEASE";
      let songId: number | null = null;
      if (input.resolution.intent.kind === "FULL_SIZE") {
        purpose = "FULL_SIZE";
        songId = songIds.get(input.resolution.intent.song.providerTrackId)!;
      } else {
        purpose = "RELATED_RELEASE";
      }
      const acceptedTracks = tracks.map((track) => ({
        songId: songIds.get(track.providerTrackId)!, providerTrackId: track.providerTrackId,
        ...(track.musicbrainzRecordingId ? { musicbrainzRecordingId: track.musicbrainzRecordingId } : {}),
        normalizedTitle: track.normalizedTitle, normalizedArtist: track.normalizedArtist,
        ...(track.durationSeconds === undefined ? {} : { durationSeconds: track.durationSeconds }),
      }));
      const providerMetadata = {
        ...input.resource!.providerMetadata,
        catalogIntent: { tracks: acceptedTracks, confidence: input.resolution.confidence,
          evidence: input.resolution.evidence,
          ...(input.resolution.intent.kind === "RELATED_RELEASE" ? { releaseType: input.resolution.intent.releaseType } : {}) },
      };
      // Intent-level locking is essential because provider_job_id is null before
      // start. Lock/use the tuple that identifies one acquisition purpose.
      const intentIdentity = `${input.resource!.provider}:${input.animeId}:${purpose}:${releaseId}:${songId ?? "release"}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [intentIdentity]);
      const existing = await client.query<{ id: number | string; provider_job_id: string | null }>(`SELECT id,provider_job_id FROM music_acquisitions
        WHERE provider=$1 AND animethemes_anime_id=$2 AND purpose=$3 AND release_id=$4
          AND ($3 <> 'FULL_SIZE' OR song_id IS NOT DISTINCT FROM $5)
          AND state IN ('REQUESTED','ACQUIRING','IMPORTING','READY') ORDER BY id LIMIT 1 FOR UPDATE`,
        [input.resource!.provider, input.animeId, purpose, releaseId, songId]);
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { acquisitionId: Number(existing.rows[0].id), alreadyStarted: existing.rows[0].provider_job_id !== null };
      }
      const inserted = await client.query<{ id: number | string }>(`INSERT INTO music_acquisitions
        (provider,provider_release_id,animethemes_anime_id,purpose,theme_id,song_id,release_id,state,provider_resource_created,prior_provider_monitoring_state,provider_metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'REQUESTED',$8,$9,$10::jsonb) RETURNING id`,
        [input.resource!.provider, input.resource!.providerReleaseId, input.animeId, purpose, input.themeId ?? null, songId, releaseId,
          input.resource!.providerResourceCreated, input.resource!.priorProviderMonitoringState ?? null, JSON.stringify(providerMetadata)]);
      await client.query("COMMIT");
      return { acquisitionId: Number(inserted.rows[0]!.id), alreadyStarted: false };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async markAcquisitionStarted(acquisitionId: number, providerJobId: string): Promise<void> {
    const result = await this.pool.query(`UPDATE music_acquisitions SET provider_job_id=$2,state='ACQUIRING',error_message=NULL,updated_at=now()
      WHERE id=$1 AND provider_job_id IS NULL`, [acquisitionId, providerJobId]);
    if (result.rowCount !== 1) throw new Error(`Acquisition ${acquisitionId} was already started or is missing`);
  }
  async getAcquisition(acquisitionId: number): Promise<DiscoveryAcquisitionRecord | null> {
    const result = await this.pool.query<DiscoveryAcquisitionRecord>(`SELECT id,provider_job_id AS "providerJobId",provider_release_id AS "providerReleaseId",state
      FROM music_acquisitions WHERE id=$1`, [acquisitionId]);
    return result.rows[0] ?? null;
  }
  async markAcquisitionImporting(acquisitionId: number): Promise<void> {
    await this.pool.query(`UPDATE music_acquisitions SET state='IMPORTING',completed_at=NULL,error_message=NULL,updated_at=now() WHERE id=$1`, [acquisitionId]);
  }
  async markAcquisitionFailed(acquisitionId: number, error: string): Promise<void> {
    await this.pool.query(`UPDATE music_acquisitions SET state='FAILED',error_message=$2,updated_at=now() WHERE id=$1`, [acquisitionId, error]);
  }
  async listRecoverableAcquisitionIds(): Promise<number[]> {
    const result = await this.pool.query<{ id: number | string }>(`SELECT id FROM music_acquisitions
      WHERE state IN ('REQUESTED','ACQUIRING') ORDER BY id`);
    return result.rows.map((row) => Number(row.id));
  }
  async listRecoverableImportIds(): Promise<number[]> {
    const result = await this.pool.query<{ id: number | string }>(`SELECT id FROM music_acquisitions
      WHERE state='IMPORTING' OR (state='READY' AND (provider_metadata->>'cleanupComplete') IS DISTINCT FROM 'true') ORDER BY id`);
    return result.rows.map((row) => Number(row.id));
  }
}

async function upsertSong(client: pg.PoolClient, track: NormalizedProviderTrack, animeThemesSongId?: number): Promise<number> {
  if (animeThemesSongId !== undefined) {
    const canonical = await client.query<{ id: number | string }>(`SELECT id FROM songs WHERE animethemes_song_id=$1 FOR UPDATE`, [animeThemesSongId]);
    if (canonical.rows[0]) {
      // The AnimeThemes identity remains canonical even when the provider adds
      // a MusicBrainz recording ID later. Do not overwrite a conflicting ID.
      await client.query(`UPDATE songs SET title=$2,normalized_title=$3,artist_credit=$4,normalized_artist=$5,duration_seconds=$6,
        musicbrainz_recording_id=CASE WHEN musicbrainz_recording_id IS NULL AND NOT EXISTS (SELECT 1 FROM songs other WHERE other.musicbrainz_recording_id=$7 AND other.id<>songs.id) THEN $7 ELSE musicbrainz_recording_id END,
        deleted_at=NULL,updated_at=now() WHERE id=$1`, [Number(canonical.rows[0].id), track.title, track.normalizedTitle, track.artistCredit, track.normalizedArtist, track.durationSeconds ?? null, track.musicbrainzRecordingId ?? null]);
      return Number(canonical.rows[0].id);
    }
  }
  if (track.musicbrainzRecordingId) {
    const result = await client.query<{ id: number | string }>(`INSERT INTO songs (musicbrainz_recording_id,title,normalized_title,artist_credit,normalized_artist,duration_seconds,deleted_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NULL,now()) ON CONFLICT (musicbrainz_recording_id) DO UPDATE SET title=EXCLUDED.title,
      normalized_title=EXCLUDED.normalized_title,artist_credit=EXCLUDED.artist_credit,normalized_artist=EXCLUDED.normalized_artist,
      duration_seconds=EXCLUDED.duration_seconds,deleted_at=NULL,updated_at=now() RETURNING id`,
      [track.musicbrainzRecordingId, track.title, track.normalizedTitle, track.artistCredit, track.normalizedArtist, track.durationSeconds ?? null]);
    return Number(result.rows[0]!.id);
  }
  const existing = await client.query<{ id: number | string }>(`SELECT id FROM songs WHERE normalized_title=$1 AND normalized_artist=$2 AND deleted_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE`, [track.normalizedTitle, track.normalizedArtist]);
  if (existing.rows[0]) return Number(existing.rows[0].id);
  const inserted = await client.query<{ id: number | string }>(`INSERT INTO songs (title,normalized_title,artist_credit,normalized_artist,duration_seconds,updated_at)
    VALUES ($1,$2,$3,$4,$5,now()) RETURNING id`, [track.title, track.normalizedTitle, track.artistCredit, track.normalizedArtist, track.durationSeconds ?? null]);
  return Number(inserted.rows[0]!.id);
}

function candidateKey(release: NormalizedProviderRelease): string {
  return `${release.provider.toLowerCase()}:${release.providerReleaseId}`;
}
