import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  topPickSnapshots,
  type CatalogItemType,
  type TopPickReason,
  type TopPicksFilter,
} from "../db/schema.js";
import type {
  LibraryThemeDto,
  MusicAnimeSummaryDto,
  MusicTrackDto,
  SongPrefDto,
  ThemePrefDto,
} from "./clientRoutes.js";
import { ApiError } from "./errors.js";
import { playbackLoudness } from "../media/loudness.js";

const DEFAULT_LIMIT = 6;
const MAX_ITEMS = 60;
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const MAX_POOL_CANDIDATES = 240;

export type { TopPicksFilter };
export type TopPickItemReason = TopPickReason;

export interface TopPickReleaseSummaryDto {
  id: number;
  title: string;
  relationshipType: string;
  artworkUrl: string | null;
}

interface TopPickCommonDto {
  key: string;
  itemType: CatalogItemType;
  itemId: number;
  reason: TopPickReason;
  artworkUrl: string | null;
  anime: MusicAnimeSummaryDto | null;
}

export interface ThemeTopPickDto extends TopPickCommonDto {
  itemType: "THEME";
  theme: LibraryThemeDto;
  preference: ThemePrefDto | null;
}

export interface SongTopPickDto extends TopPickCommonDto {
  itemType: "SONG";
  track: MusicTrackDto;
  release: TopPickReleaseSummaryDto;
  preference: SongPrefDto | null;
}

export type TopPickItemDto = ThemeTopPickDto | SongTopPickDto;

export interface TopPicksResponse {
  serverTime: number;
  snapshot: string;
  generatedAt: number;
  expiresAt: number;
  total: number;
  items: TopPickItemDto[];
}

export interface TopPicksRequest {
  limit?: number;
  includeExtras: boolean;
  filter: TopPicksFilter;
  snapshot?: string | null;
}

export interface TopPicksService {
  getTopPicks(userId: string, request: TopPicksRequest): Promise<TopPicksResponse>;
}

interface SnapshotRef {
  itemType: CatalogItemType;
  itemId: number;
  reason: TopPickReason;
}

export interface TopPickCandidate {
  itemType: CatalogItemType;
  itemId: number;
  animeKey: string;
  liked: boolean;
  playCount: number;
  lastPlayedAt: number | null;
}

interface CandidateQueryRow {
  itemType: CatalogItemType;
  itemId: number | string;
  animeKey: string;
  liked: boolean;
  playCount: number | string;
  lastPlayedAt: Date | string | null;
}

interface ThemeHydrationRow {
  id: number | string;
  animeThemesAnimeId: number | string;
  kitsuId: string;
  animeTitle: string | null;
  animeTitleEn: string | null;
  animePosterUrl: string | null;
  title: string;
  themeType: string | null;
  durationSeconds: number | null;
  themeUpdatedAt: Date | string;
  descriptorUpdatedAt: Date | string;
  artists: unknown;
  tvState: string | null;
  tvSize: number | string | null;
  tvMimeType: string | null;
  tvVideoFallback: boolean | null;
  tvSha256: string | null;
  tvLoudnessState: string | null;
  tvLoudnessSha256: string | null;
  tvIntegratedLufs: number | null;
  tvTruePeakDbtp: number | null;
  tvLoudnessRangeLu: number | null;
  tvLoudnessGainDb: number | null;
  tvLoudnessPolicyVersion: number | null;
  fullSongId: number | string | null;
  fullDurationSeconds: number | null;
  fullSize: number | string | null;
  fullReleaseId: number | string | null;
  fullMimeType: string | null;
  fullSha256: string | null;
  fullLoudnessState: string | null;
  fullLoudnessSha256: string | null;
  fullIntegratedLufs: number | null;
  fullTruePeakDbtp: number | null;
  fullLoudnessRangeLu: number | null;
  fullLoudnessGainDb: number | null;
  fullLoudnessPolicyVersion: number | null;
  videoUrl: string | null;
  videoMimeType: string | null;
  videoSpoiler: boolean | null;
  videoNsfw: boolean | null;
  videoEntryVersion: number | null;
  liked: boolean | null;
  disliked: boolean | null;
  dislikedTvSize: boolean | null;
  dislikedFullSize: boolean | null;
  preferredMode: "TV_SIZE" | "FULL_SIZE" | null;
  playCount: number | string | null;
  lastPlayedAt: Date | string | null;
  prefUpdatedAt: Date | string | null;
}

