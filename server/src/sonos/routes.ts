import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthService, LoginResult } from "../auth/service.js";
import type {
  AnimeMusicDto,
  ClientApiService,
  LibraryAnimeDto,
  LibraryThemeDto,
  MusicTrackDto,
  PlaylistDto,
  PlaylistItemDto,
  SongPrefDto,
  ThemePrefDto,
} from "../api/clientRoutes.js";
import { playlistIconName, sonosIconSvg, sonosIconUrl, sonosLegacyIconPng, type SonosIconName } from "./icons.js";

const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";
const SMAPI_NS = "http://www.sonos.com/Services/1.1";
export const SONOS_BODY_LIMIT = 256 * 1024;
const LINK_TTL_MS = 10 * 60_000;
const MAX_LINK_FAILURES = 5;
const SONOS_SEARCH_CATEGORIES = [
  { id: "all", title: "All" },
  { id: "albums", title: "Albums" },
  { id: "playlists", title: "Playlists" },
  { id: "tracks", title: "Tracks" },
] as const;
// Sonos requires a privateKey in the browser-link success response even when
// the service does not implement refresh tokens. It is an opaque sentinel, not
// a credential, and Sonos only passes it back during a future refresh flow.
const NO_REFRESH_PRIVATE_KEY = "alwaysReauthenticate";

export interface SonosRouteOptions {
  publicOrigin: string;
  now?: (() => number) | undefined;
  generateCode?: (() => string) | undefined;
  onLogin?: ((result: LoginResult) => Promise<void>) | undefined;
}

interface LinkState {
  code: string;
  householdId: string;
  linkDeviceId: string;
  expiresAt: number;
  failures: number;
  token?: string;
  userId?: string;
  username?: string;
  consumed: boolean;
  revoked: boolean;
}

interface Catalog {
  anime: LibraryAnimeDto[];
  themes: LibraryThemeDto[];
  playlists: PlaylistDto[];
  themePrefs: ThemePrefDto[];
  songPrefs: SongPrefDto[];
  music: AnimeMusicDto[];
}

interface SonosEntry {
  id: string;
  title: string;
  kind: "container" | "track";
  collectionType?: "album" | "albumList" | "container" | "playlist" | "search" | "trackList";
  readOnly?: boolean;
  userContent?: boolean;
  canPlay?: boolean;
  canEnumerate?: boolean;
  album?: string;
  artist?: string;
  duration?: number | null;
  mimeType?: string;
  artwork?: string | null;
}

class SoapFault extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 500) {
    super(message);
  }
}

