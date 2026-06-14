import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { artists, kitsuAnime, themes } from "../db/schema.js";
import { CANONICAL_AUDIO, type MediaKind, type MediaVariant } from "./types.js";

export interface ThemeAudioSource {
  themeId: number;
  audioOriginUrl: string;
  videoOriginUrl: string | null;
}

/** One downloadable media variant available for a theme, with its origin URL. */
export interface ThemeMediaSource {
  themeId: number;
  kind: Extract<MediaKind, "AUDIO" | "VIDEO">;
  variant: MediaVariant;
  originUrl: string;
  videoFallback: boolean;
}

export interface ImageSource {
  kind: Exclude<MediaKind, "AUDIO" | "VIDEO">;
  refId: string;
  originUrl: string;
}

export interface MediaCatalogLookup {
  findThemeAudio(themeId: number): Promise<ThemeAudioSource | null>;
  /**
   * Enumerate every media variant a theme can currently supply, derived from its
   * catalog origin URLs. Today: the canonical (AUDIO, SHORT), plus (VIDEO, FULL)
   * when a distinct video origin exists. Future variants (e.g. AUDIO/FULL) plug in
   * here as new origin sources land — see .planning/09-media-variants.md.
   */
  listThemeMediaSources(themeId: number): Promise<ThemeMediaSource[]>;
  findImage(
    kind: Exclude<MediaKind, "AUDIO" | "VIDEO">,
    refId: string,
  ): Promise<ImageSource | null>;
}

/**
 * Pure derivation of a theme's available media variants from its origin URLs.
 * Kept separate from the DB query so it is unit-testable and so new variant
 * sources can be added in one obvious place.
 */
export function deriveThemeMediaSources(source: ThemeAudioSource): ThemeMediaSource[] {
  const sources: ThemeMediaSource[] = [];
  const usesVideoAsAudio =
    source.videoOriginUrl !== null && source.audioOriginUrl === source.videoOriginUrl;

  // Canonical short audio — always present (themes.audio_origin_url is NOT NULL).
  sources.push({
    themeId: source.themeId,
    kind: CANONICAL_AUDIO.kind,
    variant: CANONICAL_AUDIO.variant,
    originUrl: source.audioOriginUrl,
    videoFallback: usesVideoAsAudio,
  });

  // The full opening video, when a distinct video origin exists (not the audio fallback).
  if (source.videoOriginUrl !== null && !usesVideoAsAudio) {
    sources.push({
      themeId: source.themeId,
      kind: "VIDEO",
      variant: "FULL",
      originUrl: source.videoOriginUrl,
      videoFallback: false,
    });
  }

  return sources;
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

  async listThemeMediaSources(themeId: number): Promise<ThemeMediaSource[]> {
    const audio = await this.findThemeAudio(themeId);
    return audio ? deriveThemeMediaSources(audio) : [];
  }

  async findImage(
    kind: Exclude<MediaKind, "AUDIO" | "VIDEO">,
    refId: string,
  ): Promise<ImageSource | null> {
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
