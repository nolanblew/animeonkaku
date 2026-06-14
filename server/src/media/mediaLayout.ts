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