export function registerSonosRoutes(
  app: FastifyInstance,
  auth: AuthService,
  client: ClientApiService,
  options: SonosRouteOptions,
): void {
  const now = options.now ?? Date.now;
  const generateCode = options.generateCode ?? (() => randomBytes(15).toString("base64url"));
  const origin = new URL(options.publicOrigin).origin;
  const links = new Map<string, LinkState>();
  const catalogVersion = String(Math.floor(now() / 1000));

  if (!app.hasContentTypeParser("text/xml")) {
    app.addContentTypeParser(["text/xml", "application/soap+xml"], { parseAs: "string" }, (_request, body, done) => done(null, body));
  }
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => done(null, body));
  }
  app.get("/sonos/icons/:asset", async (request, reply) => {
    const asset = (request.params as { asset?: unknown }).asset;
    const match = typeof asset === "string" ? /^([a-z0-9-]+)_(?:v\d+_)?(?:(40|290)\.svg|legacy\.png)$/.exec(asset) : null;
    if (!match) return reply.code(404).send();
    reply.header("cache-control", "public, max-age=31536000, immutable");
    if (match[2]) {
      const svg = sonosIconSvg(match[1]!);
      return svg ? reply.type("image/svg+xml; charset=utf-8").send(svg) : reply.code(404).send();
    }
    const png = sonosLegacyIconPng(match[1]!);
    if (!png) return reply.code(404).send();
    return reply.type("image/png").send(await png);
  });


  app.post("/sonos/smapi", { bodyLimit: SONOS_BODY_LIMIT }, async (request, reply) => {
    try {
      const xml = typeof request.body === "string" ? request.body : "";
      const action = parseSoap(xml, request.headers.soapaction);
      let result: string;
      if (action.method === "getLastUpdate") {
        let favoritesVersion = "1";
        const token = extractAuthToken(xml, request.headers.authorization);
        if (token) {
          const context = await auth.authenticate(token);
          if (context) favoritesVersion = versionToken(await loadCatalog(client, context.user.kitsuUserId));
        }
        result = `<getLastUpdateResult><catalog>${catalogVersion}</catalog><favorites>${favoritesVersion}</favorites><pollInterval>60</pollInterval></getLastUpdateResult>`;
      } else if (action.method === "getAppLink") {
        const householdId = requiredTag(xml, "householdId");
        // Current Sonos requests do not provide linkDeviceId. The service
        // returns this hidden anti-phishing value and Sonos echoes it while
        // polling getDeviceAuthToken.
        const linkDeviceId = tag(xml, "linkDeviceId") ?? randomBytes(18).toString("base64url");
        let code = generateCode().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
        if (!code) code = randomBytes(12).toString("base64url");
        if (links.has(code)) throw new SoapFault("Server.InternalError", "Unable to create a unique link code.");
        links.set(code, { code, householdId, linkDeviceId, expiresAt: now() + LINK_TTL_MS,
          failures: 0, consumed: false, revoked: false });
        const regUrl = `${origin}/sonos/link?linkCode=${encodeURIComponent(code)}`;
        result = `<getAppLinkResult><authorizeAccount><deviceLink><regUrl>${escapeXml(regUrl)}</regUrl><linkCode>${escapeXml(code)}</linkCode><showLinkCode>true</showLinkCode><linkDeviceId>${escapeXml(linkDeviceId)}</linkDeviceId></deviceLink></authorizeAccount></getAppLinkResult>`;
      } else if (action.method === "getDeviceAuthToken") {
        const state = validDeviceLink(links, requiredTag(xml, "linkCode"), now());
        if (state.householdId !== requiredTag(xml, "householdId") || state.linkDeviceId !== requiredTag(xml, "linkDeviceId")) {
          throw new SoapFault("Client.AuthTokenExpired", "This link code belongs to a different Sonos device.");
        }
        if (!state.token || !state.userId || !state.username) {
          throw new SoapFault("Client.NOT_LINKED_RETRY", "Account linking is not complete yet.");
        }
        if (state.consumed) throw new SoapFault("Client.AuthTokenExpired", "This link result has already been consumed.");
        state.consumed = true;
        const userHash = createHash("sha256").update(state.userId, "utf8").digest("base64url");
        result = `<getDeviceAuthTokenResult><authToken>${escapeXml(state.token)}</authToken><privateKey>${NO_REFRESH_PRIVATE_KEY}</privateKey><userInfo><userIdHashCode>${escapeXml(userHash)}</userIdHashCode><nickname>${escapeXml(state.username.slice(0, 32))}</nickname></userInfo></getDeviceAuthTokenResult>`;
      } else {
        if (!["getMetadata", "getMediaMetadata", "getExtendedMetadata", "getMediaURI", "search"].includes(action.method)) {
          throw new SoapFault("Client.UnsupportedRequest", `Unsupported SMAPI method: ${action.method}`);
        }
        const token = extractAuthToken(xml, request.headers.authorization);
        if (!token) throw new SoapFault("Client.AuthTokenExpired", "Authentication is required.");
        const context = await auth.authenticate(token);
        if (!context) throw new SoapFault("Client.AuthTokenExpired", "The device session is no longer valid.");
        const userId = context.user.kitsuUserId;
        if (action.method === "getMetadata") {
          const catalog = await loadCatalog(client, userId);
          const id = tag(xml, "id") ?? "root";
          const entries = browse(catalog, id, origin);
          result = resultPage("getMetadata", entries, pageIndex(xml), pageCount(xml));
        } else if (action.method === "search") {
          const catalog = await loadCatalog(client, userId);
          const entries = search(catalog, tag(xml, "id") ?? "all", tag(xml, "term") ?? "", origin);
          result = resultPage("search", entries, pageIndex(xml), pageCount(xml));
        } else if (["getMediaMetadata", "getExtendedMetadata", "getMediaURI"].includes(action.method)) {
          const catalog = await loadCatalog(client, userId);
          const id = requiredTag(xml, "id");
          const resolved = resolveTrack(catalog, id, origin);
          if (action.method === "getMediaMetadata") {
            if (!resolved) throw new SoapFault("Client.ItemNotFound", "The requested track is not available.");
            result = `<getMediaMetadataResult>${entryXml(resolved.entry)}</getMediaMetadataResult>`;
          } else if (action.method === "getExtendedMetadata") {
            const entry = resolved?.entry ?? resolveCollection(catalog, id, origin);
            if (!entry) throw new SoapFault("Client.ItemNotFound", "The requested item is not available.");
            result = `<getExtendedMetadataResult>${entryXml(entry)}</getExtendedMetadataResult>`;
          } else {
            if (!resolved) throw new SoapFault("Client.ItemNotFound", "The requested track is not available.");
            result = `<getMediaURIResult>${escapeXml(resolved.uri)}</getMediaURIResult><httpHeaders><httpHeader><header>Authorization</header><value>Bearer ${escapeXml(token)}</value></httpHeader></httpHeaders>`;
          }
        } else {
          throw new SoapFault("Client.UnsupportedRequest", `Unsupported SMAPI method: ${action.method}`);
        }
      }
      return sendSoap(reply, action.method, result);
    } catch (error) {
      const fault = error instanceof SoapFault ? error : new SoapFault("Client.BadRequest", "Malformed SOAP request.");
      return sendFault(reply, fault.status, fault.code, fault.message);
    }
  });

  app.get("/sonos/link", async (request, reply) => {
    const code = queryCode(request.url);
    let state: LinkState;
    try { state = validLink(links, code, now()); }
    catch { return reply.code(410).type("text/html; charset=utf-8").send(expiredPage()); }
    return reply.type("text/html; charset=utf-8").send(linkPage(state.code));
  });

  app.post("/sonos/link", async (request, reply) => {
    const input = parseLinkBody(request.body);
    let state: LinkState;
    try { state = validLink(links, input.linkCode, now()); }
    catch { return reply.code(410).type("text/html; charset=utf-8").send(expiredPage()); }
    if (state.token) return reply.code(409).type("text/html; charset=utf-8").send(messagePage("Already linked", "Return to the Sonos app to finish setup."));
    try {
      const result = await auth.login({ username: input.username, password: input.password, deviceName: "Sonos" });
      try {
        await options.onLogin?.(result);
      } catch (error) {
        const context = await auth.authenticate(result.token);
        if (context) await auth.logout(context);
        throw error;
      }
      state.token = result.token; state.userId = result.user.kitsuUserId; state.username = result.user.username;
      if (wantsJson(request.headers.accept)) return reply.send({ linked: true });
      return reply.type("text/html; charset=utf-8").send(messagePage("Connected", "Anime Ongaku is now linked. Return to the Sonos app."));
    } catch {
      state.failures += 1;
      if (state.failures >= MAX_LINK_FAILURES) state.revoked = true;
      const status = state.revoked ? 410 : 401;
      if (wantsJson(request.headers.accept)) return reply.code(status).send({ linked: false, error: state.revoked ? "LINK_REVOKED" : "LOGIN_FAILED" });
      return reply.code(status).type("text/html; charset=utf-8").send(messagePage("Could not connect", state.revoked
        ? "This link code is no longer valid. Start again in the Sonos app."
        : "Check your Kitsu username and password, then try again."));
    }
  });
}

