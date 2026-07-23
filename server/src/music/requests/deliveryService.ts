import type { Pool, PoolClient } from "pg";
import type { MediaStore } from "../../media/mediaStore.js";
import { MediaValidationError } from "../../media/mediaStore.js";
import { normalizeMusicText } from "../matching/normalize.js";
import { AmfDeliveryValidationError, validateAmfDeliveryFile } from "./deliveryImporter.js";
import type { JobHandler } from "../../jobs/types.js";
import type { JobQueue } from "../../jobs/jobQueue.js";

export interface DeliveryRecord {
  id: string; fileIndex: number; relativePath: string; byteSize: number | null; sha256: string | null;
  metadata: Record<string, unknown>; importState: "PENDING" | "IMPORTING" | "READY" | "ATTENTION";
}
export interface DeliveryItemRecord {
  id: string; index: number; kind: string; number: number | null; themeId: number | null;
  resultStatus: string | null; importState: "PENDING" | "IMPORTING" | "READY" | "ATTENTION"; deliveries: DeliveryRecord[];
}
export interface DeliveryBatchRecord { id: string; animeId: number; destination: string; warningCount: number; items: DeliveryItemRecord[] }
export interface DeliveryCatalogReservation { songId: number; releaseId: number }
export interface AmfDeliveryRepository {
  loadBatch(batchId: string): Promise<DeliveryBatchRecord | null>;
  reserveCatalog(deliveryId: string, verified: { byteSize: number; sha256: string }): Promise<DeliveryCatalogReservation>;
  publishDelivery(deliveryId: string): Promise<void>;
  markAttention(deliveryId: string | null, itemId: string, error: string): Promise<void>;
  finishBatch(batchId: string, now: Date): Promise<"PROCESSING" | "AWAITING_OPERATOR" | "COMPLETED" | "COMPLETED_WITH_WARNINGS">;
  listRecoverableBatchIds(): Promise<string[]>;
  withContentLock<T>(sha256: string, action: () => Promise<T>): Promise<T>;
  markOperationalExhausted(batchId: string, error: string, now: Date): Promise<void>;
}

export class AmfDeliveryImportService {
  constructor(private readonly deps: { repo: AmfDeliveryRepository; mediaStore: MediaStore; libraryRoot?: string; now?: () => Date }) {}

  async importBatch(batchId: string): Promise<"PROCESSING" | "AWAITING_OPERATOR" | "COMPLETED" | "COMPLETED_WITH_WARNINGS" | null> {
    const batch = await this.deps.repo.loadBatch(batchId);
    if (!batch) return null;
    if (!this.deps.libraryRoot) {
      for (const item of batch.items) await this.deps.repo.markAttention(null, item.id, "AMF library root is not configured.");
      return this.deps.repo.finishBatch(batchId, (this.deps.now ?? (() => new Date()))());
    }
    for (const item of batch.items) {
      if (item.importState === "READY" || item.importState === "ATTENTION") continue;
      if (item.resultStatus !== "delivered" || item.deliveries.length === 0) {
        await this.deps.repo.markAttention(null, item.id, "AMF item does not have an unambiguous delivery.");
        continue;
      }
      if ((item.kind === "OP" || item.kind === "ED") && item.deliveries.length !== 1) {
        await this.deps.repo.markAttention(null, item.id, "Full Size theme delivery must contain exactly one file.");
        continue;
      }
      for (const delivery of item.deliveries) {
        if (delivery.importState === "READY") continue;
        if (delivery.importState === "ATTENTION") { await this.deps.repo.markAttention(null, item.id, "AMF delivery requires operator review."); continue; }
        try {
          const verified = await validateAmfDeliveryFile(this.deps.libraryRoot, {
            relativePath: delivery.relativePath, size: delivery.byteSize, sha256: delivery.sha256,
          }, batch.destination);
          await this.deps.repo.withContentLock(verified.sha256, async () => {
            const reservation = await this.deps.repo.reserveCatalog(delivery.id, { byteSize: verified.byteSize, sha256: verified.sha256 });
            await this.deps.mediaStore.importLocalSongFile({ songId: reservation.songId, sourcePath: verified.path,
              expectedByteSize: verified.byteSize, expectedSha256: verified.sha256 });
            await this.deps.repo.publishDelivery(delivery.id);
          });
        } catch (error) {
          if (error instanceof AmfDeliveryValidationError || error instanceof MediaValidationError) {
            await this.deps.repo.markAttention(delivery.id, item.id, error.message);
            continue;
          }
          throw error;
        }
      }
    }
    return this.deps.repo.finishBatch(batchId, (this.deps.now ?? (() => new Date()))());
  }

