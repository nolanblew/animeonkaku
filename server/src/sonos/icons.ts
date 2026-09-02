import sharp from "sharp";
import { TRACED_SONOS_ICON_SVGS } from "./vectorIconData.js";

export const SONOS_ICON_NAMES = [
  "root", "anime", "playlists", "liked", "search", "fallback",
  "playlist-0", "playlist-1", "playlist-2", "playlist-3",
] as const;

export type SonosIconName = (typeof SONOS_ICON_NAMES)[number];
const SONOS_ICON_VERSION = "v5";

// The generated reference contains six category illustrations. Playlist
// variants reuse four approved drawings so playlists stay visually distinct.
const SONOS_ICON_SVGS: Record<SonosIconName, string> = {
  ...TRACED_SONOS_ICON_SVGS,
  "playlist-0": TRACED_SONOS_ICON_SVGS.playlists,
  "playlist-1": TRACED_SONOS_ICON_SVGS.liked,
  "playlist-2": TRACED_SONOS_ICON_SVGS.fallback,
  "playlist-3": TRACED_SONOS_ICON_SVGS.anime,
};

const legacyPngs = new Map<SonosIconName, Promise<Buffer>>();

export function sonosIconSvg(name: string): string | undefined {
  return SONOS_ICON_SVGS[name as SonosIconName];
}

export function sonosLegacyIconPng(name: string): Promise<Buffer> | undefined {
  const iconName = name as SonosIconName;
  const svg = SONOS_ICON_SVGS[iconName];
  if (!svg) return undefined;
  let pending = legacyPngs.get(iconName);
  if (!pending) {
    const source = svg
      .replaceAll("#6C63FF", "#fff")
      .replace(/(<svg\b[^>]*>)/, "$1<rect width=\"100%\" height=\"100%\" fill=\"#000\"/>");
    pending = sharp(Buffer.from(source, "utf8"))
      .resize(80, 80, { fit: "contain" })
      .png()
      .toBuffer();
    legacyPngs.set(iconName, pending);
  }
  return pending;
}

export function sonosIconUrl(origin: string, name: SonosIconName): string {
  return `${origin}/sonos/icons/${name}_${SONOS_ICON_VERSION}_legacy.png`;
}

export function playlistIconName(playlistId: number): SonosIconName {
  const variant = ((playlistId % 4) + 4) % 4;
  return `playlist-${variant}` as SonosIconName;
}
