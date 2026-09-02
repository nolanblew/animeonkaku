import sharp from "sharp";

export const SONOS_ICON_NAMES = [
  "root", "anime", "playlists", "liked", "search", "fallback",
  "playlist-0", "playlist-1", "playlist-2", "playlist-3",
] as const;

export type SonosIconName = (typeof SONOS_ICON_NAMES)[number];
const SONOS_ICON_VERSION = "v4";

const STROKE = 'fill="none" stroke="#6C63FF" stroke-linecap="round" stroke-linejoin="round"';
const FILL = 'fill="#6C63FF"';

// A compact, original chibi mascot derived from the generated Sonos concept
// sheet. The strong outer silhouette and deliberately sparse facial detail stay
// readable in Sonos' smallest 40 px browse-icon slot.
const MASCOT = `<g id="ongaku-mascot" data-character="ongaku-mascot">
  <path ${FILL} fill-rule="evenodd" d="M28 58c0-12 4-24 12-32l-4-15 18 8c4-2 9-3 14-3s10 1 14 3l18-8-4 16c7 8 11 19 11 31v20c0 19-16 34-39 34S28 97 28 78V58Zm15-19c-4 6-6 13-6 21v17c0 14 12 25 31 25s31-11 31-25V60c0-8-2-15-6-21L82 28l-5 8c-6-3-12-4-19-3-7 1-12 4-15 6Z"/>
  <path ${STROKE} d="M36 61c-9 0-14 6-14 15s5 15 14 15V61Zm63 0c9 0 14 6 14 15s-5 15-14 15V61ZM22 62c2-25 18-42 46-42s44 17 46 42"/>
  <path ${FILL} d="M48 68a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm39 0a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/>
  <path ${STROKE} stroke-width="5" d="M57 84c6 5 15 5 21 0"/>
</g>`;

function icon(extra: string, mascot = MASCOT): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" stroke-width="6">${mascot}${extra}</svg>`;
}

const SONOS_ICON_SVGS: Record<SonosIconName, string> = {
  root: icon(`<path ${STROKE} d="M10 39c-5 7-7 15-7 24m115-24c5 7 7 15 7 24M14 104l9-9m91 9-9-9"/>`),
  anime: icon(`<path ${FILL} d="m103 12 4 11 11 4-11 4-4 11-4-11-11-4 11-4 4-11Zm-82 13 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z"/>`),
  playlists: icon(`<g transform="translate(78 76)"><rect ${FILL} x="8" y="-16" width="35" height="29" rx="5"/><rect ${STROKE} x="0" y="-8" width="35" height="29" rx="5"/></g>`),
  liked: icon(`<path ${FILL} d="M101 102 82 85c-13-12 5-30 19-14 14-16 32 2 19 14l-19 17Z"/>`),
  search: icon(`<g transform="translate(98 91)"><circle ${STROKE} stroke-width="8" cx="0" cy="0" r="15"/><path ${STROKE} stroke-width="8" d="m11 11 17 17"/></g>`),
  fallback: icon(`<path ${STROKE} stroke-width="7" d="M96 64V31l23-5v30M96 64c-11-3-19 1-19 9s10 10 19 3m23-20c-11-3-19 1-19 9s10 10 19 3"/>`),
  "playlist-0": icon(`<g transform="translate(79 78)"><rect ${FILL} x="7" y="-15" width="34" height="28" rx="5"/><rect ${STROKE} x="0" y="-7" width="34" height="28" rx="5"/></g>`),
  "playlist-1": icon(`<path ${FILL} d="M101 103 82 86c-13-12 5-30 19-14 14-16 32 2 19 14l-19 17Z"/>`),
  "playlist-2": icon(`<path ${STROKE} stroke-width="7" d="M96 66V34l22-5v28M96 66c-11-3-19 1-19 9s10 10 19 3m22-21c-10-3-18 1-18 9s9 10 18 3"/>`),
  "playlist-3": icon(`<path ${FILL} d="m102 66 5 13 13 5-13 5-5 13-5-13-13-5 13-5 5-13Z"/>`),
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
      .replace(/(<svg\b[^>]*>)/, "$1<rect width=\"128\" height=\"128\" fill=\"#000\"/>");
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
