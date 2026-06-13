import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { artists, kitsuAnime, themes } from "../db/schema.js";
import type { MediaKind } from "./types.js";

export interface ThemeAudioSource {
  themeId: number;
  audioOriginUrl: string;
  videoOriginUrl: string | null;
}

export interface ImageSource {
  kind: Exclude<MediaKind, "AUDIO">;
  refId: string;
  originUrl: string;
}

export interface MediaCatalogLookup {
  findThemeAudio(themeId: number): Promise<ThemeAudioSource | null>;
  findImage(kind: Exclude<MediaKind, "AUDIO">, refId: string): Promise<ImageSource | null>;
}

export class DrizzleMediaCatalogLookup implements MediaCatalogLookup {
  constructor(private readonly db: Db) {}

  async findThemeAudio(themeId: number): Promise<ThemeAudioSource | null> {
    const rows = await this.db
      .select({
        themeId: themes.id,
        audioOriginUrl: themes.audioOriginUrl,
        videoOriginUrl: themes.videoOriginUrl,
      })
      .from(themes)
      .where(eq(themes.id, themeId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findImage(kind: Exclude<MediaKind, "AUDIO">, refId: string): Promise<ImageSource | null> {
    if (kind === "ARTIST_IMAGE") {
      const rows = await this.db
        .select({ originUrl: artists.imageUrl })
        .from(artists)
        .where(eq(artists.slug, refId))
        .limit(1);
      const originUrl = rows[0]?.originUrl;
      return originUrl ? { kind, refId, originUrl } : null;
    }

    const rows = await this.db
      .select({
        posterUrl: kitsuAnime.posterUrl,
        coverUrl: kitsuAnime.coverUrl,
      })
      .from(kitsuAnime)
      .where(eq(kitsuAnime.kitsuId, refId))
      .limit(1);
    const row = rows[0];
    const originUrl = kind === "ANIME_POSTER" ? row?.posterUrl : row?.coverUrl;
    return originUrl ? { kind, refId, originUrl } : null;
  }
}

