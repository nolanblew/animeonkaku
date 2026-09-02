import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import type { ClientApiService, LibraryResponse } from "../src/api/clientRoutes.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const NS = "http://www.sonos.com/Services/1.1";
const env = (method: string, body = "", header = "") =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header>${header}</s:Header><s:Body><${method} xmlns="${NS}">${body}</${method}></s:Body></s:Envelope>`;
const creds = (token: string) => `<credentials xmlns="${NS}"><loginToken><token>${token}</token></loginToken></credentials>`;

class SonosApi {
  users: string[] = [];
  fullSize = true;
  tvMimeType = "application/ogg";
  preferenceRevision = 1;
  async getLibrary(userId: string, _since: number | null): Promise<LibraryResponse> {
    this.users.push(userId);
    return { serverTime: 1_800_000_000_000, anime: [{
      kitsuId: "42", animeThemesId: 7, title: "A & B <Final>", titleEn: "A & B <Final>", titleRomaji: null,
      titleJa: null, posterUrl: "/v1/media/images/anime/42/poster", coverUrl: null, watchingStatus: "current",
      subtype: "TV", startDate: null, endDate: null, episodeCount: 12, ageRating: null, averageRating: null,
      userRating: null, libraryUpdatedAt: null, slug: "a-b", genres: [], updatedAt: 10, deleted: false,
    }], themes: [{
      id: 100, animeThemesAnimeId: 7, kitsuAnimeIds: ["42"], title: "Opening & <One>", themeType: "OP1",
      artists: [{ name: "Artist & Friends", asCharacter: null, alias: null }], audioUrl: "/v1/media/audio/100",
      videoUrl: null, audioState: "READY", durationSeconds: 90, fileSize: 10, mediaModes: {
        tvSize: { url: "/v1/media/audio/100", durationSeconds: 90, fileSize: 10, mimeType: this.tvMimeType },
        fullSize: this.fullSize ? { songId: 200, url: "/v1/media/songs/200/audio", durationSeconds: 240, fileSize: 20, sourceReleaseId: 3, mimeType: "audio/flac" } : null,
        video: null,
      }, updatedAt: 10, deleted: false,
    }] };
  }
  async listPlaylists(userId: string) {
    this.users.push(userId);
    return [{ id: 9, name: "Favorites & More", entries: [100, 100], defaultMode: "TV_SIZE" as const,
      overrideUserPreference: false, items: [
        { entryId: 1, itemType: "THEME" as const, itemId: 100, modeOverride: "FULL_SIZE" as const },
        { entryId: 2, itemType: "THEME" as const, itemId: 100, modeOverride: null },
      ], isAuto: false, isDynamic: false, autoUpdate: false, updatedAt: 11, deleted: false,
      dynamicSpecJson: null, dynamicSortJson: null }];
  }
  async getThemePrefs(userId: string) { this.users.push(userId); return [{ themeId: 100, liked: true, disliked: false,
    dislikedTvSize: false, dislikedFullSize: false, preferredMode: "FULL_SIZE" as const, playCount: 0,
    lastPlayedAt: null, updatedAt: this.preferenceRevision, deleted: false }]; }
  async getSongPrefs(userId: string) { this.users.push(userId); return []; }
  async getMusicCatalog(userId: string) {
    this.users.push(userId);
    return [{ anime: { kitsuId: "42", title: "A & B <Final>", titleEn: "A & B <Final>", posterUrl: null }, releases: [{
      id: 3, title: "Album", titleEnglish: null, titleRomaji: null, titleJapanese: null,
      artistCredit: "Artist & Friends", artistNames: [], relationshipType: "THEME", releaseDate: null, year: null,
      artworkUrl: null, tracks: [{ id: 200, title: "Full Opening", titleEnglish: null, titleRomaji: null,
        titleJapanese: null, artistCredit: "Artist & Friends", artistNames: [], durationSeconds: 240,
        audioUrl: "/v1/media/songs/200/audio", fileSize: 20, mimeType: "audio/flac", discNumber: 1, trackNumber: 1, displayOrder: 1 }],
    }] }];
  }
}

describe("Sonos sandbox SMAPI", () => {
  let app: FastifyInstance; let auth: AuthService; let api: SonosApi; let now: number; let code: number;
  const onLogin = vi.fn(async () => {});
  beforeEach(() => {
    now = 1_800_000_000_000; code = 1; api = new SonosApi();
    auth = new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient());
    app = buildApp({ authService: auth, health: { pingDb: async () => {}, mediaRoot: process.cwd() },
      clientApi: api as unknown as ClientApiService, onLogin,
      sonos: { publicOrigin: "https://ongaku.takeya.ninja", now: () => now,
        generateCode: () => `LINK${String(code++).padStart(4, "0")}` } });
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  const soap = (method: string, body = "", token?: string, action = method) => app.inject({ method: "POST",
    url: "/sonos/smapi", headers: { "content-type": "text/xml; charset=utf-8", soapaction: `"${NS}#${action}"` },
    payload: env(method, body, token ? creds(token) : "") });
  async function link(hh = "HH-1", device = "DEV-1") {
    const start = await soap("getAppLink", `<householdId>${hh}</householdId><linkDeviceId>${device}</linkDeviceId>`);
    const linkCode = /linkCode=([^&<]+)/.exec(start.body)?.[1]; expect(linkCode).toBeTruthy();
    const post = await app.inject({ method: "POST", url: "/sonos/link",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `linkCode=${linkCode}&username=alice&password=secret` });
    expect(post.statusCode).toBe(200);
    const poll = await soap("getDeviceAuthToken", `<householdId>${hh}</householdId><linkDeviceId>${device}</linkDeviceId><linkCode>${linkCode}</linkCode>`);
    const token = /<authToken>([^<]+)<\/authToken>/.exec(poll.body)?.[1]; expect(token).toBeTruthy();
    return { linkCode: linkCode!, token: token! };
  }

  it("dispatches SOAPAction with XML responses and LastUpdate", async () => {
    const r = await soap("getLastUpdate");
    expect(r.statusCode).toBe(200); expect(r.headers["content-type"]).toContain("text/xml");
    expect(r.body).toContain("<getLastUpdateResponse"); expect(r.body).toContain("<catalog>1800000000</catalog>");
  });
  it("accepts an empty self-closing SMAPI method element", async () => {
    const payload = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><getLastUpdate xmlns="${NS}"/></s:Body></s:Envelope>`;
    const r = await app.inject({ method: "POST", url: "/sonos/smapi", headers: {
      "content-type": "text/xml; charset=utf-8", soapaction: `"${NS}#getLastUpdate"`,
    }, payload });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("<getLastUpdateResponse");
  });
  it("keeps update tokens stable until the authenticated user's catalog changes", async () => {
    const guest = await soap("getLastUpdate"); now += 60_000;
    expect((await soap("getLastUpdate")).body).toBe(guest.body);
    const { token } = await link();
    const before = await soap("getLastUpdate", "", token);
    const catalog = /<catalog>([^<]+)<\/catalog>/.exec(before.body)?.[1];
    const favorites = /<favorites>([^<]+)<\/favorites>/.exec(before.body)?.[1];
    api.preferenceRevision += 1;
    const after = await soap("getLastUpdate", "", token);
    expect(/<catalog>([^<]+)<\/catalog>/.exec(after.body)?.[1]).toBe(catalog);
    expect(/<favorites>([^<]+)<\/favorites>/.exec(after.body)?.[1]).not.toBe(favorites);
  });
  it.each([["malformed", "<not-closed"], ["mismatched", env("getLastUpdate", "<x></y>")], ["DTD", `<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${env("getLastUpdate", "&xxe;")}`]])
  ("SOAP-faults %s XML", async (_name, payload) => {
    const r = await app.inject({ method: "POST", url: "/sonos/smapi", headers: { "content-type": "text/xml",
      soapaction: `"${NS}#getLastUpdate"` }, payload });
    expect(r.statusCode).toBe(500); expect(r.headers["content-type"]).toContain("text/xml");
    expect(r.body).toContain("<s:Fault>"); expect(r.body).not.toContain("file:///etc/passwd");
  });
  it("SOAP-faults oversized XML", async () => {
    const r = await app.inject({ method: "POST", url: "/sonos/smapi", headers: { "content-type": "text/xml",
      soapaction: `"${NS}#getLastUpdate"` }, payload: env("getLastUpdate", `<x>${"a".repeat(270_000)}</x>`) });
    expect(r.statusCode).toBe(413); expect(r.headers["content-type"]).toContain("text/xml"); expect(r.body).toContain("<s:Fault>");
  });
  it("renders the branded browser-link page", async () => {
    const start = await soap("getAppLink", "<householdId>HH</householdId><linkDeviceId>D</linkDeviceId>");
    const linkCode = /linkCode=([^&<]+)/.exec(start.body)?.[1];
    const page = await app.inject({ method: "GET", url: `/sonos/link?linkCode=${linkCode}` });
    expect(page.statusCode).toBe(200); expect(page.body).toContain("Anime Ongaku"); expect(page.body).toContain("Kitsu username");
  });
  it("generates and echoes a hidden linkDeviceId when Sonos does not provide one", async () => {
    const start = await soap("getAppLink", "<householdId>HH</householdId>");
    const linkCode = /<linkCode>([^<]+)<\/linkCode>/.exec(start.body)?.[1];
    const linkDeviceId = /<linkDeviceId>([^<]+)<\/linkDeviceId>/.exec(start.body)?.[1];
    expect(linkCode).toBeTruthy(); expect(linkDeviceId).toBeTruthy();
    await app.inject({ method: "POST", url: "/sonos/link", headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `linkCode=${linkCode}&username=alice&password=secret` });
    const poll = await soap("getDeviceAuthToken", `<householdId>HH</householdId><linkDeviceId>${linkDeviceId}</linkDeviceId><linkCode>${linkCode}</linkCode>`);
    expect(poll.statusCode).toBe(200); expect(poll.body).not.toContain("stub-alice</userIdHashCode>");
  });
  it("returns the complete browser-auth token contract in Sonos schema order", async () => {
    const start = await soap("getAppLink", "<householdId>HH</householdId><linkDeviceId>D</linkDeviceId>");
    const linkCode = /<linkCode>([^<]+)<\/linkCode>/.exec(start.body)?.[1];
    await app.inject({ method: "POST", url: "/sonos/link", headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `linkCode=${linkCode}&username=alice&password=secret` });
    const poll = await soap("getDeviceAuthToken", `<householdId>HH</householdId><linkDeviceId>D</linkDeviceId><linkCode>${linkCode}</linkCode>`);
    expect(poll.statusCode).toBe(200);
    expect(poll.body).toMatch(/<getDeviceAuthTokenResult><authToken>[^<]+<\/authToken><privateKey>alwaysReauthenticate<\/privateKey><userInfo><userIdHashCode>[A-Za-z0-9_-]+<\/userIdHashCode><nickname>alice<\/nickname><\/userInfo><\/getDeviceAuthTokenResult>/);
  });
  it("links once, invokes sync, binds the device, and consumes the result", async () => {
    const { linkCode } = await link(); expect(onLogin).toHaveBeenCalledOnce();
    const wrong = await soap("getDeviceAuthToken", `<householdId>HH-1</householdId><linkDeviceId>OTHER</linkDeviceId><linkCode>${linkCode}</linkCode>`);
    expect(wrong.statusCode).toBe(500);
    const again = await soap("getDeviceAuthToken", `<householdId>HH-1</householdId><linkDeviceId>DEV-1</linkDeviceId><linkCode>${linkCode}</linkCode>`);
    expect(again.statusCode).toBe(500); expect(again.body).toContain("Client.AuthTokenExpired");
  });
  it("retries while pending and expires codes after ten minutes", async () => {
    const start = await soap("getAppLink", "<householdId>HH</householdId><linkDeviceId>D</linkDeviceId>");
    const linkCode = /linkCode=([^&<]+)/.exec(start.body)?.[1];
    const pending = await soap("getDeviceAuthToken", `<householdId>HH</householdId><linkDeviceId>D</linkDeviceId><linkCode>${linkCode}</linkCode>`);
    expect(pending.body).toContain("Client.NOT_LINKED_RETRY");
    expect(pending.body).toContain('<ns:ExceptionInfo>Retry token request.</ns:ExceptionInfo>');
    expect(pending.body).toContain('<ns:SonosError>5</ns:SonosError>');
    now += 600_001;
    const failed = await soap("getDeviceAuthToken", `<householdId>HH</householdId><linkDeviceId>D</linkDeviceId><linkCode>${linkCode}</linkCode>`);
    expect(failed.body).toContain("Client.NOT_LINKED_FAILURE");
    expect(failed.body).toContain('<ns:ExceptionInfo>Stop token request.</ns:ExceptionInfo>');
    expect(failed.body).toContain('<ns:SonosError>6</ns:SonosError>');
    expect((await app.inject({ method: "GET", url: `/sonos/link?linkCode=${linkCode}` })).statusCode).toBe(410);
  });
  it("does not add Sonos auth detail to generic SOAP faults", async () => {
    const response = await soap("getMetadata", "<id>root</id>");
    expect(response.body).toContain("Client.AuthTokenExpired");
    expect(response.body).not.toContain("<detail>");
    expect(response.body).not.toContain("SonosError");
  });
  it("caps failed logins", async () => {
    const start = await soap("getAppLink", "<householdId>HH</householdId><linkDeviceId>D</linkDeviceId>");
    const linkCode = /linkCode=([^&<]+)/.exec(start.body)?.[1];
    for (let i = 0; i < 5; i++) await app.inject({ method: "POST", url: "/sonos/link",
      headers: { "content-type": "application/x-www-form-urlencoded" }, payload: `linkCode=${linkCode}&username=alice&password=` });
    expect((await app.inject({ method: "GET", url: `/sonos/link?linkCode=${linkCode}` })).statusCode).toBe(410);
  });
  it("browses root/anime/playlist/liked with escaping, duplicates, and pagination", async () => {
    const { token } = await link();
    const root = await soap("getMetadata", "<id>root</id><index>0</index><count>2</count>", token);
    expect(root.body).toContain("<id>anime</id>"); expect(root.body).toContain("<id>playlists</id>");
    expect(root.body).not.toContain("<id>liked</id>"); expect(root.body).toContain("<total>3</total>");
    const anime = await soap("getMetadata", "<id>anime:42</id><index>0</index><count>10</count>", token);
    expect(anime.body).toContain("<id>theme:100</id>"); expect(anime.body).toContain("Opening &amp; &lt;One&gt;");
    const playlist = await soap("getMetadata", "<id>playlist:9</id><index>0</index><count>10</count>", token);
    expect(playlist.body.match(/<id>theme:100:(?:TV_SIZE|FULL_SIZE):\d+<\/id>/g)).toHaveLength(2);
    expect((await soap("getMetadata", "<id>liked</id><index>0</index><count>10</count>", token)).body).toContain("<id>theme:100</id>");
  });
  it("advertises anime as albums and user playlists as read-only playlists", async () => {
    const { token } = await link();
    const root = await soap("getMetadata", "<id>root</id><index>0</index><count>10</count>", token);
    expect(root.body).toMatch(/<id>anime<\/id><itemType>albumList<\/itemType>/);
    expect(root.body).toMatch(/<id>liked<\/id><itemType>trackList<\/itemType>/);
    const albums = await soap("getMetadata", "<id>anime</id><index>0</index><count>10</count>", token);
    expect(albums.body).toMatch(/<id>anime:42<\/id><itemType>album<\/itemType>/);
    const playlists = await soap("getMetadata", "<id>playlists</id><index>0</index><count>10</count>", token);
    expect(playlists.body).toMatch(/<mediaCollection[^>]*readOnly="true"[^>]*>.*<id>playlist:9<\/id><itemType>playlist<\/itemType>/s);
  });
  it("returns configured classic-search categories from the search metadata container", async () => {
    const { token } = await link();
    const firstPage = await soap("getMetadata", "<id>search</id><index>0</index><count>2</count>", token);
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.body).toContain("<total>4</total>");
    const firstEntries = [...firstPage.body.matchAll(/<mediaCollection>([\s\S]*?)<\/mediaCollection>/g)].map((match) => match[1]);
    expect(firstEntries.map((entry) => /<id>([^<]+)<\/id>/.exec(entry)?.[1])).toEqual(["all", "albums"]);
    expect(firstEntries.map((entry) => /<title>([^<]+)<\/title>/.exec(entry)?.[1])).toEqual(["All", "Albums"]);
    expect(firstEntries.every((entry) => entry?.includes("<itemType>search</itemType>") && entry.includes("<canPlay>false</canPlay>"))).toBe(true);

    const secondPage = await soap("getMetadata", "<id>search</id><index>2</index><count>2</count>", token);
    const secondEntries = [...secondPage.body.matchAll(/<mediaCollection>([\s\S]*?)<\/mediaCollection>/g)].map((match) => match[1]);
    expect(secondEntries.map((entry) => /<id>([^<]+)<\/id>/.exec(entry)?.[1])).toEqual(["playlists", "tracks"]);
    expect(secondEntries.map((entry) => /<title>([^<]+)<\/title>/.exec(entry)?.[1])).toEqual(["Playlists", "Tracks"]);
    expect(secondEntries.every((entry) => entry?.includes("<itemType>search</itemType>") && entry.includes("<canPlay>false</canPlay>"))).toBe(true);
  });
  it.each(["all", "albums", "playlists", "tracks"])("searches user-scoped %s", async (category) => {
    const { token } = await link();
    expect((await soap("search", `<id>${category}</id><term>Opening</term><index>0</index><count>10</count>`, token)).statusCode).toBe(200);
    expect(api.users.every((u) => u === "stub-alice")).toBe(true);
  });
  it("returns empty search results for blank terms", async () => {
    const { token } = await link();
    expect((await soap("search", "<id>all</id><term> </term><index>0</index><count>10</count>", token)).body).toContain("<total>0</total>");
  });
  it("returns schema metadata and authenticated media URI without URL token leakage", async () => {
    const { token } = await link(); const meta = await soap("getMediaMetadata", "<id>theme:100</id>", token);
    expect(meta.body).toContain("<mimeType>audio/mpeg</mimeType>"); expect(meta.body).toContain("<duration>240</duration>");
    expect(meta.body).toContain("https://ongaku.takeya.ninja/v1/media/images/anime/42/poster");
    const uri = await soap("getMediaURI", "<id>theme:100</id>", token);
    expect(uri.body).toContain("https://ongaku.takeya.ninja/v1/media/sonos/songs/200.mp3");
    expect(uri.body).toContain(`<header>Authorization</header><value>Bearer ${token}</value>`); expect(uri.body).not.toContain(`?token=${token}`);
  });
  it("falls back to TV-size when a preferred full song is unavailable", async () => {
    api.fullSize = false; const { token } = await link();
    const meta = await soap("getMediaMetadata", "<id>theme:100</id>", token);
    expect(meta.body).toContain("<mimeType>audio/mpeg</mimeType>"); expect(meta.body).toContain("<duration>90</duration>");
    const uri = await soap("getMediaURI", "<id>theme:100</id>", token);
    expect(uri.body).toContain("https://ongaku.takeya.ninja/v1/media/sonos/themes/100.mp3");
  });
  it("returns track-shaped extended metadata and album-shaped collection metadata", async () => {
    const { token } = await link();
    const track = await soap("getExtendedMetadata", "<id>theme:100</id>", token);
    expect(track.body).toContain("<getExtendedMetadataResult><mediaMetadata>");
    expect(track.body).not.toContain("<getExtendedMetadataResult><mediaCollection>");
    const album = await soap("getExtendedMetadata", "<id>anime:42</id>", token);
    expect(album.body).toMatch(/<getExtendedMetadataResult><mediaCollection[^>]*>.*<itemType>album<\/itemType>/s);
  });
  it("hides a theme when its only TV-size source is an unsupported video fallback", async () => {
    api.fullSize = false; api.tvMimeType = "video/webm";
    const { token } = await link();
    const album = await soap("getMetadata", "<id>anime:42</id><index>0</index><count>10</count>", token);
    expect(album.body).toContain("<total>0</total>");
    expect((await soap("getMediaURI", "<id>theme:100</id>", token)).body).toContain("Client.ItemNotFound");
  });
  it("isolates users and faults missing auth/unsupported methods", async () => {
    const { token } = await link(); const bob = await auth.login({ username: "bob", password: "secret", deviceName: "test" });
    await soap("getMetadata", "<id>anime</id><index>0</index><count>10</count>", token);
    await soap("getMetadata", "<id>anime</id><index>0</index><count>10</count>", bob.token);
    expect(api.users).toContain("stub-alice"); expect(api.users).toContain("stub-bob");
    expect((await soap("getMetadata", "<id>root</id>")).body).toContain("Client.AuthTokenExpired");
    expect((await soap("deleteItem", "", undefined, "deleteItem")).body).toContain("Client.UnsupportedRequest");
  });
  it("accepts the bearer header required by the Sonos authorization-header capability", async () => {
    const { token } = await link();
    const response = await app.inject({ method: "POST", url: "/sonos/smapi", headers: {
      "content-type": "text/xml; charset=utf-8", soapaction: `"${NS}#getMetadata"`, authorization: `Bearer ${token}`,
    }, payload: env("getMetadata", "<id>root</id><index>0</index><count>10</count>") });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<id>anime</id>");
  });
  it("keeps duplicate playlist items mode-qualified and resolves metadata and URI consistently", async () => {
    api.getThemePrefs = async () => [];
    const { token } = await link();
    const playlist = await soap("getMetadata", "<id>playlist:9</id><index>0</index><count>10</count>", token);
    expect(playlist.body).toContain("<id>theme:100:FULL_SIZE:1</id>");
    expect(playlist.body).toContain("<id>theme:100:TV_SIZE:2</id>");

    const fullMetadata = await soap("getMediaMetadata", "<id>theme:100:FULL_SIZE:1</id>", token);
    const tvMetadata = await soap("getMediaMetadata", "<id>theme:100:TV_SIZE:2</id>", token);
    expect(fullMetadata.body).toContain("<mimeType>audio/mpeg</mimeType>");
    expect(fullMetadata.body).toContain("<duration>240</duration>");
    expect(tvMetadata.body).toContain("<mimeType>audio/mpeg</mimeType>");
    expect(tvMetadata.body).toContain("<duration>90</duration>");

    const fullUri = await soap("getMediaURI", "<id>theme:100:FULL_SIZE:1</id>", token);
    const tvUri = await soap("getMediaURI", "<id>theme:100:TV_SIZE:2</id>", token);
    expect(fullUri.body).toContain("https://ongaku.takeya.ninja/v1/media/sonos/songs/200.mp3");
    expect(tvUri.body).toContain("https://ongaku.takeya.ninja/v1/media/sonos/themes/100.mp3");
  });


  it("returns SVG browse artwork for the root, playlist collection, and search categories", async () => {
    const { token } = await link();
    const root = await soap("getMetadata", "<id>root</id><index>0</index><count>10</count>", token);
    const rootEntries = [...root.body.matchAll(/<mediaCollection[\s\S]*?<\/mediaCollection>/g)].map((match) => match[0]);
    expect(rootEntries).toHaveLength(3);
    expect(rootEntries.every((entry) => /<albumArtURI>https:\/\/ongaku\.takeya\.ninja\/sonos\/icons\/[A-Za-z0-9_-]+\.svg<\/albumArtURI>/.test(entry))).toBe(true);

    const playlists = await soap("getMetadata", "<id>playlists</id><index>0</index><count>10</count>", token);
    expect(playlists.body).toMatch(/<id>playlist:9<\/id>[\s\S]*?<albumArtURI>https:\/\/ongaku\.takeya\.ninja\/sonos\/icons\/[A-Za-z0-9_-]+\.svg<\/albumArtURI>/);

    const search = await soap("getMetadata", "<id>search</id><index>0</index><count>10</count>", token);
    const searchEntries = [...search.body.matchAll(/<mediaCollection>([\s\S]*?)<\/mediaCollection>/g)].map((match) => match[1]);
    expect(searchEntries).toHaveLength(4);
    expect(searchEntries.every((entry) => /<albumArtURI>https:\/\/ongaku\.takeya\.ninja\/sonos\/icons\/[A-Za-z0-9_-]+\.svg<\/albumArtURI>/.test(entry ?? ""))).toBe(true);
  });

  it.each(["root", "anime", "playlists", "liked", "search", "fallback"])("serves the public %s Sonos SVG browse icon", async (name) => {
    const response = await app.inject({ method: "GET", url: `/sonos/icons/${name}.svg` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/svg+xml");
    expect(response.headers["cache-control"]).toMatch(/public/);
    expect(response.body).toContain("<svg");
  });
});
