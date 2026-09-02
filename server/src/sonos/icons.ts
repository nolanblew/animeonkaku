/**
 * The Sonos browse client asks for album art before it knows anything about
 * the user's catalog. Keep these assets local, deterministic, and deliberately
 * boring: a dark canvas and a high-contrast white badge remain legible on
 * speaker displays and in both light and dark Sonos clients.
 *
 * Do not turn these into user-provided SVGs. The exported lookup is the
 * allow-list used by the public route in routes.ts.
 */

export const SONOS_ICON_NAMES = [
  "root",
  "anime",
  "playlists",
  "liked",
  "search",
  "fallback",
  "playlist-0",
  "playlist-1",
  "playlist-2",
  "playlist-3",
] as const;

export type SonosIconName = (typeof SONOS_ICON_NAMES)[number];

const BACKGROUND = "#0b1020";
const INK = "#111827";

function badge(content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" shape-rendering="geometricPrecision"><rect width="128" height="128" rx="18" fill="${BACKGROUND}"/><circle cx="64" cy="64" r="46" fill="#fff"/>${content}</svg>`;
}

// These are simple character-like silhouettes rather than text or external
// artwork. Avoid adding gradients, masks, raster images, or user data here:
// Sonos caches these responses and some players have a very small SVG subset.
const SONOS_ICON_SVGS: Record<SonosIconName, string> = {
  root: badge(`<path fill="${INK}" d="M38 103c3-18 13-28 26-28s23 10 26 28H38Z"/><path fill="${INK}" d="M43 59c0-16 9-27 21-27s21 11 21 27c0 12-9 21-21 21S43 71 43 59Z"/><path fill="${INK}" d="m42 51 8-20 10 11 9-15 17 25-13-7-10 8-11-8-10 6Z"/><circle cx="56" cy="60" r="3" fill="#fff"/><circle cx="72" cy="60" r="3" fill="#fff"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="3" d="M58 70c4 3 8 3 12 0"/>`),
  anime: badge(`<path fill="${INK}" d="M38 104c3-17 13-27 26-27s23 10 26 27H38Z"/><path fill="${INK}" d="M42 59c0-18 10-29 22-29s22 11 22 29c0 13-9 23-22 23S42 72 42 59Z"/><path fill="${INK}" d="m40 57 6-26 12 12 8-17 22 24-13-4-9 9-12-8-14 10Z"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="4" d="M53 61h1m20 0h1"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="3" d="M57 72c5 4 9 4 14 0"/>`),
  playlists: badge(`<path fill="${INK}" d="M37 104c3-17 13-27 27-27s24 10 27 27H37Z"/><path fill="${INK}" d="M44 59c0-15 8-25 20-25s20 10 20 25c0 13-8 22-20 22S44 72 44 59Z"/><path fill="${INK}" d="M43 53c4-17 12-25 22-25 9 0 18 8 22 25l-13-8-9 9-10-9-12 8Z"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="4" d="M54 58h1m18 0h1M58 70c4 3 8 3 12 0"/><path fill="none" stroke="${INK}" stroke-linecap="round" stroke-width="5" d="M31 39h15m-15 9h15m-15 9h8"/>`),
  liked: badge(`<path fill="${INK}" d="M38 104c3-17 13-27 26-27s23 10 26 27H38Z"/><path fill="${INK}" d="M43 58c0-16 9-27 21-27s21 11 21 27c0 13-9 22-21 22S43 71 43 58Z"/><path fill="${INK}" d="M43 51c4-16 11-23 21-23s18 7 21 23l-11-8-10 9-10-9-11 8Z"/><path fill="#fff" d="m64 72-13-12c-8-8 3-19 11-10 8-9 19 2 11 10L64 72Z"/>`),
  search: badge(`<path fill="${INK}" d="M38 104c3-17 13-27 26-27s23 10 26 27H38Z"/><path fill="${INK}" d="M43 58c0-16 9-27 21-27s21 11 21 27c0 13-9 22-21 22S43 71 43 58Z"/><path fill="${INK}" d="M42 51c3-16 11-24 22-24 10 0 18 8 21 24l-12-8-9 9-10-9-12 8Z"/><circle cx="64" cy="57" r="13" fill="none" stroke="#fff" stroke-width="5"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="5" d="m74 67 12 12"/>`),
  fallback: badge(`<path fill="${INK}" d="M37 104c3-17 13-27 27-27s24 10 27 27H37Z"/><path fill="${INK}" d="M43 59c0-16 9-27 21-27s21 11 21 27c0 13-9 22-21 22S43 72 43 59Z"/><path fill="${INK}" d="m40 54 9-25 15 12 15-12 9 25-12-9-12 10-12-10-12 9Z"/><circle cx="56" cy="60" r="3" fill="#fff"/><circle cx="72" cy="60" r="3" fill="#fff"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="3" d="M57 71h14"/>`),
  "playlist-0": badge(`<path fill="${INK}" d="M38 104c3-17 13-27 26-27s23 10 26 27H38Z"/><path fill="${INK}" d="M43 59c0-16 9-27 21-27s21 11 21 27c0 13-9 22-21 22S43 72 43 59Z"/><path fill="${INK}" d="m41 52 8-24 15 14 15-14 8 24-12-8-11 10-11-10-12 8Z"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="3" d="M55 60h2m14 0h2M57 71c5 3 9 3 14 0"/><path fill="none" stroke="${INK}" stroke-width="5" d="M30 42h16m-16 10h11"/>`),
  "playlist-1": badge(`<path fill="${INK}" d="M37 104c3-17 13-27 27-27s24 10 27 27H37Z"/><path fill="${INK}" d="M44 59c0-15 8-25 20-25s20 10 20 25c0 13-8 22-20 22S44 72 44 59Z"/><path fill="${INK}" d="m42 52 8-25 14 15 14-15 8 25-11-8-11 11-11-11-11 8Z"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="4" d="M54 60h2m16 0h2M58 71c4 3 8 3 12 0"/><path fill="none" stroke="${INK}" stroke-linecap="round" stroke-width="5" d="M31 43h15m-15 10h15m-15 10h8"/>`),
  "playlist-2": badge(`<path fill="${INK}" d="M38 104c3-17 13-27 26-27s23 10 26 27H38Z"/><path fill="${INK}" d="M43 59c0-17 9-28 21-28s21 11 21 28c0 13-9 22-21 22S43 72 43 59Z"/><path fill="${INK}" d="m40 53 10-26 14 15 14-15 10 26-13-8-11 11-11-11-13 8Z"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="4" d="M54 60h2m16 0h2M58 71c4 3 8 3 12 0"/><path fill="none" stroke="${INK}" stroke-linecap="round" stroke-width="5" d="M31 43h15m-15 10h10"/>`),
  "playlist-3": badge(`<path fill="${INK}" d="M37 104c3-17 13-27 27-27s24 10 27 27H37Z"/><path fill="${INK}" d="M44 59c0-16 8-27 20-27s20 11 20 27c0 13-8 22-20 22S44 72 44 59Z"/><path fill="${INK}" d="m42 52 8-24 14 14 14-14 8 24-11-8-11 10-11-10-11 8Z"/><path fill="none" stroke="#fff" stroke-linecap="round" stroke-width="4" d="M54 60h2m16 0h2M58 71c4 3 8 3 12 0"/><path fill="none" stroke="${INK}" stroke-linecap="round" stroke-width="5" d="M31 43h15m-15 10h15m-15 10h15"/>`),
};

export function sonosIconSvg(name: string): string | undefined {
  return SONOS_ICON_SVGS[name as SonosIconName];
}

export function sonosIconUrl(origin: string, name: SonosIconName): string {
  return `${origin}/sonos/icons/${name}.svg`;
}

/** Pick one of the fixed playlist silhouettes without using playlist text. */
export function playlistIconName(playlistId: number): SonosIconName {
  const variant = ((playlistId % 4) + 4) % 4;
  return `playlist-${variant}` as SonosIconName;
}