  async markOperationalExhausted(batchId: string, error: string): Promise<void> {
    await this.deps.repo.markOperationalExhausted(batchId, error, (this.deps.now ?? (() => new Date()))());
  }
}

export function createAmfDeliveryImportHandlers(service: AmfDeliveryImportService, _queue: JobQueue, _now: () => Date = () => new Date()): Record<"IMPORT_AMF_MUSIC_BATCH", JobHandler> {
  return { async IMPORT_AMF_MUSIC_BATCH(payload, job) {
    if (typeof payload.batchId !== "string") throw new Error("AMF import job is missing batchId");
    try {
      await service.importBatch(payload.batchId);
    } catch (error) {
      if (job.attempts + 1 >= job.maxAttempts) {
        await service.markOperationalExhausted(payload.batchId, error instanceof Error ? error.message : "AMF delivery import failed");
      }
      throw error;
    }
  } };
}

export class PgAmfDeliveryRepository implements AmfDeliveryRepository {
  constructor(private readonly pool: Pool) {}

  async withContentLock<T>(sha256: string, action: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`amf-delivery-content:${sha256}`]);
      return await action();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`amf-delivery-content:${sha256}`]).catch(() => undefined);
      client.release();
    }
  }

  async loadBatch(batchId: string): Promise<DeliveryBatchRecord | null> {
    const batch = await this.pool.query<{ id: string; anime_id: string | number; destination: string; warning_count: number }>(`SELECT b.id,r.animethemes_anime_id anime_id,
      b.amf_request_body->>'destination' destination,b.warning_count FROM anime_music_request_batches b
      JOIN anime_music_requests r ON r.id=b.request_id WHERE b.id=$1`, [batchId]);
    if (!batch.rows[0]) return null;
    const rows = await this.pool.query<any>(`SELECT i.id item_id,i.item_index,i.kind,i.number,i.theme_id,i.result_status,i.import_state item_state,
      d.id delivery_id,d.file_index,d.relative_path,d.byte_size,d.sha256,d.metadata,d.import_state delivery_state
      FROM anime_music_request_items i LEFT JOIN anime_music_request_deliveries d ON d.item_id=i.id AND d.active=true
      WHERE i.batch_id=$1 ORDER BY i.item_index,d.file_index`, [batchId]);
    const items = new Map<string, DeliveryItemRecord>();
    for (const row of rows.rows) {
      let item = items.get(row.item_id);
      if (!item) {
        item = { id: row.item_id, index: row.item_index, kind: row.kind, number: row.number,
          themeId: row.theme_id === null ? null : Number(row.theme_id), resultStatus: row.result_status,
          importState: row.item_state, deliveries: [] };
        items.set(row.item_id, item);
      }
      if (row.delivery_id) item.deliveries.push({ id: row.delivery_id, fileIndex: row.file_index,
        relativePath: row.relative_path, byteSize: row.byte_size === null ? null : Number(row.byte_size), sha256: row.sha256,
        metadata: row.metadata ?? {}, importState: row.delivery_state });
    }
    const value = batch.rows[0];
    return { id: value.id, animeId: Number(value.anime_id), destination: value.destination, warningCount: value.warning_count, items: [...items.values()] };
  }

  async reserveCatalog(deliveryId: string, verified: { byteSize: number; sha256: string }): Promise<DeliveryCatalogReservation> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`amf-delivery-sha256:${verified.sha256}`]);
      const result = await client.query<any>(`SELECT d.*,i.kind,i.item_index,i.batch_id,i.theme_id,i.acquisition_id,r.animethemes_anime_id,
        b.amf_request_body,t.animethemes_anime_id theme_anime_id,t.title theme_title
        FROM anime_music_request_deliveries d JOIN anime_music_request_items i ON i.id=d.item_id
        JOIN anime_music_request_batches b ON b.id=i.batch_id JOIN anime_music_requests r ON r.id=b.request_id
        LEFT JOIN themes t ON t.id=i.theme_id
        WHERE d.id=$1 FOR UPDATE OF d,i`, [deliveryId]);
      const row = result.rows[0];
      if (!row) throw new Error("AMF delivery does not exist");
      if (row.song_id !== null && row.release_id !== null) {
        if (Number(row.verified_byte_size) !== verified.byteSize || row.verified_sha256 !== verified.sha256) {
          throw new AmfDeliveryValidationError("Verified AMF delivery bytes changed after catalog reservation.");
        }
        await client.query("COMMIT");
        return { songId: Number(row.song_id), releaseId: Number(row.release_id) };
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`amf-request-item:${row.item_id}`]);
      if ((row.kind === "OP" || row.kind === "ED")
        && (row.theme_id === null || Number(row.theme_anime_id) !== Number(row.animethemes_anime_id))) {
        throw new AmfDeliveryValidationError("Full Size target theme does not belong to the requested anime.");
      }
      const metadata: Record<string, unknown> = row.metadata ?? {};
      const localized = localizedMetadata(metadata);
      const requestItem = row.amf_request_body?.items?.[row.item_index] ?? {};
      const requestTitles = requestItem.song_titles ?? {};
      const animeTitles = row.amf_request_body?.titles ?? {};
      const animeTitle = preferredTitle(localized.animeTitles) ?? textMetadata(animeTitles.english) ?? textMetadata(animeTitles.romaji) ?? textMetadata(animeTitles.japanese) ?? "Anime";
      const title = preferredTitle(localized.songTitles) ?? textMetadata(metadata.title) ?? textMetadata(requestTitles.english) ?? textMetadata(requestTitles.romaji)
        ?? textMetadata(requestTitles.japanese) ?? textMetadata(row.theme_title) ?? `${animeTitle} ${row.kind}`;
      const requestedArtist = Array.isArray(requestItem.artists) ? requestItem.artists.find((value: unknown) => textMetadata(value)) : null;
      const songArtist = preferredArtists(localized.artists) ?? textMetadata(metadata.artist) ?? textMetadata(metadata.albumartist) ?? textMetadata(requestedArtist) ?? animeTitle;
      const releaseArtist = preferredArtists(localized.artists) ?? textMetadata(metadata.albumartist) ?? textMetadata(requestedArtist) ?? animeTitle;
      const album = preferredTitle(localized.albumTitles) ?? textMetadata(metadata.album) ?? `${animeTitle} ${row.kind === "OST" ? "Original Soundtrack" : row.kind.replaceAll("_", " ")}`;
      const releaseType = row.kind === "OP" || row.kind === "ED" ? "THEME" : row.kind === "OST" ? "SOUNDTRACK" : row.kind === "CHARACTER_SONG" ? "CHARACTER" : "OTHER";
      await client.query(`INSERT INTO music_releases
        (provider,provider_release_id,title,title_english,title_romaji,title_japanese,normalized_title,artist_credit,artist_names,release_type)
        VALUES ('AMF',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT (provider,provider_release_id) DO UPDATE SET
          title=EXCLUDED.title,title_english=COALESCE(EXCLUDED.title_english,music_releases.title_english),
          title_romaji=COALESCE(EXCLUDED.title_romaji,music_releases.title_romaji),title_japanese=COALESCE(EXCLUDED.title_japanese,music_releases.title_japanese),
          normalized_title=EXCLUDED.normalized_title,artist_credit=EXCLUDED.artist_credit,
          artist_names=CASE WHEN EXCLUDED.artist_names <> '[]'::jsonb THEN EXCLUDED.artist_names ELSE music_releases.artist_names END,
          release_type=EXCLUDED.release_type,updated_at=now(),deleted_at=NULL RETURNING id`,
        [`item:${row.item_id}`, album, localized.albumTitles.english, localized.albumTitles.romaji, localized.albumTitles.japanese,
          normalizeMusicText(album), releaseArtist, JSON.stringify(localized.artists), releaseType]);
      const release = await client.query<{ id: string | number; normalized_title: string; artist_credit: string; release_type: string }>(
        "SELECT id,normalized_title,artist_credit,release_type FROM music_releases WHERE provider='AMF' AND provider_release_id=$1 FOR UPDATE", [`item:${row.item_id}`]);
      const releaseRow = release.rows[0]!;
      let songId: number;
      const shared = await client.query<{ song_id: string | number }>(`SELECT d.song_id FROM anime_music_request_deliveries d
        JOIN media_files m ON m.kind='AUDIO' AND m.ref_id=('song:' || d.song_id::text) AND m.variant='ORIGINAL' AND m.state='READY'
        WHERE d.verified_sha256=$1 AND d.song_id IS NOT NULL AND d.import_state='READY' ORDER BY d.updated_at LIMIT 1`, [verified.sha256]);
      if (shared.rows[0]) songId = Number(shared.rows[0].song_id);
      else {
        const song = await client.query<{ id: string | number }>(`INSERT INTO songs
          (title,title_english,title_romaji,title_japanese,normalized_title,artist_credit,artist_names,normalized_artist)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`,
          [title, localized.songTitles.english, localized.songTitles.romaji, localized.songTitles.japanese,
            normalizeMusicText(title), songArtist, JSON.stringify(localized.artists), normalizeMusicText(songArtist)]);
        songId = Number(song.rows[0]!.id);
      }
      await client.query(`UPDATE songs SET title=$2,title_english=COALESCE($3,title_english),title_romaji=COALESCE($4,title_romaji),
        title_japanese=COALESCE($5,title_japanese),normalized_title=$6,artist_credit=$7,
        artist_names=CASE WHEN $8::jsonb <> '[]'::jsonb THEN $8::jsonb ELSE artist_names END,normalized_artist=$9,updated_at=now()
        WHERE id=$1`, [songId, title, localized.songTitles.english, localized.songTitles.romaji, localized.songTitles.japanese,
        normalizeMusicText(title), songArtist, JSON.stringify(localized.artists), normalizeMusicText(songArtist)]);
      const sameItemContent = await client.query(`SELECT 1 FROM anime_music_request_deliveries WHERE item_id=$1 AND id<>$2 AND verified_sha256=$3 LIMIT 1`,
        [row.item_id, deliveryId, verified.sha256]);
      if (sameItemContent.rows[0]) throw new AmfDeliveryValidationError("One request item delivered the same audio bytes more than once.");
      const releaseId = Number(releaseRow.id);
      const discNumber = numberMetadata(metadata.disc) ?? 1;
      const trackNumber = numberMetadata(metadata.track);
      const displayOrder = releaseTrackDisplayOrder(discNumber, trackNumber, row.file_index);
      await client.query(`INSERT INTO release_tracks (release_id,song_id,disc_number,track_number,display_order)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (release_id,display_order) DO NOTHING`,
        [releaseId, songId, discNumber, trackNumber, displayOrder]);
      const trackIdentity = await client.query<{ song_id: string | number }>("SELECT song_id FROM release_tracks WHERE release_id=$1 AND display_order=$2", [releaseId, displayOrder]);
      if (Number(trackIdentity.rows[0]?.song_id) !== songId) {
        throw new AmfDeliveryValidationError("Deterministic AMF release track identity conflicts with persisted catalog metadata.");
      }
      await client.query(`UPDATE anime_music_request_deliveries SET song_id=$2,release_id=$3,verified_byte_size=$4,verified_sha256=$5,
        import_state='IMPORTING',import_error=NULL,updated_at=now() WHERE id=$1`, [deliveryId, songId, releaseId, verified.byteSize, verified.sha256]);
      await client.query("UPDATE anime_music_request_items SET import_state='IMPORTING',import_error=NULL WHERE id=$1 AND import_state='PENDING'", [row.item_id]);
      if (row.acquisition_id === null) {
        const acquisition = await client.query<{ id: string | number }>(`INSERT INTO music_acquisitions
          (provider,provider_job_id,provider_release_id,animethemes_anime_id,purpose,theme_id,song_id,release_id,state,provider_metadata)
          VALUES ('AMF',$1,$1,$2,$3,$4,$5,$6,'IMPORTING',$7::jsonb) RETURNING id`,
          [row.item_id, row.animethemes_anime_id, row.kind === "OP" || row.kind === "ED" ? "FULL_SIZE" : "RELATED_RELEASE",
            row.theme_id, row.kind === "OP" || row.kind === "ED" ? songId : null, releaseId,
            JSON.stringify({ requestItemId: row.item_id, source: "AMF" })]);
        await client.query("UPDATE anime_music_request_items SET acquisition_id=$2 WHERE id=$1", [row.item_id, acquisition.rows[0]!.id]);
      }
      await client.query("COMMIT");
      return { songId, releaseId };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async publishDelivery(deliveryId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<any>(`SELECT d.*,i.id item_id,i.kind,i.theme_id,i.batch_id,i.acquisition_id,r.animethemes_anime_id
        FROM anime_music_request_deliveries d JOIN anime_music_request_items i ON i.id=d.item_id
        JOIN anime_music_request_batches b ON b.id=i.batch_id JOIN anime_music_requests r ON r.id=b.request_id
        WHERE d.id=$1 FOR UPDATE`, [deliveryId]);
      const row = result.rows[0];
      if (!row?.song_id || !row.release_id) throw new Error("AMF delivery catalog reservation is missing");
      const media = await client.query(`SELECT 1 FROM media_files WHERE kind='AUDIO' AND ref_id=$1 AND variant='ORIGINAL' AND state='READY'`, [`song:${row.song_id}`]);
      if (!media.rows[0]) throw new Error("AMF delivery media is not READY");
      await client.query("UPDATE anime_music_request_deliveries SET import_state='READY',import_error=NULL,updated_at=now() WHERE id=$1", [deliveryId]);
      const unfinished = await client.query(`SELECT 1 FROM anime_music_request_deliveries WHERE item_id=$1 AND active=true AND import_state<>'READY' LIMIT 1`, [row.item_id]);
      if (!unfinished.rows[0]) {
        if ((row.kind === "OP" || row.kind === "ED") && row.theme_id !== null) {
          await client.query(`INSERT INTO theme_full_songs (theme_id,song_id,source_release_id,confidence,evidence)
            VALUES ($1,$2,$3,1,$4::jsonb) ON CONFLICT (theme_id) DO UPDATE SET song_id=EXCLUDED.song_id,source_release_id=EXCLUDED.source_release_id,
            confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,updated_at=now()`,
            [row.theme_id, row.song_id, row.release_id, JSON.stringify({ source: "AMF", deliveryId })]);
        } else {
          await client.query(`INSERT INTO anime_music_releases (animethemes_anime_id,release_id,relationship_type,confidence,evidence)
            VALUES ($1,$2,$3,1,$4::jsonb) ON CONFLICT (animethemes_anime_id,release_id) DO UPDATE SET
            relationship_type=EXCLUDED.relationship_type,confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,updated_at=now()`,
            [row.animethemes_anime_id, row.release_id, relationshipType(row.kind), JSON.stringify({ source: "AMF", itemId: row.item_id })]);
        }
        await client.query("UPDATE anime_music_request_items SET import_state='READY',import_error=NULL WHERE id=$1", [row.item_id]);
        await client.query("UPDATE music_acquisitions SET state='READY',completed_at=now(),error_message=NULL,updated_at=now() WHERE id=$1", [row.acquisition_id]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async markAttention(deliveryId: string | null, itemId: string, error: string): Promise<void> {
    if (deliveryId) await this.pool.query("UPDATE anime_music_request_deliveries SET import_state='ATTENTION',import_error=$2,updated_at=now() WHERE id=$1 AND import_state<>'READY'", [deliveryId, error]);
    await this.pool.query("UPDATE anime_music_request_items SET import_state='ATTENTION',import_error=$2 WHERE id=$1 AND import_state<>'READY'", [itemId, error]);
  }

  async finishBatch(batchId: string, now: Date): Promise<"PROCESSING" | "AWAITING_OPERATOR" | "COMPLETED" | "COMPLETED_WITH_WARNINGS"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ request_id: string }>("SELECT request_id FROM anime_music_request_batches WHERE id=$1 FOR UPDATE", [batchId]);
      if (!locked.rows[0]) { await client.query("COMMIT"); return "PROCESSING"; }
      await client.query("SELECT id FROM anime_music_requests WHERE id=$1 FOR UPDATE", [locked.rows[0].request_id]);
      const result = await client.query<{ attention: string | number; pending: string | number; warning_count: number }>(`SELECT
        count(*) FILTER (WHERE i.import_state='ATTENTION') attention,count(*) FILTER (WHERE i.import_state NOT IN ('READY','ATTENTION')) pending,
        b.warning_count FROM anime_music_request_items i JOIN anime_music_request_batches b ON b.id=i.batch_id WHERE i.batch_id=$1 GROUP BY b.warning_count`, [batchId]);
      const row = result.rows[0];
      if (!row || Number(row.pending) > 0) { await client.query("COMMIT"); return "PROCESSING"; }
      const state = Number(row.attention) > 0 ? "AWAITING_OPERATOR" : row.warning_count > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
      const terminal = state !== "AWAITING_OPERATOR";
      await client.query("UPDATE anime_music_request_batches SET state=$2,completed_at=CASE WHEN $3::boolean THEN $4::timestamptz ELSE NULL END,updated_at=$4 WHERE id=$1", [batchId, state, terminal, now]);
      await client.query(`UPDATE anime_music_requests r SET updated_at=$2,completed_at=CASE WHEN NOT EXISTS
        (SELECT 1 FROM anime_music_request_batches b WHERE b.request_id=r.id AND b.completed_at IS NULL) THEN COALESCE(r.completed_at,$2) ELSE NULL END
        WHERE r.id=$1`, [locked.rows[0].request_id, now]);
      await client.query("COMMIT");
      return state;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async markOperationalExhausted(batchId: string, error: string, now: Date): Promise<void> {
    const safeError = error.slice(0, 500);
    await this.pool.query(`UPDATE anime_music_request_deliveries d SET import_state='ATTENTION',import_error=$2,updated_at=$3
      FROM anime_music_request_items i WHERE d.item_id=i.id AND i.batch_id=$1 AND d.active=true AND d.import_state<>'READY'`, [batchId, safeError, now]);
    await this.pool.query("UPDATE anime_music_request_items SET import_state='ATTENTION',import_error=$2 WHERE batch_id=$1 AND import_state<>'READY'", [batchId, safeError]);
    await this.finishBatch(batchId, now);
  }

  async listRecoverableBatchIds(): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(`SELECT id FROM anime_music_request_batches
      WHERE state='PROCESSING' AND manifest_evidence <> '{}'::jsonb ORDER BY created_at`);
    return result.rows.map((row) => row.id);
  }
}

