import type { MediaKind, MediaVariant } from "./types.js";

/**
 * On-disk path (relative to MEDIA_ROOT) for a theme media variant.
 *
 * The canonical short audio path `audio/{themeId}.ogg` is FROZEN — changing it
 * would orphan every already-cached file and break offline copies. New variants
 * get their own suffixed paths so they never collide with it.
 *
 * Image kinds are laid out separately (see fetchHandlers.imageFilePath).
 */
export function themeMediaFilePath(
  kind: Extract<MediaKind, "AUDIO" | "VIDEO">,
  variant: MediaVariant,
  themeId: string,
): string {
  if (kind === "AUDIO") {
    // Frozen canonical path for the short cut.
    if (variant === "SHORT") return `audio/${themeId}.ogg`;
    return `audio/${themeId}.${variant.toLowerCase()}.ogg`;
  }
  // VIDEO: the full opening video is the primary video; shorter cuts get a suffix.
  if (variant === "FULL") return `video/${themeId}.webm`;
  return `video/${themeId}.${variant.toLowerCase()}.webm`;
}

export function catalogSongRefId(songId: number): string {
  assertSongId(songId);
  return `song:${songId}`;
}

export function catalogSongMediaDescriptor(songId: number) {
  return {
    kind: "AUDIO",
    refId: catalogSongRefId(songId),
    variant: "ORIGINAL",
  } as const;
}

export function catalogSongMediaFilePath(songId: number, safeExtension: string): string {
  assertSongId(songId);
  if (!/^[a-z0-9]+$/.test(safeExtension)) {
    throw new Error("Invalid catalog-song media extension.");
  }
  return `audio/songs/${songId}/original.${safeExtension}`;
}

function assertSongId(songId: number): void {
  if (!Number.isSafeInteger(songId) || songId <= 0) {
    throw new Error("Invalid catalog song ID.");
  }
}
