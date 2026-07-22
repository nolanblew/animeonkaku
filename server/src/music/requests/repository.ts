import type { Pool, PoolClient } from "pg";
import { amfJobCreateSchema } from "../animeMusicFetcher/schemas.js";
import type { AmfJob } from "../animeMusicFetcher/schemas.js";
import type { MusicRequestRepository, NewMusicRequest, StoredMusicBatch, StoredMusicRequest, MusicBatchState } from "./types.js";

const TERMINAL = new Set<MusicBatchState>(["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"]);

export class PgMusicRequestRepository implements MusicRequestRepository {
  constructor(private readonly pool: Pool) {}

  async loadMetadata(kitsuId: string) {
    const anime = await this.pool.query<{
      kitsu_id: string; animethemes_anime_id: string | number; title: string | null; title_en: string | null;
      title_ja: string | null; title_romaji: string | null; at_name: string | null; at_name_en: string | null;
    }>(`SELECT k.kitsu_id, k.animethemes_anime_id, k.title, k.title_en, k.title_ja, k.title_romaji,
              a.name at_name, a.name_en at_name_en
         FROM kitsu_anime k JOIN animethemes_anime a ON a.id = k.animethemes_anime_id
        WHERE k.kitsu_id = $1 AND k.deleted_at IS NULL AND k.mapping_state = 'MAPPED'`, [kitsuId]);
    const row = anime.rows[0];
    if (!row) return null;
    const themes = await this.pool.query<{ id: string | number; theme_type: string | null; title: string; artists: string[] | null }>(
      `SELECT t.id, t.theme_type, t.title,
              COALESCE(array_agg(DISTINCT ta.artist_name ORDER BY ta.artist_name) FILTER (WHERE ta.artist_name IS NOT NULL), '{}') artists
         FROM themes t LEFT JOIN theme_artists ta ON ta.theme_id = t.id
        WHERE t.animethemes_anime_id = $1 AND t.deleted_at IS NULL
        GROUP BY t.id, t.theme_type, t.title`, [row.animethemes_anime_id]);
    return {
      kitsuId: row.kitsu_id,
      requestId: "",
      animeThemesAnimeId: Number(row.animethemes_anime_id),
      titles: { title: row.title, english: row.title_en, japanese: row.title_ja, romaji: row.title_romaji, animeThemesName: row.at_name, animeThemesNameEn: row.at_name_en },
      themes: themes.rows.map((theme) => ({ id: Number(theme.id), themeType: theme.theme_type, title: theme.title, artists: theme.artists ?? [] })),
    };
  }