interface SongHydrationRow {
  id: number | string;
  kitsuId: string;
  animeTitle: string | null;
  animeTitleEn: string | null;
  animePosterUrl: string | null;
  title: string;
  titleEnglish: string | null;
  titleRomaji: string | null;
  titleJapanese: string | null;
  artistCredit: string;
  artistNames: unknown;
  durationSeconds: number | null;
  fileSize: number | string | null;
  mimeType: string | null;
  sha256: string | null;
  loudnessState: string | null;
  loudnessSha256: string | null;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  loudnessRangeLu: number | null;
  loudnessGainDb: number | null;
  loudnessPolicyVersion: number | null;
  discNumber: number;
  trackNumber: number | null;
  displayOrder: number;
  releaseId: number | string;
  releaseTitle: string;
  relationshipType: string;
  releaseArtworkUrl: string | null;
  liked: boolean | null;
  disliked: boolean | null;
  playCount: number | string | null;
  lastPlayedAt: Date | string | null;
  prefUpdatedAt: Date | string | null;
}

/**
 * Durable recommendation snapshots prevent library deltas and play events from
 * reordering Home while it is visible. Concurrent first requests share one
 * generation promise in-process; the scope/bucket unique key resolves races
 * across server processes.
 */
export class DrizzleTopPicksService implements TopPicksService {
  private readonly now: () => Date;
  private readonly snapshotTtlMs: number;
  private readonly musicCatalogEnabled: boolean;
  private readonly loudnessPlaybackGainEnabled: boolean;
  private readonly inFlight = new Map<string, Promise<typeof topPickSnapshots.$inferSelect>>();

  constructor(
    private readonly db: Db,
    options: {
      now?: () => Date;
      snapshotTtlMs?: number;
      musicCatalogEnabled?: boolean;
      loudnessPlaybackGainEnabled?: boolean;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.snapshotTtlMs = options.snapshotTtlMs ?? SNAPSHOT_TTL_MS;
    this.musicCatalogEnabled = options.musicCatalogEnabled ?? false;
    this.loudnessPlaybackGainEnabled = options.loudnessPlaybackGainEnabled ?? false;
  }

  async getTopPicks(userId: string, request: TopPicksRequest): Promise<TopPicksResponse> {
    const now = this.now();
    const limit = boundedLimit(request.limit);
    const snapshot = request.snapshot
      ? await this.loadRequestedSnapshot(userId, request, now)
      : await this.getOrCreateSnapshot(userId, request.includeExtras, request.filter, now);
    const refs = parseSnapshotRefs(snapshot.items);
    const hydrated = await this.hydrate(
      userId,
      refs,
      request.includeExtras && this.musicCatalogEnabled,
      request.filter,
    );
    return {
      serverTime: now.getTime(),
      snapshot: snapshot.token,
      generatedAt: snapshot.generatedAt.getTime(),
      expiresAt: snapshot.expiresAt.getTime(),
      total: hydrated.length,
      items: hydrated.slice(0, limit),
    };
  }

  private async loadRequestedSnapshot(userId: string, request: TopPicksRequest, now: Date) {
    const [snapshot] = await this.db
      .select()
      .from(topPickSnapshots)
      .where(and(eq(topPickSnapshots.token, request.snapshot!), eq(topPickSnapshots.userId, userId)))
      .limit(1);
    if (!snapshot || snapshot.expiresAt <= now) {
      throw new ApiError(410, "TOP_PICKS_SNAPSHOT_EXPIRED", "Top picks changed. Request a new preview.");
    }
    if (snapshot.includeExtras !== request.includeExtras || snapshot.filter !== request.filter) {
      throw new ApiError(400, "TOP_PICKS_SNAPSHOT_SCOPE_MISMATCH", "The snapshot does not match the requested Top picks filters.");
    }
    return snapshot;
  }

  private async getOrCreateSnapshot(userId: string, includeExtras: boolean, filter: TopPicksFilter, now: Date) {
    const [active] = await this.db
      .select()
      .from(topPickSnapshots)
      .where(and(
        eq(topPickSnapshots.userId, userId),
        eq(topPickSnapshots.includeExtras, includeExtras),
        eq(topPickSnapshots.filter, filter),
        gt(topPickSnapshots.expiresAt, now),
      ))
      .orderBy(sql`${topPickSnapshots.generatedAt} DESC`)
      .limit(1);
    if (active && parseSnapshotRefs(active.items).length > 0) return active;
    // An initial sync can legitimately leave Home empty for a few seconds. An
    // empty token is discarded on a later no-token request, so newly synced
    // candidates are not hidden for the full TTL.
    if (active) await this.db.delete(topPickSnapshots).where(eq(topPickSnapshots.token, active.token));

    const bucketStartedAt = new Date(Math.floor(now.getTime() / this.snapshotTtlMs) * this.snapshotTtlMs);
    const flightKey = `${userId}\u0000${includeExtras}\u0000${filter}\u0000${bucketStartedAt.getTime()}`;
    const running = this.inFlight.get(flightKey);
    if (running) return running;
    const promise = this.createSnapshot(userId, includeExtras, filter, now, bucketStartedAt);
    this.inFlight.set(flightKey, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(flightKey) === promise) this.inFlight.delete(flightKey);
    }
  }

