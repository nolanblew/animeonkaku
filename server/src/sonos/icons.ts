import sharp from "sharp";

export const SONOS_ICON_NAMES = [
  "root", "anime", "playlists", "liked", "search", "fallback",
  "playlist-0", "playlist-1", "playlist-2", "playlist-3",
] as const;

export type SonosIconName = (typeof SONOS_ICON_NAMES)[number];

const LINE = 'fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';
const FACE = `<path ${LINE} d="M43 52c4-17 11-25 21-25s18 8 22 25l-12-8-10 10-10-10-11 8Z"/><path ${LINE} d="M45 56v8c0 13 8 22 19 22s19-9 19-22v-8M55 62h1m16 0h1M58 73c4 3 8 3 12 0"/><path ${LINE} d="M38 106c3-15 13-23 26-23s23 8 26 23"/>`;

function icon(extra: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${FACE}${extra}</svg>`;
}

const SONOS_ICON_SVGS: Record<SonosIconName, string> = {
  root: icon(`<path ${LINE} d="M38 61c-8 0-12 6-12 14s4 14 12 14V61Zm52 0c8 0 12 6 12 14s-4 14-12 14V61ZM28 61c2-23 15-38 36-38s34 15 36 38"/>`),
  anime: icon(`<path ${LINE} d="m96 25 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z"/>`),
  playlists: icon(`<path ${LINE} d="M91 48h22m-22 13h22m-22 13h15"/>`),
  liked: icon(`<path ${LINE} d="M96 77 84 66c-8-8 3-19 12-9 9-10 20 1 12 9L96 77Z"/>`),
  search: icon(`<circle ${LINE} cx="98" cy="59" r="13"/><path ${LINE} d="m108 69 11 11"/>`),
  fallback: icon(`<path ${LINE} d="M96 44v30m0-30 18-5v27M96 74c-8-3-15 0-15 6s8 8 15 2m18-16c-8-3-15 0-15 6s8 8 15 2"/>`),
  "playlist-0": icon(`<path ${LINE} d="M91 48h22m-22 13h22m-22 13h15"/>`),
  "playlist-1": icon(`<path ${LINE} d="M91 47h20m-20 13h14m-14 13h20"/>`),
  "playlist-2": icon(`<path ${LINE} d="M92 45v29m0-29 19-5v26m-19 8c-8-3-14 0-14 6s7 8 14 2m19-16c-8-3-14 0-14 6s7 8 14 2"/>`),
  "playlist-3": icon(`<path ${LINE} d="M96 77 84 66c-8-8 3-19 12-9 9-10 20 1 12 9L96 77Z"/>`),
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
    // Legacy Sonos clients render a transparent PNG against an unpredictable
    // surface. Keep the SVG variants transparent and white, but give the PNG
    // an opaque black canvas so the white anime line art remains visible on
    // dark speaker and controller UIs.
    const source = svg.replace(/(<svg\b[^>]*>)/, "$1<rect width=\"128\" height=\"128\" fill=\"#000\"/>");
    pending = sharp(Buffer.from(source, "utf8"))
      .resize(80, 80, { fit: "contain" })
      .png()
      .toBuffer();
    legacyPngs.set(iconName, pending);
  }
  return pending;
}

export function sonosIconUrl(origin: string, name: SonosIconName): string {
  return `${origin}/sonos/icons/${name}_legacy.png`;
}

export function playlistIconName(playlistId: number): SonosIconName {
  const variant = ((playlistId % 4) + 4) % 4;
  return `playlist-${variant}` as SonosIconName;
}