  async createOrReplay(input: NewMusicRequest): Promise<{ request: StoredMusicRequest; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`anime-music-request:${input.animeThemesAnimeId}`]);
      const active = await client.query<{ id: string }>("SELECT id FROM anime_music_requests WHERE animethemes_anime_id=$1 AND completed_at IS NULL", [input.animeThemesAnimeId]);
      if (active.rows[0]) {
        const request = await this.hydrate(active.rows[0].id, client);
        await client.query("COMMIT");
        return { request: request!, created: false };
      }
      await client.query(`INSERT INTO anime_music_requests
        (id, requested_by_user_id, kitsu_id, animethemes_anime_id, source) VALUES ($1,$2,$3,$4,$5)`,
        [input.id, input.requestedByUserId, input.kitsuId, input.animeThemesAnimeId, input.source]);
      for (const batch of input.batches) {
        await client.query(`INSERT INTO anime_music_request_batches
          (id, request_id, batch_index, amf_request_body, idempotency_key) VALUES ($1,$2,$3,$4,$5)`,
          [batch.id, input.id, batch.index, JSON.stringify(batch.body), batch.idempotencyKey]);
        for (const item of batch.items) await client.query(`INSERT INTO anime_music_request_items
          (id,batch_id,item_index,kind,number,theme_id) VALUES ($1,$2,$3,$4,$5,$6)`,
          [item.id, batch.id, item.itemIndex, item.kind, item.number, item.themeId]);
      }
      const request = await this.hydrate(input.id, client);
      await client.query("COMMIT");
      return { request: request!, created: true };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  findById(id: string) { return this.hydrate(id, this.pool); }
  async findLatest(animeThemesAnimeId: number) {
    const result = await this.pool.query<{ id: string }>(`SELECT id FROM anime_music_requests WHERE animethemes_anime_id=$1
      ORDER BY (completed_at IS NULL) DESC, created_at DESC LIMIT 1`, [animeThemesAnimeId]);
    return result.rows[0] ? this.hydrate(result.rows[0].id, this.pool) : null;
  }
  async findBatch(id: string): Promise<StoredMusicBatch | null> {
    const result = await this.pool.query("SELECT * FROM anime_music_request_batches WHERE id=$1", [id]);
    return result.rows[0] ? mapBatch(result.rows[0]) : null;
  }
  async listRecoverableBatches(): Promise<StoredMusicBatch[]> {
    const result = await this.pool.query("SELECT * FROM anime_music_request_batches WHERE completed_at IS NULL ORDER BY created_at,batch_index");
    return result.rows.map(mapBatch);
  }
  async recordProviderState(batchId: string, input: { state: MusicBatchState; amfJobId?: string; warningCount?: number; lastError?: string | null; providerStatus?: AmfJob["status"] }, now: Date): Promise<void> {
    const terminal = TERMINAL.has(input.state);
    await this.pool.query(`UPDATE anime_music_request_batches SET state=$2,
      amf_job_id=COALESCE($3,amf_job_id), warning_count=COALESCE($4,warning_count), last_error=$5,
      completed_at=CASE WHEN $6 THEN COALESCE(completed_at,$7) ELSE NULL END,
      manifest_evidence=CASE WHEN $8::text IS NULL THEN manifest_evidence ELSE jsonb_set(manifest_evidence,'{status}',to_jsonb($8::text),true) END,
      updated_at=$7 WHERE id=$1`,
      [batchId, input.state, input.amfJobId ?? null, input.warningCount ?? null, input.lastError ?? null, terminal, now, input.providerStatus ?? null]);
    await this.pool.query(`UPDATE anime_music_requests r SET updated_at=$2,
      completed_at=CASE WHEN NOT EXISTS (SELECT 1 FROM anime_music_request_batches b WHERE b.request_id=r.id AND b.completed_at IS NULL)
        THEN COALESCE(r.completed_at,$2) ELSE NULL END
      WHERE r.id=(SELECT request_id FROM anime_music_request_batches WHERE id=$1)`, [batchId, now]);
  }

  async recordProviderEvidence(batchId: string, job: AmfJob, now: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE anime_music_request_batches SET warnings=$2::jsonb,manifest_evidence=$3::jsonb,updated_at=$4 WHERE id=$1`,
        [batchId, JSON.stringify(job.warnings), JSON.stringify({ status: job.status, sourceFiles: job.source_files, itemResults: job.item_results, deliveries: job.deliveries, warnings: job.warnings, updatedAt: job.updated_at, completedAt: job.completed_at }), now]);
      const itemRows = await client.query<{ id: string; item_index: number; kind: string; number: number | null; import_state: string }>("SELECT id,item_index,kind,number,import_state FROM anime_music_request_items WHERE batch_id=$1", [batchId]);
      const itemByIndex = new Map(itemRows.rows.map((row) => [row.item_index, row]));
      const resultByIndex = new Map(job.item_results.map((result) => [result.requested_item_index, result]));
      const resultIndexes = job.item_results.map((result) => result.requested_item_index);
      let identityConflict = new Set(resultIndexes).size !== resultIndexes.length
        || resultIndexes.some((index) => !itemByIndex.has(index))
        || [...itemByIndex.keys()].some((index) => !resultByIndex.has(index));
      for (const [index, item] of itemByIndex) {
        const result = resultByIndex.get(index);
        if (result && (result.kind !== item.kind || (result.number ?? null) !== item.number)) identityConflict = true;
        const importState = result?.status === "delivered" ? "PENDING" : "ATTENTION";
        await client.query(`UPDATE anime_music_request_items SET result_status=$2,result_evidence=$3::jsonb,
          import_state=CASE WHEN import_state IN ('READY','ATTENTION') THEN import_state ELSE $4 END,
          import_error=CASE WHEN import_state IN ('READY','ATTENTION') THEN import_error WHEN $4='ATTENTION' THEN 'AMF item is not an unambiguous delivered result' ELSE NULL END
          WHERE id=$1`,
          [item.id, result?.status ?? null, JSON.stringify(result ?? {}), importState]);
      }
      await client.query(`UPDATE anime_music_request_deliveries d SET active=false,updated_at=$2
        FROM anime_music_request_items i WHERE d.item_id=i.id AND i.batch_id=$1 AND d.import_state<>'READY'`, [batchId, now]);
      for (const delivery of job.deliveries) {
        const item = itemByIndex.get(delivery.requested_item_index);
        if (!item) { identityConflict = true; continue; }
        if (delivery.kind !== item.kind || (delivery.number ?? null) !== item.number) identityConflict = true;
        const itemId = item.id;
        for (const file of delivery.files) {
          const deliveryId = `${itemId}:${file.file_index}`;
          await client.query(`INSERT INTO anime_music_request_deliveries
            (id,item_id,file_index,relative_path,byte_size,sha256,metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
            ON CONFLICT (item_id,file_index) DO NOTHING`,
            [deliveryId, itemId, file.file_index, file.relative_path, file.size, file.sha256?.toLowerCase() ?? null, JSON.stringify(file.metadata)]);
          const existing = await client.query<{ relative_path: string; byte_size: string | number | null; sha256: string | null }>(
            "SELECT relative_path,byte_size,sha256 FROM anime_music_request_deliveries WHERE item_id=$1 AND file_index=$2", [itemId, file.file_index]);
          const stored = existing.rows[0]!;
          const storedSize = stored.byte_size === null ? null : Number(stored.byte_size);
          if (stored.relative_path !== file.relative_path || storedSize !== file.size
            || stored.sha256?.toLowerCase() !== file.sha256?.toLowerCase()) {
            await client.query("UPDATE anime_music_request_deliveries SET import_state='ATTENTION',import_error='AMF delivery evidence changed during reprocessing',updated_at=$3 WHERE item_id=$1 AND file_index=$2 AND import_state<>'READY'", [itemId, file.file_index, now]);
            await client.query("UPDATE anime_music_request_items SET import_state='ATTENTION',import_error='AMF delivery evidence changed during reprocessing' WHERE id=$1 AND import_state<>'READY'", [itemId]);
          } else {
            await client.query(`UPDATE anime_music_request_deliveries SET active=true,
              import_state=CASE WHEN import_state IN ('READY','ATTENTION') THEN import_state ELSE 'PENDING' END,
              import_error=CASE WHEN import_state IN ('READY','ATTENTION') THEN import_error ELSE NULL END,updated_at=$3
              WHERE item_id=$1 AND file_index=$2`, [itemId, file.file_index, now]);
          }
        }
      }
      const duplicates = await client.query<{ relative_path: string }>(`SELECT d.relative_path
        FROM anime_music_request_deliveries d JOIN anime_music_request_items i ON i.id=d.item_id
        WHERE i.batch_id=$1 AND d.active=true GROUP BY d.relative_path HAVING count(DISTINCT d.item_id)>1`, [batchId]);
      for (const duplicate of duplicates.rows) {
        await client.query(`UPDATE anime_music_request_deliveries d SET import_state='ATTENTION',import_error='Delivery file is claimed by multiple request items',updated_at=$3
          FROM anime_music_request_items i WHERE d.item_id=i.id AND i.batch_id=$1 AND d.relative_path=$2 AND d.active=true AND d.import_state<>'READY'`, [batchId, duplicate.relative_path, now]);
        await client.query(`UPDATE anime_music_request_items i SET import_state='ATTENTION',import_error='Delivery file is claimed by multiple request items'
          WHERE i.batch_id=$1 AND i.import_state<>'READY' AND EXISTS (SELECT 1 FROM anime_music_request_deliveries d WHERE d.item_id=i.id AND d.relative_path=$2 AND d.active=true)`, [batchId, duplicate.relative_path]);
      }
      const duplicateIndexes = await client.query<{ file_index: number }>(`SELECT d.file_index
        FROM anime_music_request_deliveries d JOIN anime_music_request_items i ON i.id=d.item_id
        WHERE i.batch_id=$1 AND d.active=true GROUP BY d.file_index HAVING count(DISTINCT d.item_id)>1`, [batchId]);
      for (const duplicate of duplicateIndexes.rows) {
        await client.query(`UPDATE anime_music_request_deliveries d SET import_state='ATTENTION',import_error='AMF file index is claimed by multiple request items',updated_at=$3
          FROM anime_music_request_items i WHERE d.item_id=i.id AND i.batch_id=$1 AND d.file_index=$2 AND d.active=true AND d.import_state<>'READY'`, [batchId, duplicate.file_index, now]);
        await client.query(`UPDATE anime_music_request_items i SET import_state='ATTENTION',import_error='AMF file index is claimed by multiple request items'
          WHERE i.batch_id=$1 AND i.import_state<>'READY' AND EXISTS (SELECT 1 FROM anime_music_request_deliveries d WHERE d.item_id=i.id AND d.file_index=$2 AND d.active=true)`, [batchId, duplicate.file_index]);
      }
      await client.query(`UPDATE anime_music_request_items i SET import_state='ATTENTION',import_error='Delivered item has no delivery files'
        WHERE i.batch_id=$1 AND i.result_status='delivered' AND NOT EXISTS (SELECT 1 FROM anime_music_request_deliveries d WHERE d.item_id=i.id AND d.active=true)`, [batchId]);
      await client.query(`UPDATE anime_music_request_items i SET import_state='PENDING',import_error=NULL
        WHERE i.batch_id=$1 AND i.import_state='ATTENTION' AND i.result_status='delivered'
          AND EXISTS (SELECT 1 FROM anime_music_request_deliveries d WHERE d.item_id=i.id AND d.active=true AND d.import_state='PENDING')
          AND NOT EXISTS (SELECT 1 FROM anime_music_request_deliveries d WHERE d.item_id=i.id AND d.active=true AND d.import_state='ATTENTION')`, [batchId]);
      if (identityConflict) {
        await client.query("UPDATE anime_music_request_items SET import_state='ATTENTION',import_error='AMF manifest item identity does not match the persisted batch' WHERE batch_id=$1 AND import_state<>'READY'", [batchId]);
        await client.query(`UPDATE anime_music_request_deliveries d SET import_state='ATTENTION',import_error='AMF manifest item identity does not match the persisted batch',updated_at=$2
          FROM anime_music_request_items i WHERE d.item_id=i.id AND i.batch_id=$1 AND d.import_state<>'READY'`, [batchId, now]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async hydrate(id: string, queryable: Pick<Pool, "query"> | PoolClient): Promise<StoredMusicRequest | null> {
    const request = await queryable.query(`SELECT * FROM anime_music_requests WHERE id=$1`, [id]);
    if (!request.rows[0]) return null;
    const batches = await queryable.query("SELECT * FROM anime_music_request_batches WHERE request_id=$1 ORDER BY batch_index", [id]);
    const row = request.rows[0];
    return { id: row.id, kitsuId: row.kitsu_id, animeThemesAnimeId: Number(row.animethemes_anime_id), createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, batches: batches.rows.map(mapBatch) };
  }
}

function mapBatch(row: any): StoredMusicBatch {
  return { id: row.id, requestId: row.request_id, index: row.batch_index, state: row.state, body: amfJobCreateSchema.parse(row.amf_request_body), idempotencyKey: row.idempotency_key, amfJobId: row.amf_job_id, warningCount: row.warning_count,
    providerStatus: row.manifest_evidence?.status ?? null };
}