  private async createSnapshot(
    userId: string,
    includeExtras: boolean,
    filter: TopPicksFilter,
    now: Date,
    bucketStartedAt: Date,
  ) {
    await this.db.execute(sql`
      DELETE FROM top_pick_snapshots WHERE token IN (
        SELECT token FROM top_pick_snapshots WHERE expires_at <= ${now} ORDER BY expires_at LIMIT 1000
      )
    `);
    const candidates = await this.candidates(
      userId,
      includeExtras && this.musicCatalogEnabled,
      filter,
      `${userId}:${dayKey(now)}`,
      this.musicCatalogEnabled,
    );
    const items = rankTopPickCandidates(candidates, `${userId}:${dayKey(now)}`, MAX_ITEMS);
    const inserted = await this.db
      .insert(topPickSnapshots)
      .values({
        token: randomUUID(),
        userId,
        includeExtras,
        filter,
        bucketStartedAt,
        items,
        generatedAt: now,
        expiresAt: new Date(now.getTime() + this.snapshotTtlMs),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return inserted[0];
    const [winner] = await this.db
      .select()
      .from(topPickSnapshots)
      .where(and(
        eq(topPickSnapshots.userId, userId),
        eq(topPickSnapshots.includeExtras, includeExtras),
        eq(topPickSnapshots.filter, filter),
        eq(topPickSnapshots.bucketStartedAt, bucketStartedAt),
      ))
      .limit(1);
    if (!winner) throw new Error("Top picks snapshot creation race did not produce a winner.");
    return winner;
  }

  private async candidates(
    userId: string,
    includeExtras: boolean,
    filter: TopPicksFilter,
    seed: string,
    musicCatalogEnabled: boolean,
  ): Promise<TopPickCandidate[]> {
    const result = await this.db.execute(candidateSql(userId, includeExtras, filter, seed, musicCatalogEnabled));
    return (result.rows as unknown as CandidateQueryRow[]).map((row) => ({
      itemType: row.itemType,
      itemId: integer(row.itemId),
      animeKey: row.animeKey,
      liked: row.liked,
      playCount: integer(row.playCount),
      lastPlayedAt: millis(row.lastPlayedAt),
    }));
  }

  private async hydrate(
    userId: string,
    refs: SnapshotRef[],
    includeExtras: boolean,
    filter: TopPicksFilter,
  ): Promise<TopPickItemDto[]> {
    const themeIds = refs.filter((ref) => ref.itemType === "THEME").map((ref) => ref.itemId);
    const songIds = refs.filter((ref) => ref.itemType === "SONG").map((ref) => ref.itemId);
    const [themeResult, songResult] = await Promise.all([
      themeIds.length === 0
        ? Promise.resolve({ rows: [] })
        : this.db.execute(themeHydrationSql(userId, themeIds, filter, includeExtras, this.musicCatalogEnabled)),
      !includeExtras || filter !== "ALL" || songIds.length === 0
        ? Promise.resolve({ rows: [] })
        : this.db.execute(songHydrationSql(userId, songIds)),
    ]);
    const themes = new Map((themeResult.rows as unknown as ThemeHydrationRow[]).map((row) => [integer(row.id), themeDto(row, this.loudnessPlaybackGainEnabled)]));
    const songs = new Map((songResult.rows as unknown as SongHydrationRow[]).map((row) => [integer(row.id), songDto(row, this.loudnessPlaybackGainEnabled)]));
    const ordered: TopPickItemDto[] = [];
    for (const ref of refs) {
      if (ref.itemType === "THEME") {
        const item = themes.get(ref.itemId);
        if (item) ordered.push({ ...item, reason: ref.reason });
      } else {
        const item = songs.get(ref.itemId);
        if (item) ordered.push({ ...item, reason: ref.reason });
      }
    }
    return ordered;
  }
}

/** Deterministic favorite / played / discovery round-robin with anime variety. */
export function rankTopPickCandidates(
  input: TopPickCandidate[],
  seed: string,
  limit = MAX_ITEMS,
): SnapshotRef[] {
  const candidates = dedupeCandidates(input);
  const tie = (candidate: TopPickCandidate) => stableTie(seed, `${candidate.itemType}:${candidate.itemId}`);
  const favorites = candidates.filter((candidate) => candidate.liked).sort((left, right) =>
    right.playCount - left.playCount || newerFirst(left.lastPlayedAt, right.lastPlayedAt) || tie(left).localeCompare(tie(right)));
  const played = candidates.filter((candidate) => candidate.playCount > 0).sort((left, right) =>
    right.playCount - left.playCount || newerFirst(left.lastPlayedAt, right.lastPlayedAt) || tie(left).localeCompare(tie(right)));
  const discovery = [...candidates].sort((left, right) =>
    left.playCount - right.playCount || olderFirst(left.lastPlayedAt, right.lastPlayedAt) || tie(left).localeCompare(tie(right)));
  const pools: Array<{ reason: TopPickReason; values: TopPickCandidate[] }> = [
    { reason: "FAVORITE", values: favorites },
    { reason: "MOST_PLAYED", values: played },
    { reason: "DISCOVERY", values: discovery },
  ];
  const selected: SnapshotRef[] = [];
  const used = new Set<string>();
  const usedAnime = new Set<string>();
  while (selected.length < Math.min(MAX_ITEMS, Math.max(0, limit))) {
    let progressed = false;
    for (const pool of pools) {
      const candidate = takeCandidate(pool.values, used, usedAnime);
      if (!candidate) continue;
      const key = candidateKey(candidate);
      used.add(key);
      usedAnime.add(candidate.animeKey);
      selected.push({ itemType: candidate.itemType, itemId: candidate.itemId, reason: pool.reason });
      progressed = true;
      if (selected.length >= limit || selected.length >= MAX_ITEMS) break;
    }
    if (!progressed) break;
  }
  return selected;
}

function takeCandidate(values: TopPickCandidate[], used: Set<string>, usedAnime: Set<string>) {
  const varied = values.findIndex((candidate) => !used.has(candidateKey(candidate)) && !usedAnime.has(candidate.animeKey));
  const index = varied >= 0 ? varied : values.findIndex((candidate) => !used.has(candidateKey(candidate)));
  return index < 0 ? null : values.splice(index, 1)[0]!;
}

function dedupeCandidates(input: TopPickCandidate[]): TopPickCandidate[] {
  const result = new Map<string, TopPickCandidate>();
  for (const candidate of input) {
    const key = candidateKey(candidate);
    const previous = result.get(key);
    if (!previous || candidate.playCount > previous.playCount || candidate.liked && !previous.liked) result.set(key, candidate);
  }
  return [...result.values()];
}

function candidateKey(candidate: Pick<TopPickCandidate, "itemType" | "itemId">): string {
  return `${candidate.itemType}:${candidate.itemId}`;
}

function stableTie(seed: string, key: string): string {
  return createHash("sha256").update(seed).update("\0").update(key).digest("hex");
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function newerFirst(left: number | null, right: number | null): number {
  return (right ?? 0) - (left ?? 0);
}

function olderFirst(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left - right;
}

function boundedLimit(value = DEFAULT_LIMIT): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_ITEMS, Math.max(1, Math.trunc(value)));
}

function parseSnapshotRefs(value: unknown): SnapshotRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): SnapshotRef[] => {
    if (!entry || typeof entry !== "object") return [];
    const ref = entry as Record<string, unknown>;
    if ((ref.itemType !== "THEME" && ref.itemType !== "SONG") ||
      !Number.isSafeInteger(ref.itemId) || Number(ref.itemId) <= 0 ||
      !["FAVORITE", "MOST_PLAYED", "DISCOVERY"].includes(String(ref.reason))) return [];
    return [{ itemType: ref.itemType, itemId: Number(ref.itemId), reason: ref.reason as TopPickReason }];
  }).slice(0, MAX_ITEMS);
}

