import type pg from "pg";
import type { MediaStore } from "../../media/mediaStore.js";
import type { MusicAcquisitionProvider, MusicProviderResourceContext, NormalizedProviderFile } from "../types.js";

export interface ExpectedImportTrack {
  songId: number;
  providerTrackId: string;
  musicbrainzRecordingId?: string;
  normalizedTitle: string;
  normalizedArtist: string;
  durationSeconds?: number;
}

export interface MusicAcquisitionImportRecord {
  id: number;
  provider: string;
  providerJobId: string | null;
  providerReleaseId: string;
  animeId: number;
  purpose: "FULL_SIZE" | "RELATED_RELEASE";
  themeId: number | null;
  releaseId: number;
  state: "IMPORTING" | "READY" | "FAILED" | "AMBIGUOUS";
  providerResourceCreated: boolean;
  priorProviderMonitoringState: string | null;
  providerMetadata: Record<string, unknown>;
  expectedTracks: ExpectedImportTrack[];
}

export interface MusicAcquisitionImportRepository {
  loadAcquisition(id: number): Promise<MusicAcquisitionImportRecord | null>;
  withSongLocks<T>(songIds: number[], action: () => Promise<T>): Promise<T>;
  publishReady(input: { acquisitionId: number; songIds: number[] }): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
  markAmbiguous(id: number, error: string): Promise<void>;
  hasUnfinishedSharedAcquisitions(acquisition: MusicAcquisitionImportRecord): Promise<boolean>;
  loadReadySharedAcquisition(acquisition: MusicAcquisitionImportRecord): Promise<MusicAcquisitionImportRecord | null>;
  loadAuthoritativeCleanupAcquisition(acquisition: MusicAcquisitionImportRecord): Promise<MusicAcquisitionImportRecord | null>;
  withCleanupLock<T>(acquisition: MusicAcquisitionImportRecord, action: () => Promise<T>): Promise<T>;
  recordCleanupSuccess(id: number): Promise<void>;
  recordCleanupFailure(id: number, error: string): Promise<void>;
}

export class MusicImportValidationError extends Error {
  constructor(message: string, readonly outcome: "FAILED" | "AMBIGUOUS") {
    super(message);
    this.name = "MusicImportValidationError";
  }
}

export class MusicAcquisitionImportService {
  constructor(private readonly input: {
    repo: MusicAcquisitionImportRepository;
    provider: MusicAcquisitionProvider;
    mediaStore: MediaStore;
  }) {}

  async importAcquisition(acquisitionId: number): Promise<void> {
    const acquisition = await this.input.repo.loadAcquisition(acquisitionId);
    if (!acquisition || acquisition.state === "FAILED" || acquisition.state === "AMBIGUOUS") return;
    if (acquisition.state === "READY") {
      await this.cleanupIfLastConsumer(acquisition);
      return;
    }
    if (acquisition.expectedTracks.length === 0) {
      await this.failValidation(acquisition, new MusicImportValidationError("Acquisition has no accepted tracks", "FAILED"));
    }

    try {
      const providerFiles = await this.input.provider.listImportedFiles({ providerReleaseId: acquisition.providerReleaseId });
      const selected = selectValidatedFiles(acquisition, providerFiles);
      const songIds = acquisition.expectedTracks.map((track) => track.songId);
      await this.input.repo.withSongLocks(songIds, async () => {
        for (const match of selected) {
          // readablePath is the adapter-validated/mapped server path. The raw
          // provider path must never cross the media-store trust boundary.
          await this.input.mediaStore.importLocalSongFile({ songId: match.track.songId, sourcePath: match.file.readablePath });
        }
        // The repository verifies every media row is READY and publishes the
        // catalog junctions, timestamps, and acquisition state in one DB tx.
        await this.input.repo.publishReady({ acquisitionId: acquisition.id, songIds });
      });
    } catch (error) {
      if (error instanceof MusicImportValidationError) await this.failValidation(acquisition, error);
      throw error;
    }

    await this.cleanupIfLastConsumer({ ...acquisition, state: "READY" });
  }