function validLink(links: Map<string, LinkState>, code: string, now: number): LinkState {
  const state = links.get(code);
  if (!state || state.revoked || state.expiresAt <= now) throw new SoapFault("Client.AuthTokenExpired", "Link code expired.");
  return state;
}

function validDeviceLink(links: Map<string, LinkState>, code: string, now: number): LinkState {
  const state = links.get(code);
  if (!state || state.revoked || state.expiresAt <= now) {
    throw new SoapFault("Client.NOT_LINKED_FAILURE", "Account linking failed.");
  }
  return state;
}

function parseSoap(xml: string, actionHeader: string | string[] | undefined): { method: string } {
  if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new SoapFault("Client.BadRequest", "DTD and entities are not allowed.");
  if (!isWellFormedXml(xml)) throw new SoapFault("Client.BadRequest", "Malformed XML.");
  if (!/<(?:\w+:)?Envelope\b/i.test(xml) || !/<(?:\w+:)?Body\b/i.test(xml) || !/<\/(?:\w+:)?Envelope\s*>/i.test(xml)) {
    throw new SoapFault("Client.BadRequest", "Malformed SOAP envelope.");
  }
  const body = /<(?:\w+:)?Body\b[^>]*>\s*<(?:(?:\w+):)?([A-Za-z][\w.-]*)\b/i.exec(xml);
  const method = body?.[1];
  const closesMethod = method && (
    new RegExp(`<\\/(?:\\w+:)?${escapeRegex(method)}\\s*>`, "i").test(xml)
    || new RegExp(`<(?:\\w+:)?${escapeRegex(method)}\\b[^>]*\\/\\s*>`, "i").test(xml)
  );
  if (!method || !closesMethod) throw new SoapFault("Client.BadRequest", "Malformed SOAP body.");
  const raw = Array.isArray(actionHeader) ? actionHeader[0] : actionHeader;
  const action = raw?.replace(/^\s*["']|["']\s*$/g, "").split("#").pop();
  if (action && action !== method) throw new SoapFault("Client.BadRequest", "SOAPAction does not match the request body.");
  return { method };
}

/** Minimal non-expanding well-formedness check for the bounded SMAPI subset. */
function isWellFormedXml(xml: string): boolean {
  const stack: string[] = [];
  const tokens = xml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[A-Za-z_][^<>]*?>/g) ?? [];
  const remainder = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[A-Za-z_][^<>]*?>/g, "");
  if (/[<>]/.test(remainder)) return false;
  for (const token of tokens) {
    if (token.startsWith("<?") || token.startsWith("<!--")) continue;
    const closing = /^<\/([A-Za-z_][\w:.-]*)\s*>$/.exec(token);
    if (closing) { if (stack.pop() !== closing[1]) return false; continue; }
    if (/\/>$/.test(token)) continue;
    const opening = /^<([A-Za-z_][\w:.-]*)(?:\s[^<>]*)?>$/.exec(token);
    if (!opening) return false;
    stack.push(opening[1]!);
  }
  return stack.length === 0;
}

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<(?:\\w+:)?${escapeRegex(name)}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escapeRegex(name)}\\s*>`, "i").exec(xml);
  return match?.[1] === undefined ? undefined : decodeXml(match[1].replace(/<[^>]+>/g, "").trim());
}
function requiredTag(xml: string, name: string): string {
  const value = tag(xml, name); if (!value) throw new SoapFault("Client.BadRequest", `${name} is required.`); return value;
}
function extractAuthToken(xml: string, authorization?: string): string | undefined {
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "")?.[1]?.trim();
  if (bearer) return bearer;
  const credentialsBlock = /<(?:\w+:)?credentials\b[^>]*>([\s\S]*?)<\/(?:\w+:)?credentials\s*>/i.exec(xml)?.[1];
  if (!credentialsBlock) return undefined;
  return tag(credentialsBlock, "token") ?? tag(credentialsBlock, "authToken");
}
function pageIndex(xml: string): number { return boundedInt(tag(xml, "index"), 0, 100_000, 0); }
function pageCount(xml: string): number { return boundedInt(tag(xml, "count"), 1, 100, 100); }
function boundedInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(value); return Number.isInteger(n) && n >= min ? Math.min(n, max) : fallback;
}

async function loadCatalog(client: ClientApiService, userId: string): Promise<Catalog> {
  const [library, playlists, themePrefs, songPrefs, music] = await Promise.all([
    client.getLibrary(userId, null), client.listPlaylists(userId), client.getThemePrefs(userId),
    client.getSongPrefs(userId), client.getMusicCatalog(userId),
  ]);
  return { anime: library.anime.filter((x) => !x.deleted).sort((a, b) => titleAnime(a).localeCompare(titleAnime(b)) || a.kitsuId.localeCompare(b.kitsuId)),
    themes: library.themes.filter((x) => !x.deleted && x.audioState === "READY" && themeMode(x, "TV_SIZE") !== null).sort((a, b) => a.id - b.id),
    playlists: playlists.filter((x) => !x.deleted).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    themePrefs: themePrefs.filter((x) => !x.deleted), songPrefs: songPrefs.filter((x) => !x.deleted), music };
}

function browse(c: Catalog, id: string, origin: string): SonosEntry[] {
  if (id === "search") return SONOS_SEARCH_CATEGORIES.map(({ id: categoryId, title }) => container(categoryId, title, "search", { canPlay: false, artwork: sonosIconUrl(origin, searchIcon(categoryId)) }));
  if (id === "root") return [
    container("anime", "Anime", "albumList", { artwork: sonosIconUrl(origin, "anime") }),
    container("playlists", "Playlists", "container", { artwork: sonosIconUrl(origin, "playlists") }),
    container("liked", "Liked Songs", "trackList", { artwork: sonosIconUrl(origin, "liked") }),
  ];
  if (id === "anime") return c.anime.map((a) => ({ ...container(`anime:${a.kitsuId}`, titleAnime(a), "album", { canPlay: true, canEnumerate: true }), artwork: absolute(origin, a.posterUrl ?? a.coverUrl) }));
  if (id === "playlists") return c.playlists.map((p) => container(`playlist:${p.id}`, p.name, "playlist", { readOnly: true, userContent: true, canPlay: true, canEnumerate: true, artwork: sonosIconUrl(origin, playlistIconName(p.id)) }));
  if (id === "liked") {
    const themeIds = new Set(c.themePrefs.filter((p) => p.liked).map((p) => p.themeId));
    const songIds = new Set(c.songPrefs.filter((p) => p.liked).map((p) => p.songId));
    return [...c.themes.filter((t) => themeIds.has(t.id)).map((t) => themeEntry(c, t, origin)), ...songEntries(c, origin).filter((s) => songIds.has(Number(s.id.slice(5))))];
  }
  if (id.startsWith("anime:")) {
    const kitsuId = id.slice(6); return c.themes.filter((t) => t.kitsuAnimeIds.includes(kitsuId)).map((t) => themeEntry(c, t, origin));
  }
  if (id.startsWith("playlist:")) {
    const playlist = c.playlists.find((p) => String(p.id) === id.slice(9));
    if (!playlist) throw new SoapFault("Client.ItemNotFound", "Playlist not found.");
    return playlist.items.map((item) => playlistEntry(c, playlist, item, origin)).filter((x): x is SonosEntry => Boolean(x));
  }
  throw new SoapFault("Client.ItemNotFound", "Container not found.");
}

function search(c: Catalog, category: string, term: string, origin: string): SonosEntry[] {
  const q = term.trim().toLocaleLowerCase(); if (!q) return [];
  if (!["all", "albums", "playlists", "tracks"].includes(category)) throw new SoapFault("Client.BadRequest", "Unknown search category.");
  const albums = c.anime.map((a) => ({ ...container(`anime:${a.kitsuId}`, titleAnime(a), "album", { canPlay: true, canEnumerate: true }), artwork: absolute(origin, a.posterUrl ?? a.coverUrl) }))
    .filter((x) => x.title.toLocaleLowerCase().includes(q));
  const playlists = c.playlists.map((p) => container(`playlist:${p.id}`, p.name, "playlist", { readOnly: true, userContent: true, canPlay: true, canEnumerate: true, artwork: sonosIconUrl(origin, playlistIconName(p.id)) })).filter((x) => x.title.toLocaleLowerCase().includes(q));
  const tracks = [...c.themes.map((t) => themeEntry(c, t, origin)), ...songEntries(c, origin)]
    .filter((x) => `${x.title} ${x.album ?? ""} ${x.artist ?? ""}`.toLocaleLowerCase().includes(q));
  if (category === "albums") return albums; if (category === "playlists") return playlists; if (category === "tracks") return tracks;
  return [...albums, ...playlists, ...tracks];
}

function resolveTrack(c: Catalog, id: string, origin: string): { entry: SonosEntry; uri: string; animeId: string } | null {
  const qualifiedTheme = /^theme:(\d+):(TV_SIZE|FULL_SIZE):(\d+)$/.exec(id);
  if (qualifiedTheme) {
    const theme = c.themes.find((t) => String(t.id) === qualifiedTheme[1]); if (!theme) return null;
    const mode = exactThemeMode(theme, qualifiedTheme[2] as "TV_SIZE" | "FULL_SIZE");
    const uri = mode ? sonosMediaUri(origin, mode === "FULL_SIZE" ? theme.mediaModes.fullSize!.url : theme.mediaModes.tvSize.url) : null;
    if (!mode || !uri) return null;
    return { entry: themeEntry(c, theme, origin, mode, id), uri, animeId: `anime:${theme.kitsuAnimeIds[0] ?? "unknown"}` };
  }
  if (/^theme:\d+$/.test(id)) {
    const theme = c.themes.find((t) => String(t.id) === id.slice(6)); if (!theme) return null;
    const mode = themeMode(theme, preferredThemeMode(c, theme.id, undefined));
    const uri = mode ? sonosMediaUri(origin, mode === "FULL_SIZE" ? theme.mediaModes.fullSize!.url : theme.mediaModes.tvSize.url) : null;
    if (!mode || !uri) return null;
    return { entry: themeEntry(c, theme, origin, mode), uri, animeId: `anime:${theme.kitsuAnimeIds[0] ?? "unknown"}` };
  }
  const qualifiedSong = /^song:(\d+):(\d+)$/.exec(id);
  const legacySong = /^song:(\d+)$/.exec(id);
  const songId = qualifiedSong?.[1] ?? legacySong?.[1];
  if (songId !== undefined) {
    const found = findSong(c, Number(songId)); if (!found) return null;
    if (!sonosMimeType(found.track.mimeType)) return null;
    const uri = sonosMediaUri(origin, found.track.audioUrl);
    if (!uri) return null;
    return { entry: songEntry(found.track, found.anime, found.releaseArtwork, origin, qualifiedSong ? id : undefined), uri, animeId: `anime:${found.anime.kitsuId}` };
  }
  return null;
}

function resolveCollection(c: Catalog, id: string, origin: string): SonosEntry | null {
  if (id === "root") return container("root", "Anime Ongaku", "container", { artwork: sonosIconUrl(origin, "root") });
  if (id === "anime") return container("anime", "Anime", "albumList", { artwork: sonosIconUrl(origin, "anime") });
  if (id === "playlists") return container("playlists", "Playlists", "container", { artwork: sonosIconUrl(origin, "playlists") });
  if (id === "liked") return container("liked", "Liked Songs", "trackList", { artwork: sonosIconUrl(origin, "liked") });
  if (id.startsWith("anime:")) {
    const anime = c.anime.find((item) => item.kitsuId === id.slice(6));
    return anime ? { ...container(id, titleAnime(anime), "album", { canPlay: true, canEnumerate: true }), artwork: absolute(origin, anime.posterUrl ?? anime.coverUrl) } : null;
  }
  if (id.startsWith("playlist:")) {
    const playlist = c.playlists.find((item) => String(item.id) === id.slice(9));
    return playlist ? container(id, playlist.name, "playlist", { readOnly: true, userContent: true, canPlay: true, canEnumerate: true, artwork: sonosIconUrl(origin, playlistIconName(playlist.id)) }) : null;
  }
  return null;
}

function playlistEntry(c: Catalog, playlist: PlaylistDto, item: PlaylistItemDto, origin: string): SonosEntry | null {
  if (item.itemType === "SONG") {
    const found = findSong(c, item.itemId);
    return found && sonosMimeType(found.track.mimeType) ? songEntry(found.track, found.anime, found.releaseArtwork, origin, `song:${item.itemId}:${item.entryId}`) : null;
  }
  const theme = c.themes.find((t) => t.id === item.itemId); if (!theme) return null;
  let desired = item.modeOverride;
  if (!desired) desired = playlist.overrideUserPreference ? playlist.defaultMode : preferredThemeMode(c, theme.id, playlist.defaultMode);
  const mode = themeMode(theme, desired);
  return mode ? themeEntry(c, theme, origin, mode, `theme:${theme.id}:${mode}:${item.entryId}`) : null;
}
function preferredThemeMode(c: Catalog, themeId: number, fallback: "TV_SIZE" | "FULL_SIZE" | undefined): "TV_SIZE" | "FULL_SIZE" {
  return c.themePrefs.find((p) => p.themeId === themeId)?.preferredMode ?? fallback ?? "TV_SIZE";
}
function themeEntry(c: Catalog, theme: LibraryThemeDto, origin: string, desired?: "TV_SIZE" | "FULL_SIZE", id?: string): SonosEntry {
  const anime = c.anime.find((a) => theme.kitsuAnimeIds.includes(a.kitsuId));
  const mode = themeMode(theme, desired ?? preferredThemeMode(c, theme.id, undefined)) ?? "TV_SIZE";
  const useFull = mode === "FULL_SIZE" && theme.mediaModes.fullSize;
  return { id: id ?? `theme:${theme.id}`, title: theme.title, kind: "track", album: anime ? titleAnime(anime) : "Anime Ongaku",
    artist: theme.artists.map((a) => a.name).join(", ") || "Anime Ongaku",
    duration: useFull ? theme.mediaModes.fullSize!.durationSeconds : theme.mediaModes.tvSize.durationSeconds,
    mimeType: "audio/mpeg",
    artwork: absolute(origin, anime?.posterUrl ?? anime?.coverUrl) ?? sonosIconUrl(origin, "fallback") };
}
function songEntries(c: Catalog, origin: string): SonosEntry[] {
  return c.music.flatMap((m) => m.releases.flatMap((r) => r.tracks.filter((t) => sonosMimeType(t.mimeType) !== null).map((t) => songEntry(t, m.anime, r.artworkUrl, origin))));
}
function songEntry(track: MusicTrackDto, anime: AnimeMusicDto["anime"], artwork: string | null, origin: string, id = `song:${track.id}`): SonosEntry {
  return { id, title: track.titleEnglish ?? track.title, kind: "track", album: anime.titleEn ?? anime.title ?? "Anime Ongaku",
    artist: track.artistCredit || "Anime Ongaku", duration: track.durationSeconds, mimeType: "audio/mpeg", artwork: absolute(origin, artwork ?? anime.posterUrl) ?? sonosIconUrl(origin, "fallback") };
}
function findSong(c: Catalog, id: number) {
  for (const m of c.music) for (const r of m.releases) { const track = r.tracks.find((t) => t.id === id); if (track) return { track, anime: m.anime, releaseArtwork: r.artworkUrl }; }
  return null;
}
function titleAnime(anime: LibraryAnimeDto): string { return anime.titleEn ?? anime.title ?? anime.titleRomaji ?? anime.titleJa ?? `Anime ${anime.kitsuId}`; }
function container(id: string, title: string, collectionType: SonosEntry["collectionType"] = "container", flags: Partial<SonosEntry> = {}): SonosEntry {
  return { id, title, kind: "container", collectionType, ...flags };
}
function searchIcon(category: string): SonosIconName {
  if (category === "albums") return "anime";
  if (category === "playlists") return "playlists";
  if (category === "tracks") return "fallback";
  return "search";
}


function exactThemeMode(theme: LibraryThemeDto, requested: "TV_SIZE" | "FULL_SIZE"): "TV_SIZE" | "FULL_SIZE" | null {
  if (requested === "FULL_SIZE") {
    return theme.mediaModes.fullSize && sonosMimeType(theme.mediaModes.fullSize.mimeType) ? "FULL_SIZE" : null;
  }
  return sonosMimeType(theme.mediaModes.tvSize.mimeType) ? "TV_SIZE" : null;
}

function themeMode(theme: LibraryThemeDto, preferred: "TV_SIZE" | "FULL_SIZE"): "TV_SIZE" | "FULL_SIZE" | null {
  const tv = sonosMimeType(theme.mediaModes.tvSize.mimeType);
  const full = theme.mediaModes.fullSize && sonosMimeType(theme.mediaModes.fullSize.mimeType);
  if (preferred === "FULL_SIZE" && full) return "FULL_SIZE";
  if (preferred === "TV_SIZE" && tv) return "TV_SIZE";
  if (full) return "FULL_SIZE";
  if (tv) return "TV_SIZE";
  return null;
}

function sonosMimeType(value: string | null | undefined): string | null {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mime) return null;
  if (mime === "audio/ogg" || mime === "application/ogg") return "application/ogg";
  if (mime === "audio/mp3" || mime === "audio/mpeg3" || mime === "audio/mpeg") return "audio/mpeg";
  if (["audio/flac", "audio/mp4", "audio/aac", "application/x-mpegurl", "application/vnd.apple.mpegurl", "audio/x-mpegurl", "audio/wma", "audio/x-ms-wma"].includes(mime)) return mime;
  return null;
}

function versionToken(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 24);
}

function resultPage(method: "getMetadata" | "search", all: SonosEntry[], index: number, count: number): string {
  const page = all.slice(index, index + count);
  return `<${method}Result><index>${index}</index><count>${page.length}</count><total>${all.length}</total>${page.map(entryXml).join("")}</${method}Result>`;
}
function entryXml(entry: SonosEntry): string {
  if (entry.kind === "container") {
    const attrs = `${entry.readOnly === undefined ? "" : ` readOnly="${entry.readOnly}"`}${entry.userContent === undefined ? "" : ` userContent="${entry.userContent}"`}`;
    return `<mediaCollection${attrs}><id>${escapeXml(entry.id)}</id><itemType>${escapeXml(entry.collectionType ?? "container")}</itemType><title>${escapeXml(entry.title)}</title>${entry.canPlay === undefined ? "" : `<canPlay>${entry.canPlay}</canPlay>`}${entry.canEnumerate === undefined ? "" : `<canEnumerate>${entry.canEnumerate}</canEnumerate>`}${entry.artwork ? `<albumArtURI>${escapeXml(entry.artwork)}</albumArtURI>` : ""}</mediaCollection>`;
  }
  return `<mediaMetadata><id>${escapeXml(entry.id)}</id><itemType>track</itemType><title>${escapeXml(entry.title)}</title><mimeType>${escapeXml(entry.mimeType ?? "audio/mpeg")}</mimeType><trackMetadata><artist>${escapeXml(entry.artist ?? "Anime Ongaku")}</artist><album>${escapeXml(entry.album ?? "Anime Ongaku")}</album>${entry.artwork ? `<albumArtURI>${escapeXml(entry.artwork)}</albumArtURI>` : ""}<duration>${Math.max(0, Math.round(entry.duration ?? 0))}</duration></trackMetadata></mediaMetadata>`;
}

function sendSoap(reply: FastifyReply, method: string, result: string) {
  return reply.type("text/xml; charset=utf-8").send(`<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${SOAP_NS}"><s:Body><${method}Response xmlns="${SMAPI_NS}">${result}</${method}Response></s:Body></s:Envelope>`);
}
export function sendFault(reply: FastifyReply, status: number, code: string, message: string) {
  const authDetail = code === "Client.NOT_LINKED_RETRY"
    ? `<detail><ns:ExceptionInfo>Retry token request.</ns:ExceptionInfo><ns:SonosError>5</ns:SonosError></detail>`
    : code === "Client.NOT_LINKED_FAILURE"
      ? `<detail><ns:ExceptionInfo>Stop token request.</ns:ExceptionInfo><ns:SonosError>6</ns:SonosError></detail>`
      : "";
  return reply.code(status).type("text/xml; charset=utf-8").send(`<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${SOAP_NS}" xmlns:ns="${SMAPI_NS}"><s:Body><s:Fault><faultcode>${escapeXml(code)}</faultcode><faultstring>${escapeXml(message)}</faultstring>${authDetail}</s:Fault></s:Body></s:Envelope>`);
}
function absolute(origin: string, value: string | null | undefined): string | null { return value ? new URL(value, origin).toString() : null; }
function escapeXml(value: unknown): string { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function sonosMediaUri(origin: string, value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value, origin); } catch { return null; }
  if (url.origin !== origin) return null;
  const theme = /^\/v1\/media\/audio\/([1-9]\d*)$/.exec(url.pathname);
  if (theme) return `${origin}/v1/media/sonos/themes/${theme[1]}.mp3`;
  const song = /^\/v1\/media\/songs\/([1-9]\d*)\/audio$/.exec(url.pathname);
  if (song) return `${origin}/v1/media/sonos/songs/${song[1]}.mp3`;
  return null;
}
function decodeXml(value: string): string { return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function queryCode(url: string): string { try { return new URL(url, "http://local").searchParams.get("linkCode") ?? ""; } catch { return ""; } }
function parseLinkBody(body: unknown): { linkCode: string; username: string; password: string } {
  if (typeof body === "string") { const p = new URLSearchParams(body); return { linkCode: p.get("linkCode") ?? "", username: p.get("username") ?? "", password: p.get("password") ?? "" }; }
  const p = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return { linkCode: String(p.linkCode ?? ""), username: String(p.username ?? ""), password: String(p.password ?? "") };
}
function wantsJson(accept: string | string[] | undefined): boolean { return (Array.isArray(accept) ? accept[0] : accept)?.includes("application/json") ?? false; }

function pageShell(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(title)} · Anime Ongaku</title><style>body{margin:0;background:#0b1020;color:#f8fafc;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{width:min(420px,calc(100% - 40px));background:#151c31;border:1px solid #334155;border-radius:24px;padding:28px;box-shadow:0 24px 80px #0008}h1{margin:.2rem 0;color:#f472b6}p{color:#cbd5e1;line-height:1.55}label{display:block;margin:16px 0 6px}input{box-sizing:border-box;width:100%;padding:12px;border-radius:10px;border:1px solid #475569;background:#0f172a;color:white}button{margin-top:20px;width:100%;padding:13px;border:0;border-radius:10px;background:#ec4899;color:white;font-weight:700}</style></head><body><main class="card">${content}</main></body></html>`;
}
function linkPage(code: string): string { return pageShell("Connect Sonos", `<p>ANIME ONGAKU × SONOS</p><h1>Connect Anime Ongaku</h1><p>Sign in with your Kitsu account to play your personal anime library in Sonos.</p><form method="post" action="/sonos/link"><input type="hidden" name="linkCode" value="${escapeXml(code)}"><label for="username">Kitsu username</label><input id="username" name="username" autocomplete="username" required><label for="password">Kitsu password</label><input id="password" type="password" name="password" autocomplete="current-password" required><button type="submit">Connect to Sonos</button></form>`); }
function expiredPage(): string { return messagePage("Link expired", "Start account linking again from the Sonos app."); }
function messagePage(title: string, message: string): string { return pageShell(title, `<p>ANIME ONGAKU × SONOS</p><h1>${escapeXml(title)}</h1><p>${escapeXml(message)}</p>`); }