function candidateSql(
  userId: string,
  includeExtras: boolean,
  filter: TopPicksFilter,
  seed: string,
  musicCatalogEnabled: boolean,
) {
  const themeFilter = filter === "ALL" ? sql`TRUE` : sql`upper(coalesce(t.theme_type, '')) LIKE ${`${filter}%`}`;
  const opEdOnly = !includeExtras ? sql`upper(coalesce(t.theme_type, '')) ~ '^(OP|ED)'` : sql`TRUE`;
  const extras = includeExtras && filter === "ALL" ? sql`
    UNION ALL (
    SELECT DISTINCT ON (s.id)
      'SONG'::text AS "itemType", s.id AS "itemId", ka.kitsu_id AS "animeKey",
      coalesce(sp.liked, false) AS liked, coalesce(sp.play_count, 0) AS "playCount", sp.last_played_at AS "lastPlayedAt"
    FROM library_entries le
    JOIN kitsu_anime ka ON ka.kitsu_id=le.kitsu_id AND ka.deleted_at IS NULL
    JOIN anime_music_releases amr ON amr.animethemes_anime_id=ka.animethemes_anime_id
    JOIN music_releases mr ON mr.id=amr.release_id AND mr.deleted_at IS NULL
    JOIN release_tracks rt ON rt.release_id=mr.id
    JOIN songs s ON s.id=rt.song_id AND s.deleted_at IS NULL
    JOIN media_files mf ON mf.kind='AUDIO' AND mf.variant='ORIGINAL' AND mf.state='READY' AND mf.ref_id=('song:' || s.id::text)
    JOIN music_acquisitions ma ON ma.animethemes_anime_id=amr.animethemes_anime_id AND ma.release_id=mr.id AND ma.purpose='RELATED_RELEASE' AND ma.state='READY'
    LEFT JOIN song_prefs sp ON sp.user_id=le.user_id AND sp.song_id=s.id AND sp.deleted_at IS NULL
    LEFT JOIN theme_full_songs tfs ON tfs.song_id=s.id
    WHERE le.user_id=${userId} AND le.deleted_at IS NULL AND tfs.song_id IS NULL AND coalesce(sp.disliked,false)=false
    ORDER BY s.id, ka.kitsu_id, mr.id
    )
  ` : sql``;
  return sql`
    WITH eligible AS (
      (
      SELECT DISTINCT ON (t.id)
        'THEME'::text AS "itemType", t.id AS "itemId", ka.kitsu_id AS "animeKey",
        coalesce(tp.liked, false) AS liked, coalesce(tp.play_count, 0) AS "playCount", tp.last_played_at AS "lastPlayedAt"
      FROM library_entries le
      JOIN kitsu_anime ka ON ka.kitsu_id=le.kitsu_id AND ka.deleted_at IS NULL
      JOIN themes t ON t.animethemes_anime_id=ka.animethemes_anime_id AND t.deleted_at IS NULL
      LEFT JOIN theme_prefs tp ON tp.user_id=le.user_id AND tp.theme_id=t.id AND tp.deleted_at IS NULL
      WHERE le.user_id=${userId} AND le.deleted_at IS NULL AND coalesce(tp.disliked,false)=false
        AND ${themeFilter} AND ${opEdOnly}
        AND (
          (coalesce(tp.disliked_tv_size,false)=false AND EXISTS (SELECT 1 FROM media_files mf WHERE mf.kind='AUDIO' AND mf.variant='SHORT' AND mf.state='READY' AND mf.ref_id=t.id::text))
          OR (${musicCatalogEnabled} AND coalesce(tp.disliked_full_size,false)=false AND EXISTS (
            SELECT 1 FROM theme_full_songs tfs JOIN songs fs ON fs.id=tfs.song_id AND fs.deleted_at IS NULL
            JOIN media_files fm ON fm.kind='AUDIO' AND fm.variant='ORIGINAL' AND fm.state='READY' AND fm.ref_id=('song:' || fs.id::text)
            JOIN music_acquisitions fa ON fa.theme_id=t.id AND fa.song_id=fs.id AND fa.release_id=tfs.source_release_id AND fa.purpose='FULL_SIZE' AND fa.state='READY'
            WHERE tfs.theme_id=t.id))
        )
      ORDER BY t.id, ka.kitsu_id
      )
      ${extras}
    ), favorites AS (
      SELECT * FROM eligible WHERE liked ORDER BY "playCount" DESC, "lastPlayedAt" DESC NULLS LAST, "itemId" LIMIT ${MAX_POOL_CANDIDATES}
    ), played AS (
      SELECT * FROM eligible WHERE "playCount">0 ORDER BY "playCount" DESC, "lastPlayedAt" DESC NULLS LAST, "itemId" LIMIT ${MAX_POOL_CANDIDATES}
    ), discovery AS (
      SELECT * FROM eligible
      ORDER BY "playCount" ASC, "lastPlayedAt" ASC NULLS FIRST,
        md5(${seed} || ':' || "itemType" || ':' || "itemId"::text)
      LIMIT ${MAX_POOL_CANDIDATES}
    )
    SELECT * FROM favorites UNION ALL SELECT * FROM played UNION ALL SELECT * FROM discovery
  `;
}