  async markOperationalFailed(acquisitionId: number, error: string): Promise<void> {
    const acquisition = await this.input.repo.loadAcquisition(acquisitionId);
    await this.input.repo.markFailed(acquisitionId, error);
    if (!acquisition) return;
    const readyPeer = await this.input.repo.loadReadySharedAcquisition(acquisition);
    if (readyPeer) await this.cleanupIfLastConsumer(readyPeer);
  }

  private async failValidation(acquisition: MusicAcquisitionImportRecord, error: MusicImportValidationError): Promise<never> {
    if (error.outcome === "AMBIGUOUS") await this.input.repo.markAmbiguous(acquisition.id, error.message);
    else await this.input.repo.markFailed(acquisition.id, error.message);
    // If a shared-command sibling already published, this terminal transition
    // makes it the last successful consumer and should release provider state
    // now instead of waiting for a process restart.
    const readyPeer = await this.input.repo.loadReadySharedAcquisition(acquisition);
    if (readyPeer) await this.cleanupIfLastConsumer(readyPeer);
    throw error;
  }

  private async cleanupIfLastConsumer(acquisition: MusicAcquisitionImportRecord): Promise<void> {
    await this.input.repo.withCleanupLock(acquisition, async () => {
      if (await this.input.repo.hasUnfinishedSharedAcquisitions(acquisition)) return;
      const owner = await this.input.repo.loadAuthoritativeCleanupAcquisition(acquisition) ?? acquisition;
      if (owner.providerMetadata.cleanupComplete === true) return;
      const resource: MusicProviderResourceContext = {
        provider: owner.provider,
        providerReleaseId: owner.providerReleaseId,
        providerResourceCreated: owner.providerResourceCreated,
        ...(owner.priorProviderMonitoringState === null ? {} : { priorProviderMonitoringState: owner.priorProviderMonitoringState }),
        providerMetadata: owner.providerMetadata,
      };
      try {
        await this.input.provider.cleanup({ resource, restorePriorMonitoringState: true });
        await this.input.repo.recordCleanupSuccess(owner.id);
      } catch (error) {
        await this.input.repo.recordCleanupFailure(owner.id, error instanceof Error ? error.message : String(error));
      }
    });
  }
}

function selectValidatedFiles(acquisition: MusicAcquisitionImportRecord, files: NormalizedProviderFile[]) {
  const scopedFiles = files.filter((file) => file.provider === acquisition.provider
    && file.providerReleaseId === acquisition.providerReleaseId);
  const used = new Set<string>();
  const selected: Array<{ track: ExpectedImportTrack; file: NormalizedProviderFile }> = [];
  for (const track of acquisition.expectedTracks) {
    const available = scopedFiles.filter((file) => !used.has(file.providerFileId));
    const exactIdentity = available.filter((file) => file.providerTrackId === track.providerTrackId);
    const matches = exactIdentity.length > 0
      ? exactIdentity.filter((file) => !hasRecordingConflict(track, file))
      : available.filter((file) => matchesAcceptedTrack(track, file));
    if (matches.length === 0) {
      throw new MusicImportValidationError(`No validated imported file for accepted track ${track.providerTrackId}`, "FAILED");
    }
    if (matches.length > 1) {
      throw new MusicImportValidationError(`Multiple imported files match accepted track ${track.providerTrackId}`, "AMBIGUOUS");
    }
    used.add(matches[0]!.providerFileId);
    selected.push({ track, file: matches[0]! });
  }
  if (acquisition.purpose === "FULL_SIZE" && selected.length !== 1) {
    throw new MusicImportValidationError("Full Size import must select exactly one file", "AMBIGUOUS");
  }
  return selected;
}