function textMetadata(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numberMetadata(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }

type LocalizedTitles = { english: string | null; romaji: string | null; japanese: string | null };

function localizedMetadata(metadata: Record<string, unknown>): {
  animeTitles: LocalizedTitles;
  albumTitles: LocalizedTitles;
  songTitles: LocalizedTitles;
  artists: LocalizedTitles[];
} {
  const localized = objectMetadata(metadata.localized);
  return {
    animeTitles: localizedTitles(localized.animeTitles),
    albumTitles: localizedTitles(localized.albumTitles),
    songTitles: localizedTitles(localized.songTitles),
    artists: Array.isArray(localized.artists) ? localized.artists.map(localizedTitles).filter(hasLocalizedTitle) : [],
  };
}

function objectMetadata(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function localizedTitles(value: unknown): LocalizedTitles {
  const object = objectMetadata(value);
  return { english: textMetadata(object.english), romaji: textMetadata(object.romaji), japanese: textMetadata(object.japanese) };
}

function hasLocalizedTitle(value: LocalizedTitles): boolean {
  return value.english !== null || value.romaji !== null || value.japanese !== null;
}

function preferredTitle(value: LocalizedTitles): string | null {
  return value.english ?? value.romaji ?? value.japanese;
}

function preferredArtists(artists: LocalizedTitles[]): string | null {
  const values = artists.map(preferredTitle).filter((value): value is string => value !== null);
  return values.length > 0 ? values.join(", ") : null;
}

/** A provider delivery index reflects completion order, not album order. */
export function releaseTrackDisplayOrder(discNumber: number, trackNumber: number | null, fileIndex: number): number {
  return trackNumber === null ? 1_000_000 + fileIndex : (discNumber - 1) * 10_000 + trackNumber;
}
function relationshipType(kind: string): string { return kind === "OST" ? "SOUNDTRACK" : kind === "CHARACTER_SONG" ? "CHARACTER" : "OTHER"; }