function themeHydrationSql(
  userId: string,
  ids: number[],
  filter: TopPicksFilter,
  includeExtras: boolean,
  musicCatalogEnabled: boolean,
) {
  const themeFilter = filter === "ALL" ? sql`TRUE` : sql`upper(coalesce(t.theme_type, '')) LIKE ${`${filter}%`}`;
  const opEdOnly = !includeExtras ? sql`upper(coalesce(t.theme_type, '')) ~ '^(OP|ED)'` : sql`TRUE`;
  return sql`
    SELECT DISTINCT ON (t.id)
      t.id, t.animethemes_anime_id AS "animeThemesAnimeId", ka.kitsu_id AS "kitsuId",
      ka.title AS "animeTitle", ka.title_en AS "animeTitleEn",
      CASE WHEN ka.poster_url IS NOT NULL OR ka.poster_url_large IS NOT NULL THEN '/v1/media/images/anime/' || replace(ka.kitsu_id, '/', '%2F') || '/poster' ELSE NULL END AS "animePosterUrl",
      t.title, t.theme_type AS "themeType", t.duration_seconds AS "durationSeconds", t.updated_at AS "themeUpdatedAt",
      greatest(t.updated_at, tv_audio.updated_at, full_audio.updated_at) AS "descriptorUpdatedAt",
      coalesce(ta.artists, '[]'::jsonb) AS artists,
      tv_audio.state AS "tvState", tv_audio.byte_size AS "tvSize", tv_audio.content_type AS "tvMimeType", tv_audio.video_fallback AS "tvVideoFallback",
      tv_audio.sha256 AS "tvSha256", tv_audio.loudness_state AS "tvLoudnessState", tv_audio.loudness_sha256 AS "tvLoudnessSha256",
      tv_audio.integrated_lufs AS "tvIntegratedLufs", tv_audio.true_peak_dbtp AS "tvTruePeakDbtp", tv_audio.loudness_range_lu AS "tvLoudnessRangeLu",
      tv_audio.loudness_gain_db AS "tvLoudnessGainDb", tv_audio.loudness_policy_version AS "tvLoudnessPolicyVersion",
      full_audio.song_id AS "fullSongId", full_audio.duration_seconds AS "fullDurationSeconds", full_audio.byte_size AS "fullSize",
      full_audio.source_release_id AS "fullReleaseId", full_audio.content_type AS "fullMimeType",
      full_audio.sha256 AS "fullSha256", full_audio.loudness_state AS "fullLoudnessState", full_audio.loudness_sha256 AS "fullLoudnessSha256",
      full_audio.integrated_lufs AS "fullIntegratedLufs", full_audio.true_peak_dbtp AS "fullTruePeakDbtp", full_audio.loudness_range_lu AS "fullLoudnessRangeLu",
      full_audio.loudness_gain_db AS "fullLoudnessGainDb", full_audio.loudness_policy_version AS "fullLoudnessPolicyVersion",
      video.link AS "videoUrl", video.mime_type AS "videoMimeType", video.spoiler AS "videoSpoiler", video.nsfw AS "videoNsfw", video.entry_version AS "videoEntryVersion",
      tp.liked, tp.disliked, tp.disliked_tv_size AS "dislikedTvSize", tp.disliked_full_size AS "dislikedFullSize",
      tp.preferred_mode AS "preferredMode", tp.play_count AS "playCount", tp.last_played_at AS "lastPlayedAt", tp.updated_at AS "prefUpdatedAt"
    FROM themes t
    JOIN kitsu_anime ka ON ka.animethemes_anime_id=t.animethemes_anime_id AND ka.deleted_at IS NULL
    JOIN library_entries le ON le.kitsu_id=ka.kitsu_id AND le.user_id=${userId} AND le.deleted_at IS NULL
    LEFT JOIN theme_prefs tp ON tp.user_id=le.user_id AND tp.theme_id=t.id AND tp.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('name', x.artist_name, 'asCharacter', x.as_character, 'alias', x.alias) ORDER BY x.artist_name) AS artists
      FROM theme_artists x WHERE x.theme_id=t.id
    ) ta ON TRUE
    LEFT JOIN LATERAL (
      SELECT mf.state,mf.byte_size,mf.content_type,mf.video_fallback,mf.sha256,mf.loudness_state,mf.loudness_sha256,mf.updated_at,
        mf.integrated_lufs,mf.true_peak_dbtp,mf.loudness_range_lu,mf.loudness_gain_db,mf.loudness_policy_version FROM media_files mf
      WHERE mf.kind='AUDIO' AND mf.variant='SHORT' AND mf.ref_id=t.id::text LIMIT 1
    ) tv_audio ON TRUE
    LEFT JOIN LATERAL (
      SELECT tfs.song_id,s.duration_seconds,mf.byte_size,tfs.source_release_id,mf.content_type,mf.sha256,mf.loudness_state,mf.loudness_sha256,
        mf.integrated_lufs,mf.true_peak_dbtp,mf.loudness_range_lu,mf.loudness_gain_db,mf.loudness_policy_version,
        greatest(tfs.updated_at,s.updated_at,mr.updated_at,ma.updated_at,mf.updated_at) AS updated_at
      FROM theme_full_songs tfs
      JOIN songs s ON s.id=tfs.song_id AND s.deleted_at IS NULL
      JOIN music_releases mr ON mr.id=tfs.source_release_id AND mr.deleted_at IS NULL
      JOIN music_acquisitions ma ON ma.theme_id=t.id AND ma.song_id=s.id AND ma.release_id=mr.id AND ma.purpose='FULL_SIZE' AND ma.state='READY'
      JOIN media_files mf ON mf.kind='AUDIO' AND mf.variant='ORIGINAL' AND mf.state='READY' AND mf.ref_id=('song:' || s.id::text)
      WHERE tfs.theme_id=t.id AND ${musicCatalogEnabled} LIMIT 1
    ) full_audio ON TRUE
    LEFT JOIN LATERAL (
      SELECT v.link,v.mime_type,v.spoiler,v.nsfw,v.entry_version FROM theme_video_sources v
      WHERE v.theme_id=t.id ORDER BY v.preference_rank,v.animethemes_video_id LIMIT 1
    ) video ON TRUE
    WHERE t.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`,`)}) AND t.deleted_at IS NULL
      AND ${themeFilter} AND ${opEdOnly} AND coalesce(tp.disliked,false)=false
      AND ((tv_audio.state='READY' AND coalesce(tp.disliked_tv_size,false)=false)
        OR (${musicCatalogEnabled} AND full_audio.song_id IS NOT NULL AND coalesce(tp.disliked_full_size,false)=false))
    ORDER BY t.id, ka.kitsu_id
  `;
}