function hasRecordingConflict(track: ExpectedImportTrack, file: NormalizedProviderFile): boolean {
  return Boolean(track.musicbrainzRecordingId && file.musicbrainzRecordingId
    && track.musicbrainzRecordingId !== file.musicbrainzRecordingId);
}

function matchesAcceptedTrack(track: ExpectedImportTrack, file: NormalizedProviderFile): boolean {
  if (track.musicbrainzRecordingId && file.musicbrainzRecordingId) {
    // An explicit conflicting recording identity is never allowed to fall back
    // to fuzzy metadata, even when the displayed fields happen to match.
    return track.musicbrainzRecordingId === file.musicbrainzRecordingId;
  }
  const durationMatches = track.durationSeconds !== undefined && file.durationSeconds !== undefined
    && Math.abs(track.durationSeconds - file.durationSeconds) <= 3;
  return file.normalizedTitle === track.normalizedTitle
    && file.normalizedArtist === track.normalizedArtist
    && durationMatches;
}

export class PgMusicAcquisitionImportRepository implements MusicAcquisitionImportRepository {
  constructor(private readonly pool: pg.Pool) {}

  async loadAcquisition(id: number): Promise<MusicAcquisitionImportRecord | null> {
    const result = await this.pool.query<{
      id: number | string; provider: string; provider_job_id: string | null; provider_release_id: string | null;
      animethemes_anime_id: number | string; purpose: "FULL_SIZE" | "RELATED_RELEASE"; theme_id: number | string | null;
      song_id: number | string | null; release_id: number | string | null; state: MusicAcquisitionImportRecord["state"];
      provider_resource_created: boolean; prior_provider_monitoring_state: string | null; provider_metadata: Record<string, unknown>;
    }>(`SELECT * FROM music_acquisitions WHERE id=$1`, [id]);
    const row = result.rows[0];
    if (!row || !row.provider_release_id || row.release_id === null) return null;
    let metadata = row.provider_metadata;
    let intent = catalogIntent(metadata);
    if (intent.tracks.length === 0) {
      const legacyInput = {
        id: Number(row.id), purpose: row.purpose, themeId: row.theme_id === null ? null : Number(row.theme_id),
        songId: row.song_id === null ? null : Number(row.song_id), releaseId: Number(row.release_id), animeId: Number(row.animethemes_anime_id),
      };
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query<{ provider_metadata: Record<string, unknown> }>(
          "SELECT provider_metadata FROM music_acquisitions WHERE id=$1 FOR UPDATE", [legacyInput.id],
        );
        const lockedMetadata = locked.rows[0]?.provider_metadata ?? metadata;
        intent = catalogIntent(lockedMetadata);
        if (intent.tracks.length === 0) {
          intent = await this.deriveLegacyCatalogIntent(client, legacyInput);
          // MC-S07 published these junctions before media was READY. Remove the
          // premature visibility edge in the same transaction that preserves
          // its evidence; publishReady recreates it only after every file is READY.
          if (legacyInput.purpose === "FULL_SIZE" && legacyInput.themeId !== null) {
            await client.query("DELETE FROM theme_full_songs WHERE theme_id=$1 AND song_id=$2 AND source_release_id=$3",
              [legacyInput.themeId, legacyInput.songId ?? intent.tracks[0]!.songId, legacyInput.releaseId]);
          } else {
            await client.query("DELETE FROM anime_music_releases WHERE animethemes_anime_id=$1 AND release_id=$2", [legacyInput.animeId, legacyInput.releaseId]);
          }
          await client.query(`UPDATE music_acquisitions SET provider_metadata=jsonb_set(provider_metadata,'{catalogIntent}',$2::jsonb,true),updated_at=now()
            WHERE id=$1`, [legacyInput.id, JSON.stringify(intent)]);
          metadata = { ...lockedMetadata, catalogIntent: intent };
        } else {
          metadata = lockedMetadata;
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }
    return {
      id: Number(row.id), provider: row.provider, providerJobId: row.provider_job_id,
      providerReleaseId: row.provider_release_id, animeId: Number(row.animethemes_anime_id), purpose: row.purpose,
      themeId: row.theme_id === null ? null : Number(row.theme_id), releaseId: Number(row.release_id), state: row.state,
      providerResourceCreated: row.provider_resource_created, priorProviderMonitoringState: row.prior_provider_monitoring_state,
      providerMetadata: metadata, expectedTracks: intent.tracks,
    };
  }

  private async deriveLegacyCatalogIntent(client: pg.PoolClient, input: {
    id: number; purpose: "FULL_SIZE" | "RELATED_RELEASE"; themeId: number | null;
    songId: number | null; releaseId: number; animeId: number;
  }): Promise<CatalogIntentData> {
    const result = input.purpose === "FULL_SIZE"
      ? await client.query<LegacyIntentRow>(`SELECT s.id AS song_id,s.musicbrainz_recording_id,s.normalized_title,s.normalized_artist,s.duration_seconds,
          COALESCE(tfs.confidence,0) AS confidence,COALESCE(tfs.evidence,'{}'::jsonb) AS evidence,NULL::text AS release_type
        FROM songs s LEFT JOIN theme_full_songs tfs ON tfs.theme_id=$2 AND tfs.song_id=s.id AND tfs.source_release_id=$3
        WHERE s.id=COALESCE($1::bigint,(SELECT rt.song_id FROM release_tracks rt WHERE rt.release_id=$3 ORDER BY rt.display_order LIMIT 1))`,
        [input.songId, input.themeId, input.releaseId])
      : await client.query<LegacyIntentRow>(`SELECT s.id AS song_id,s.musicbrainz_recording_id,s.normalized_title,s.normalized_artist,s.duration_seconds,
          COALESCE(amr.confidence,0) AS confidence,COALESCE(amr.evidence,'{}'::jsonb) AS evidence,amr.relationship_type AS release_type
        FROM release_tracks rt JOIN songs s ON s.id=rt.song_id
        LEFT JOIN anime_music_releases amr ON amr.animethemes_anime_id=$2 AND amr.release_id=rt.release_id
        WHERE rt.release_id=$1 ORDER BY rt.display_order`, [input.releaseId, input.animeId]);
    if (result.rows.length === 0) throw new Error(`Legacy music acquisition ${input.id} has no recoverable accepted tracks`);
    const first = result.rows[0]!;
    return {
      tracks: result.rows.map((track) => ({
        songId: Number(track.song_id), providerTrackId: `legacy-song:${track.song_id}`,
        ...(track.musicbrainz_recording_id ? { musicbrainzRecordingId: track.musicbrainz_recording_id } : {}),
        normalizedTitle: track.normalized_title, normalizedArtist: track.normalized_artist,
        ...(track.duration_seconds === null ? {} : { durationSeconds: track.duration_seconds }),
      })),
      confidence: Number(first.confidence), evidence: first.evidence ?? {},
      ...(first.release_type ? { releaseType: first.release_type } : {}),
    };
  }

  async withSongLocks<T>(songIds: number[], action: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const keys = [...new Set(songIds)].sort((a, b) => a - b).map((id) => `music-import:song:${id}`);
    try {
      for (const key of keys) await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
      return await action();
    } finally {
      for (const key of keys.reverse()) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]).catch(() => undefined);
      client.release();
    }
  }

  async withCleanupLock<T>(acquisition: MusicAcquisitionImportRecord, action: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const identity = `music-cleanup:${acquisition.provider}:${acquisition.providerReleaseId}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [identity]);
      return await action();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [identity]).catch(() => undefined);
      client.release();
    }
  }

  async publishReady(input: { acquisitionId: number; songIds: number[] }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const acquired = await client.query<{
        id: number | string; purpose: "FULL_SIZE" | "RELATED_RELEASE"; theme_id: number | string | null;
        release_id: number | string; animethemes_anime_id: number | string; provider_metadata: Record<string, unknown>;
      }>("SELECT id,purpose,theme_id,release_id,animethemes_anime_id,provider_metadata FROM music_acquisitions WHERE id=$1 FOR UPDATE", [input.acquisitionId]);
      const row = acquired.rows[0];
      if (!row) throw new Error(`Music acquisition ${input.acquisitionId} is missing`);
      const ready = await client.query<{ count: string }>(`SELECT COUNT(DISTINCT ref_id)::text AS count FROM media_files
        WHERE kind='AUDIO' AND variant='ORIGINAL' AND state='READY' AND ref_id=ANY($1::text[])`, [input.songIds.map((id) => `song:${id}`)]);
      if (Number(ready.rows[0]?.count ?? 0) !== new Set(input.songIds).size) throw new Error("Cannot publish music acquisition before every selected media file is READY");
      const intent = catalogIntent(row.provider_metadata);
      if (row.purpose === "FULL_SIZE") {
        if (row.theme_id === null || input.songIds.length !== 1) throw new Error("Invalid Full Size publication intent");
        await client.query(`INSERT INTO theme_full_songs (theme_id,song_id,source_release_id,confidence,evidence,matched_at,updated_at)
          VALUES ($1,$2,$3,$4,$5::jsonb,now(),now()) ON CONFLICT (theme_id) DO UPDATE SET song_id=EXCLUDED.song_id,
          source_release_id=EXCLUDED.source_release_id,confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,matched_at=now(),updated_at=now()`,
          [row.theme_id, input.songIds[0], row.release_id, intent.confidence, JSON.stringify(intent.evidence)]);
      } else {
        await client.query(`INSERT INTO anime_music_releases (animethemes_anime_id,release_id,relationship_type,confidence,evidence,updated_at)
          VALUES ($1,$2,$3,$4,$5::jsonb,now()) ON CONFLICT (animethemes_anime_id,release_id) DO UPDATE SET relationship_type=EXCLUDED.relationship_type,
          confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,updated_at=now()`,
          [row.animethemes_anime_id, row.release_id, intent.releaseType ?? "OTHER", intent.confidence, JSON.stringify(intent.evidence)]);
      }
      await client.query("UPDATE songs SET updated_at=now() WHERE id=ANY($1::bigint[])", [input.songIds]);
      await client.query("UPDATE music_releases SET updated_at=now() WHERE id=$1", [row.release_id]);
      await client.query("UPDATE themes SET updated_at=now() WHERE animethemes_anime_id=$1", [row.animethemes_anime_id]);
      await client.query("UPDATE music_acquisitions SET state='READY',completed_at=now(),error_message=NULL,updated_at=now() WHERE id=$1", [input.acquisitionId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async markFailed(id: number, error: string): Promise<void> { await this.markTerminal(id, "FAILED", error); }
  async markAmbiguous(id: number, error: string): Promise<void> { await this.markTerminal(id, "AMBIGUOUS", error); }
  private async markTerminal(id: number, state: "FAILED" | "AMBIGUOUS", error: string): Promise<void> {
    await this.pool.query("UPDATE music_acquisitions SET state=$2,error_message=$3,updated_at=now() WHERE id=$1 AND state<>'READY'", [id, state, error]);
  }

  async hasUnfinishedSharedAcquisitions(acquisition: MusicAcquisitionImportRecord): Promise<boolean> {
    const result = await this.pool.query(`SELECT 1 FROM music_acquisitions WHERE id<>$1 AND provider=$2
      AND (($3::text IS NOT NULL AND provider_job_id=$3) OR provider_release_id=$4)
      AND state IN ('REQUESTED','ACQUIRING','IMPORTING') LIMIT 1`,
      [acquisition.id, acquisition.provider, acquisition.providerJobId, acquisition.providerReleaseId]);
    return result.rowCount === 1;
  }

  async loadReadySharedAcquisition(acquisition: MusicAcquisitionImportRecord): Promise<MusicAcquisitionImportRecord | null> {
    const result = await this.pool.query<{ id: number | string }>(`SELECT id FROM music_acquisitions WHERE id<>$1 AND provider=$2
      AND (($3::text IS NOT NULL AND provider_job_id=$3) OR provider_release_id=$4) AND state='READY'
      AND (provider_metadata->>'cleanupComplete') IS DISTINCT FROM 'true' ORDER BY id LIMIT 1`,
      [acquisition.id, acquisition.provider, acquisition.providerJobId, acquisition.providerReleaseId]);
    return result.rows[0] ? this.loadAcquisition(Number(result.rows[0].id)) : null;
  }

  async loadAuthoritativeCleanupAcquisition(acquisition: MusicAcquisitionImportRecord): Promise<MusicAcquisitionImportRecord | null> {
    const result = await this.pool.query<{ id: number | string }>(`SELECT id FROM music_acquisitions WHERE provider=$1
      AND (($2::text IS NOT NULL AND provider_job_id=$2) OR provider_release_id=$3)
      ORDER BY provider_resource_created DESC,
        CASE WHEN provider_metadata->>'monitoringChanged'='true' OR prior_provider_monitoring_state IS NOT NULL THEN 0 ELSE 1 END,
        id LIMIT 1`, [acquisition.provider, acquisition.providerJobId, acquisition.providerReleaseId]);
    return result.rows[0] ? this.loadAcquisition(Number(result.rows[0].id)) : null;
  }

  async recordCleanupSuccess(id: number): Promise<void> {
    await this.pool.query(`UPDATE music_acquisitions target SET provider_metadata=jsonb_set(target.provider_metadata,'{cleanupComplete}','true'::jsonb,true),updated_at=now()
      FROM music_acquisitions source WHERE source.id=$1 AND target.provider=source.provider
        AND ((source.provider_job_id IS NOT NULL AND target.provider_job_id=source.provider_job_id) OR target.provider_release_id=source.provider_release_id)`, [id]);
  }
  async recordCleanupFailure(id: number, error: string): Promise<void> {
    await this.pool.query(`UPDATE music_acquisitions target SET provider_metadata=jsonb_set(target.provider_metadata,'{cleanupError}',to_jsonb($2::text),true),updated_at=now()
      FROM music_acquisitions source WHERE source.id=$1 AND target.provider=source.provider
        AND ((source.provider_job_id IS NOT NULL AND target.provider_job_id=source.provider_job_id) OR target.provider_release_id=source.provider_release_id)`, [id, error]);
  }
}

interface CatalogIntentData { tracks: ExpectedImportTrack[]; confidence: number; evidence: unknown; releaseType?: string }
interface LegacyIntentRow {
  song_id: number | string; musicbrainz_recording_id: string | null; normalized_title: string; normalized_artist: string;
  duration_seconds: number | null; confidence: number | string; evidence: unknown; release_type: string | null;
}

function catalogIntent(metadata: Record<string, unknown>): CatalogIntentData {
  const value = metadata.catalogIntent;
  if (!value || typeof value !== "object") return { tracks: [], confidence: 0, evidence: {} };
  const intent = value as Record<string, unknown>;
  const tracks = Array.isArray(intent.tracks) ? intent.tracks.filter(isExpectedTrack) : [];
  return { tracks, confidence: typeof intent.confidence === "number" ? intent.confidence : 0,
    evidence: intent.evidence ?? {}, ...(typeof intent.releaseType === "string" ? { releaseType: intent.releaseType } : {}) };
}

function isExpectedTrack(value: unknown): value is ExpectedImportTrack {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.songId === "number" && Number.isSafeInteger(row.songId) && typeof row.providerTrackId === "string"
    && typeof row.normalizedTitle === "string" && typeof row.normalizedArtist === "string";
}
