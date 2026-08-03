import { and, eq, exists, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  animeMusicReleases,
  artists,
  kitsuAnime,
  mediaFiles,
  musicAcquisitions,
  musicReleases,
  releaseTracks,
  songs,
  themeFullSongs,
  themes,
} from "../db/schema.js";
import { catalogSongMediaDescriptor } from "../media/mediaLayout.js";
import { CANONICAL_AUDIO, IMAGE_VARIANT, type MediaState } from "../media/types.js";
import type {
  ImageRouteKind,
  MediaApiRepository,
  MediaAudioRecord,
  MediaImageRecord,
  MediaSongAudioRecord,
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
        loudnessState: mediaFiles.loudnessState,
        loudnessSha256: mediaFiles.loudnessSha256,
        videoFallback: mediaFiles.videoFallback,
      })
      .from(themes)
      .leftJoin(
        mediaFiles,
        and(
          eq(mediaFiles.kind, CANONICAL_AUDIO.kind),
          eq(mediaFiles.refId, String(themeId)),
          eq(mediaFiles.variant, CANONICAL_AUDIO.variant),
        ),
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
      videoFallback: row.videoFallback ?? false,
      loudnessState: row.loudnessState,
      loudnessSha256: row.loudnessSha256,
    };
  }

  async findSongAudio(songId: number): Promise<MediaSongAudioRecord | null> {
    const descriptor = catalogSongMediaDescriptor(songId);
    const publishedFull = this.db
      .select({ songId: themeFullSongs.songId })
      .from(themeFullSongs)
      .innerJoin(songs, and(eq(songs.id, themeFullSongs.songId), isNull(songs.deletedAt)))
      .innerJoin(themes, and(eq(themes.id, themeFullSongs.themeId), isNull(themes.deletedAt)))
      .innerJoin(
        musicReleases,
        and(eq(musicReleases.id, themeFullSongs.sourceReleaseId), isNull(musicReleases.deletedAt)),
      )
      .innerJoin(
        musicAcquisitions,
        and(
          eq(musicAcquisitions.purpose, "FULL_SIZE"),
          eq(musicAcquisitions.state, "READY"),
          eq(musicAcquisitions.themeId, themeFullSongs.themeId),
          eq(musicAcquisitions.songId, themeFullSongs.songId),
          eq(musicAcquisitions.releaseId, themeFullSongs.sourceReleaseId),
        ),
      )
      .where(eq(themeFullSongs.songId, songId));
    const publishedRelated = this.db
      .select({ songId: releaseTracks.songId })
      .from(releaseTracks)
      .innerJoin(songs, and(eq(songs.id, releaseTracks.songId), isNull(songs.deletedAt)))
      .innerJoin(
        musicReleases,
        and(eq(musicReleases.id, releaseTracks.releaseId), isNull(musicReleases.deletedAt)),
      )
      .innerJoin(
        animeMusicReleases,
        eq(animeMusicReleases.releaseId, releaseTracks.releaseId),
      )
      .innerJoin(
        musicAcquisitions,
        and(
          eq(musicAcquisitions.purpose, "RELATED_RELEASE"),
          eq(musicAcquisitions.state, "READY"),
          eq(musicAcquisitions.releaseId, animeMusicReleases.releaseId),
          eq(musicAcquisitions.animethemesAnimeId, animeMusicReleases.animethemesAnimeId),
        ),
      )
      .where(eq(releaseTracks.songId, songId));
    const rows = await this.db
      .select({
        state: mediaFiles.state,
        filePath: mediaFiles.filePath,
        byteSize: mediaFiles.byteSize,
        sha256: mediaFiles.sha256,
        contentType: mediaFiles.contentType,
        sourceFileName: mediaFiles.sourceFileName,
        loudnessState: mediaFiles.loudnessState,
        loudnessSha256: mediaFiles.loudnessSha256,
      })
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.kind, descriptor.kind),
          eq(mediaFiles.refId, descriptor.refId),
          eq(mediaFiles.variant, descriptor.variant),
          eq(mediaFiles.state, "READY"),
          or(exists(publishedFull), exists(publishedRelated)),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      songId,
      state: mediaState(row.state),
      filePath: row.filePath,
      byteSize: row.byteSize,
      sha256: row.sha256,
      contentType: row.contentType,
      sourceFileName: row.sourceFileName,
      loudnessState: row.loudnessState,
      loudnessSha256: row.loudnessSha256,
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
      .where(
        and(
          eq(mediaFiles.kind, kind),
          eq(mediaFiles.refId, refId),
          eq(mediaFiles.variant, IMAGE_VARIANT),
        ),
      )
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