function songHydrationSql(userId: string, ids: number[]) {
  return sql`
    SELECT DISTINCT ON (s.id)
      s.id, ka.kitsu_id AS "kitsuId", ka.title AS "animeTitle", ka.title_en AS "animeTitleEn",
      CASE WHEN ka.poster_url IS NOT NULL OR ka.poster_url_large IS NOT NULL THEN '/v1/media/images/anime/' || replace(ka.kitsu_id, '/', '%2F') || '/poster' ELSE NULL END AS "animePosterUrl",
      s.title,s.title_english AS "titleEnglish",s.title_romaji AS "titleRomaji",s.title_japanese AS "titleJapanese",
      s.artist_credit AS "artistCredit",s.artist_names AS "artistNames",s.duration_seconds AS "durationSeconds",
      mf.byte_size AS "fileSize",mf.content_type AS "mimeType",mf.sha256,mf.loudness_state AS "loudnessState",mf.loudness_sha256 AS "loudnessSha256",
      mf.integrated_lufs AS "integratedLufs",mf.true_peak_dbtp AS "truePeakDbtp",mf.loudness_range_lu AS "loudnessRangeLu",
      mf.loudness_gain_db AS "loudnessGainDb",mf.loudness_policy_version AS "loudnessPolicyVersion",
      rt.disc_number AS "discNumber",rt.track_number AS "trackNumber",rt.display_order AS "displayOrder",
      mr.id AS "releaseId",mr.title AS "releaseTitle",amr.relationship_type AS "relationshipType",mr.artwork_url AS "releaseArtworkUrl",
      sp.liked,sp.disliked,sp.play_count AS "playCount",sp.last_played_at AS "lastPlayedAt",sp.updated_at AS "prefUpdatedAt"
    FROM songs s
    JOIN release_tracks rt ON rt.song_id=s.id
    JOIN music_releases mr ON mr.id=rt.release_id AND mr.deleted_at IS NULL
    JOIN anime_music_releases amr ON amr.release_id=mr.id
    JOIN kitsu_anime ka ON ka.animethemes_anime_id=amr.animethemes_anime_id AND ka.deleted_at IS NULL
    JOIN library_entries le ON le.kitsu_id=ka.kitsu_id AND le.user_id=${userId} AND le.deleted_at IS NULL
    JOIN music_acquisitions ma ON ma.animethemes_anime_id=amr.animethemes_anime_id AND ma.release_id=mr.id AND ma.purpose='RELATED_RELEASE' AND ma.state='READY'
    JOIN media_files mf ON mf.kind='AUDIO' AND mf.variant='ORIGINAL' AND mf.state='READY' AND mf.ref_id=('song:' || s.id::text)
    LEFT JOIN song_prefs sp ON sp.user_id=le.user_id AND sp.song_id=s.id AND sp.deleted_at IS NULL
    LEFT JOIN theme_full_songs tfs ON tfs.song_id=s.id
    WHERE s.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`,`)}) AND s.deleted_at IS NULL
      AND tfs.song_id IS NULL AND coalesce(sp.disliked,false)=false
    ORDER BY s.id,ka.kitsu_id,mr.id
  `;
}

