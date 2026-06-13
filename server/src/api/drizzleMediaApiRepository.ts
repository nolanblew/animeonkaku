import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { artists, kitsuAnime, mediaFiles, themes } from "../db/schema.js";
import type { MediaState } from "../media/types.js";
import type {
  ImageRouteKind,
  MediaApiRepository,
  MediaAudioRecord,
  MediaImageRecord,
} from "./mediaRoutes.js";

export class DrizzleMediaApiRepository implements MediaApiRepository {
  constructor(private readonly db: Db) {}

  async findAudio(themeId: number): Promise<MediaAudioRecord | null> {
    const rows = await this.db
      .select({
        themeId: themes.id,
        originUrl: themes.audioOriginUrl,
        state: mediaFiles.state,
        filePath: mediaFiles.filePath,
        byteSize: mediaFiles.byteSize,
        sha256: mediaFiles.sha256,
      })
      .from(themes)
      .leftJoin(
        mediaFiles,
        and(eq(mediaFiles.kind, "AUDIO"), eq(mediaFiles.refId, String(themeId))),
      )
      .where(eq(themes.id, themeId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      themeId: row.themeId,
      originUrl: row.originUrl,
      state: mediaState(row.state),
      filePath: row.filePath,
      byteSize: row.byteSize,
      sha256: row.sha256,
    };
  }

  async findImage(kind: ImageRouteKind, refId: string): Promise<MediaImageRecord | null> {
    const originUrl = await this.findImageOrigin(kind, refId);
    if (!originUrl) return null;
    const rows = await this.db
      .select({
        state: mediaFiles.state,
        filePath: mediaFiles.filePath,
        sha256: mediaFiles.sha256,
      })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.kind, kind), eq(mediaFiles.refId, refId)))
      .limit(1);
    const row = rows[0];
    return {
      originUrl,
      state: mediaState(row?.state),
      filePath: row?.filePath ?? null,
      sha256: row?.sha256 ?? null,
    };
  }

  private async findImageOrigin(kind: ImageRouteKind, refId: string): Promise<string | null> {
    if (kind === "ARTIST_IMAGE") {
      const rows = await this.db
        .select({ originUrl: artists.imageUrl })
        .from(artists)
        .where(eq(artists.slug, refId))
        .limit(1);
      return rows[0]?.originUrl ?? null;
    }

    const rows = await this.db
      .select({
        posterUrl: kitsuAnime.posterUrl,
        posterUrlLarge: kitsuAnime.posterUrlLarge,
        coverUrl: kitsuAnime.coverUrl,
        coverUrlLarge: kitsuAnime.coverUrlLarge,
      })
      .from(kitsuAnime)
      .where(eq(kitsuAnime.kitsuId, refId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (kind === "ANIME_POSTER") return row.posterUrlLarge ?? row.posterUrl;
    return row.coverUrlLarge ?? row.coverUrl;
  }
}

function mediaState(state: string | null | undefined): MediaState {
  if (
    state === "READY" ||
    state === "QUEUED" ||
    state === "DOWNLOADING" ||
    state === "FAILED" ||
    state === "MISSING"
  ) {
    return state;
  }
  return "MISSING";
}