function themeDto(row: ThemeHydrationRow, loudnessEnabled: boolean): Omit<ThemeTopPickDto, "reason"> {
  const id = integer(row.id);
  const fullSongId = nullableInteger(row.fullSongId);
  const anime = animeSummary(row.kitsuId, row.animeTitle, row.animeTitleEn, row.animePosterUrl);
  const tvLoudness = playbackLoudness({
    sha256: row.tvSha256, loudnessState: row.tvLoudnessState, loudnessSha256: row.tvLoudnessSha256,
    integratedLufs: row.tvIntegratedLufs, truePeakDbtp: row.tvTruePeakDbtp,
    loudnessRangeLu: row.tvLoudnessRangeLu, loudnessGainDb: row.tvLoudnessGainDb,
    loudnessPolicyVersion: row.tvLoudnessPolicyVersion,
  }, loudnessEnabled);
  const fullLoudness = playbackLoudness({
    sha256: row.fullSha256, loudnessState: row.fullLoudnessState, loudnessSha256: row.fullLoudnessSha256,
    integratedLufs: row.fullIntegratedLufs, truePeakDbtp: row.fullTruePeakDbtp,
    loudnessRangeLu: row.fullLoudnessRangeLu, loudnessGainDb: row.fullLoudnessGainDb,
    loudnessPolicyVersion: row.fullLoudnessPolicyVersion,
  }, loudnessEnabled);
  const theme: LibraryThemeDto = {
    id,
    animeThemesAnimeId: integer(row.animeThemesAnimeId),
    kitsuAnimeIds: [row.kitsuId],
    title: row.title,
    themeType: row.themeType,
    artists: artistCredits(row.artists),
    audioUrl: `/v1/media/audio/${id}`,
    videoUrl: null,
    audioState: row.tvState === "READY" ? "READY" : row.tvState === "FAILED" ? "FAILED" : row.tvState ? "PENDING" : "MISSING",
    durationSeconds: row.durationSeconds,
    fileSize: nullableInteger(row.tvSize),
    mediaModes: {
      tvSize: {
        url: `/v1/media/audio/${id}`,
        durationSeconds: row.durationSeconds,
        fileSize: nullableInteger(row.tvSize),
        mimeType: row.tvVideoFallback ? "video/webm" : row.tvMimeType ?? "audio/ogg",
        ...(tvLoudness ? { loudness: tvLoudness } : {}),
      },
      fullSize: fullSongId === null ? null : {
        songId: fullSongId,
        url: `/v1/media/songs/${fullSongId}/audio`,
        durationSeconds: row.fullDurationSeconds,
        fileSize: nullableInteger(row.fullSize),
        sourceReleaseId: nullableInteger(row.fullReleaseId),
        mimeType: row.fullMimeType,
        ...(fullLoudness ? { loudness: fullLoudness } : {}),
      },
      // Top picks is an audio collection. Do not expose an AnimeThemes origin
      // video URL through this self-contained cross-client payload.
      video: null,
    },
    updatedAt: millis(row.descriptorUpdatedAt) ?? millis(row.themeUpdatedAt) ?? 0,
    deleted: false,
  };
  return {
    key: `THEME:${id}`,
    itemType: "THEME",
    itemId: id,
    artworkUrl: anime.posterUrl,
    anime,
    theme,
    preference: row.prefUpdatedAt ? {
      themeId: id,
      liked: row.liked ?? false,
      disliked: row.disliked ?? false,
      dislikedTvSize: row.dislikedTvSize ?? false,
      dislikedFullSize: row.dislikedFullSize ?? false,
      preferredMode: row.preferredMode,
      playCount: integer(row.playCount ?? 0),
      lastPlayedAt: millis(row.lastPlayedAt),
      updatedAt: millis(row.prefUpdatedAt) ?? 0,
      deleted: false,
    } : null,
  };
}

function songDto(row: SongHydrationRow, loudnessEnabled: boolean): Omit<SongTopPickDto, "reason"> {
  const id = integer(row.id);
  const anime = animeSummary(row.kitsuId, row.animeTitle, row.animeTitleEn, row.animePosterUrl);
  const loudness = playbackLoudness(row, loudnessEnabled);
  const track: MusicTrackDto = {
    id,
    title: row.title,
    titleEnglish: row.titleEnglish,
    titleRomaji: row.titleRomaji,
    titleJapanese: row.titleJapanese,
    artistCredit: row.artistCredit,
    artistNames: artistNames(row.artistNames),
    durationSeconds: row.durationSeconds,
    audioUrl: `/v1/media/songs/${id}/audio`,
    fileSize: nullableInteger(row.fileSize),
    mimeType: row.mimeType,
    discNumber: row.discNumber,
    trackNumber: row.trackNumber,
    displayOrder: row.displayOrder,
    ...(loudness ? { loudness } : {}),
  };
  return {
    key: `SONG:${id}`,
    itemType: "SONG",
    itemId: id,
    artworkUrl: row.releaseArtworkUrl ?? anime.posterUrl,
    anime,
    track,
    release: {
      id: integer(row.releaseId),
      title: row.releaseTitle,
      relationshipType: row.relationshipType,
      artworkUrl: row.releaseArtworkUrl,
    },
    preference: row.prefUpdatedAt ? {
      songId: id,
      liked: row.liked ?? false,
      disliked: row.disliked ?? false,
      playCount: integer(row.playCount ?? 0),
      lastPlayedAt: millis(row.lastPlayedAt),
      updatedAt: millis(row.prefUpdatedAt) ?? 0,
      deleted: false,
    } : null,
  };
}

function animeSummary(kitsuId: string, title: string | null, titleEn: string | null, posterUrl: string | null): MusicAnimeSummaryDto {
  return { kitsuId, title, titleEn, posterUrl };
}

function artistCredits(value: unknown): Array<{ name: string; asCharacter: string | null; alias: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const credit = entry as Record<string, unknown>;
    return typeof credit.name === "string"
      ? [{ name: credit.name, asCharacter: stringOrNull(credit.asCharacter), alias: stringOrNull(credit.alias) }]
      : [];
  });
}

function artistNames(value: unknown): MusicTrackDto["artistNames"] {
  return Array.isArray(value) ? value as MusicTrackDto["artistNames"] : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: number | string): number {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : 0;
}

function nullableInteger(value: number | string | null): number | null {
  return value === null ? null : integer(value);
}

function millis(value: Date | string | null): number | null {
  if (value === null) return null;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}
