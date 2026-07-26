import { describe, expect, it, vi } from "vitest";
import { TokenBucket } from "../src/http/tokenBucket.js";
import {
  AMF_API_BASE_URL,
  AMF_JSON_API_BASE_URL,
  AnimeMusicFetcherClient,
  AnimeMusicFetcherError,
  createAnimeMusicFetcherUpstreamHttp,
  type AmfJobCreate,
} from "../src/music/animeMusicFetcher/index.js";
import { fakeFetch, routedFetch, type FakeResponse } from "./helpers/fakeFetch.js";

const request: AmfJobCreate = {
  titles: {
    english: "Frieren: Beyond Journey's End",
    japanese: "葬送のフリーレン",
    romaji: "Sousou no Frieren",
    names: ["Frieren"],
  },
  items: [
    {
      kind: "OP",
      number: 1,
      version: "FULL",
      release_preference: "INDIVIDUAL",
      song_titles: { english: "Yuusha" },
      artists: ["YOASOBI"],
    },
    { kind: "OST", release_preference: "COLLECTION" },
  ],
  metadata_lookup: true,
  anilist_id: 154587,
  animethemes_slug: "sousou-no-frieren",
  quality: { preferred_formats: ["FLAC", "MP3"], prefer_lossless: true, min_seeders: 1 },
  destination: "anime-ongaku-staging/anime-42/request-request-1/batch-0",
  selection_mode: "automatic",
};

function jobFixture(status = "queued") {
  return {
    id: "amf-job-1",
    status,
    request_payload: request,
    destination: request.destination,
    candidate_snapshot: null,
    selected_releases: null,
    downloads: null,
    last_progress: null,
    output_manifest: null,
    source_files: [],
    deliveries: [],
    item_results: [
      {
        requested_item_index: 0,
        label: "OP1",
        kind: "OP",
        number: 1,
        status: "pending",
        candidate_indexes: [],
        selected_release_indexes: [],
        matched_releases: [],
        delivered_files: [],
        file_count: 0,
      },
    ],
    warnings: [],
    error_stage: null,
    error_message: null,
    created_at: "2026-07-21T12:00:00Z",
    updated_at: "2026-07-21T12:00:00Z",
    completed_at: null,
  };
}

function clientFor(script: FakeResponse[]) {
  const { fetch, requests } = fakeFetch(script);
  const http = createAnimeMusicFetcherUpstreamHttp({ fetch, maxRetries: 0 });
  return { client: new AnimeMusicFetcherClient({ http }), requests };
}

function jsonApiJobFixture() {
  const fixture = jobFixture("completed_with_warnings");
  return {
    jsonapi: { version: "1.1" },
    data: {
      type: "jobs",
      id: fixture.id,
      attributes: {
        status: fixture.status,
        destination: fixture.destination,
        last_progress: fixture.last_progress,
        warnings: ["OST could not be found"],
        error_stage: fixture.error_stage,
        error_message: fixture.error_message,
        created_at: fixture.created_at,
        updated_at: fixture.updated_at,
        completed_at: "2026-07-21T12:30:00Z",
      },
    },
    included: [
      {
        type: "item_results",
        id: `${fixture.id}:0`,
        attributes: {
          requested_item_index: 0,
          label: "OP1",
          kind: "OP",
          number: 1,
          status: "delivered",
          file_count: 1,
        },
      },
      {
        type: "media",
        id: fixture.id,
        attributes: {
          anime: {
            titles: { english: "Frieren: Beyond Journey's End", japanese: "葬送のフリーレン", romaji: "Sousou no Frieren" },
            albums: [{
              titles: { english: "The Book 3", japanese: null, romaji: "The Book 3" },
              songs: [{
                file_index: 0,
                requested_item_indexes: [0],
                labels: ["OP1"],
                titles: { english: "The Brave", japanese: "勇者", romaji: "Yuusha" },
                artists: [{ english: "YOASOBI", japanese: null, romaji: "YOASOBI" }],
                relative_path: "anime-ongaku-staging/request/01.flac",
                absolute_path: "/library/anime-ongaku-staging/request/01.flac",
                media_url: "/api/v1/jobs/amf-job-1/files/0",
                download_url: "/api/v1/jobs/amf-job-1/files/0?download=true",
                size: 1234,
                sha256: "a".repeat(64),
                metadata: { title: "勇者", artist: "YOASOBI" },
              }],
            }],
          },
        },
      },
    ],
  };
}

describe("AnimeMusicFetcherClient request contract", () => {
  it("uses the hardcoded AMF 0.2 API address and serializes a job with header idempotency", async () => {
    const { client, requests } = clientFor([
      { status: 202, body: JSON.stringify(jobFixture()) },
    ]);

    await expect(client.submitJob(request, "batch-uuid-1")).resolves.toMatchObject({
      id: "amf-job-1",
      status: "queued",
    });

    expect(requests[0]?.url).toBe(`${AMF_API_BASE_URL}/jobs`);
    expect(new Headers(requests[0]?.init?.headers).get("Idempotency-Key")).toBe("batch-uuid-1");
    expect(new Headers(requests[0]?.init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(request);
  });

  it("replays the same submission key without changing the request contract", async () => {
    const fixture = JSON.stringify(jobFixture());
    const { client, requests } = clientFor([
      { status: 202, body: fixture },
      { status: 202, body: fixture },
    ]);

    const first = await client.submitJob(request, "stable-batch-key");
    const replay = await client.submitJob(request, "stable-batch-key");

    expect(replay.id).toBe(first.id);
    expect(requests).toHaveLength(2);
    expect(requests.map((entry) => new Headers(entry.init?.headers).get("Idempotency-Key")))
      .toEqual(["stable-batch-key", "stable-batch-key"]);
    expect(requests.map((entry) => entry.init?.body)).toEqual([requests[0]?.init?.body, requests[0]?.init?.body]);
  });

  it("parses health and readiness outside the /api/v1 base path", async () => {
    const { fetch, requests } = routedFetch([
      { match: /\/health$/, response: { status: 200, body: JSON.stringify({ status: "ok" }) } },
      {
        match: /\/ready$/,
        response: {
          status: 200,
          body: JSON.stringify({
            status: "ready",
            database: true,
            prowlarr_configured: true,
            custom_source_count: 1,
            qbittorrent_configured: true,
          }),
        },
      },
    ]);
    const client = new AnimeMusicFetcherClient({
      http: createAnimeMusicFetcherUpstreamHttp({ fetch, maxRetries: 0 }),
    });

    await expect(client.getHealth()).resolves.toEqual({ status: "ok" });
    await expect(client.getReadiness()).resolves.toEqual({
      status: "ready",
      database: true,
      prowlarr_configured: true,
      custom_source_count: 1,
      qbittorrent_configured: true,
    });
    expect(requests.map((entry) => new URL(entry.url).pathname)).toEqual(["/health", "/ready"]);
  });

  it("rejects malformed health payloads instead of assuming availability", async () => {
    const { client } = clientFor([{ status: 200, body: "{}" }]);
    await expect(client.getHealth()).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("returns typed validation errors for invalid caller input without leaking Zod values", async () => {
    const { client, requests } = clientFor([{ status: 202, body: JSON.stringify(jobFixture()) }]);
    const invalid = { ...request, destination: "../private/request" };
    const error = await client.submitJob(invalid, "stable-key").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "INVALID_REQUEST", retryable: false });
    expect(String(error)).not.toContain("../private/request");
    expect(requests).toHaveLength(0);
  });

  it.each([
    {
      ...request,
      titles: { names: ["Alias only"] },
    },
    {
      ...request,
      quality: { min_size_bytes: 2_000, max_size_bytes: 1_000 },
    },
  ])("rejects AMF request constraints before making a remote call", async (invalidRequest) => {
    const { client, requests } = clientFor([{ status: 202, body: JSON.stringify(jobFixture()) }]);
    await expect(client.submitJob(invalidRequest, "stable-key")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(requests).toHaveLength(0);
  });
});

describe("AnimeMusicFetcherClient job lifecycle", () => {
  it("polls the sparse JSON:API v2 projection and retains importable localized media", async () => {
    const { client, requests } = clientFor([{ status: 200, body: JSON.stringify(jsonApiJobFixture()) }]);

    const job = await client.getJob("amf-job-1");

    expect(job).toMatchObject({
      id: "amf-job-1",
      status: "completed_with_warnings",
      warnings: ["OST could not be found"],
      item_results: [expect.objectContaining({ requested_item_index: 0, status: "delivered", file_count: 1 })],
    });
    expect(job.source_files).toEqual([]);
    expect(job.deliveries[0]?.files[0]?.metadata).toMatchObject({
      localized: {
        songTitles: { english: "The Brave", japanese: "勇者", romaji: "Yuusha" },
      },
    });

    const url = new URL(requests[0]!.url);
    expect(`${url.origin}/api/v2`).toBe(AMF_JSON_API_BASE_URL);
    expect(url.pathname).toBe("/api/v2/jobs/amf-job-1");
    expect(url.searchParams.get("include")).toBe("item_results,media");
    expect(url.searchParams.get("fields[jobs]")).toBe(
      "status,destination,last_progress,warnings,error_stage,error_message,created_at,updated_at,completed_at,item_results,media",
    );
    expect(url.searchParams.get("fields[item_results]")).toBe(
      "requested_item_index,label,kind,number,status,file_count",
    );
    expect(url.searchParams.get("fields[media]")).toBe("anime");
    expect(new Headers(requests[0]?.init?.headers).get("Accept")).toBe("application/vnd.api+json");
  });

  it("accepts delegated item results returned by aggregate follow-up jobs", async () => {
    const fixture = jobFixture("completed_with_warnings");
    fixture.item_results[0] = {
      ...fixture.item_results[0],
      status: "delegated",
      follow_up_job_id: "follow-up-1",
    } as typeof fixture.item_results[number];
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);

    await expect(client.getJob("amf-job-1")).resolves.toMatchObject({
      item_results: [expect.objectContaining({ status: "delegated" })],
    });
  });

  it.each([
    "queued",
    "searching",
    "awaiting_selection",
    "selected",
    "submitting",
    "downloading",
    "processing",
    "awaiting_file_selection",
    "completed",
    "completed_with_warnings",
    "download_stalled",
    "failed",
    "cancelled",
  ])("accepts the documented %s status", async (status) => {
    const { client } = clientFor([{ status: 200, body: JSON.stringify(jobFixture(status)) }]);
    await expect(client.getJob("amf-job-1")).resolves.toMatchObject({ status });
  });

  it("tolerates an unrecognized provider job status without failing the parse, preserving items and deliveries", async () => {
    const fixture = {
      ...jobFixture("brand_new_status"),
      item_results: [{
        requested_item_index: 0, label: "OP1", kind: "OP", number: 1, status: "delivered",
        candidate_indexes: [], selected_release_indexes: [0], matched_releases: [], delivered_files: [], file_count: 1,
      }],
      deliveries: [{
        requested_item_index: 0, label: "OP1", kind: "OP", number: 1,
        files: [{
          file_index: 0, relative_path: "anime-ongaku-staging/request/01.flac", absolute_path: "/library/01.flac",
          media_url: "/api/v1/jobs/amf-job-1/files/0", download_url: "/api/v1/jobs/amf-job-1/files/0?download=true",
          size: 10, sha256: "a".repeat(64), metadata: {},
        }],
      }],
    };
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);

    const job = await client.getJob("amf-job-1");

    expect(job.status).toBe("brand_new_status");
    expect(job.item_results[0]).toMatchObject({ status: "delivered", file_count: 1 });
    expect(job.deliveries[0]?.files[0]).toMatchObject({
      relative_path: "anime-ongaku-staging/request/01.flac",
      sha256: "a".repeat(64),
    });
  });

  it("tolerates the archived dormant status and keeps its deliveries importable", async () => {
    const fixture = {
      ...jobFixture("archived"),
      completed_at: null,
      item_results: [{
        requested_item_index: 0, label: "OP1", kind: "OP", number: 1, status: "delivered",
        candidate_indexes: [], selected_release_indexes: [0], matched_releases: [], delivered_files: [], file_count: 1,
      }],
      deliveries: [{
        requested_item_index: 0, label: "OP1", kind: "OP", number: 1,
        files: [{
          file_index: 0, relative_path: "anime-ongaku-staging/request/archived.flac", absolute_path: "/library/archived.flac",
          media_url: "/api/v1/jobs/amf-job-1/files/0", download_url: "/api/v1/jobs/amf-job-1/files/0?download=true",
          size: 10, sha256: "b".repeat(64), metadata: {},
        }],
      }],
    };
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);

    const job = await client.getJob("amf-job-1");

    expect(job.status).toBe("archived");
    expect(job.completed_at).toBeNull();
    expect(job.deliveries[0]?.files[0]).toMatchObject({ relative_path: "anime-ongaku-staging/request/archived.flac" });
  });

  it("parses successive polling transitions without collapsing intervention states", async () => {
    const { client } = clientFor([
      { status: 200, body: JSON.stringify(jobFixture("queued")) },
      { status: 200, body: JSON.stringify(jobFixture("searching")) },
      { status: 200, body: JSON.stringify(jobFixture("awaiting_selection")) },
      { status: 200, body: JSON.stringify(jobFixture("completed")) },
    ]);

    const statuses = [];
    for (let index = 0; index < 4; index += 1) statuses.push((await client.getJob("amf-job-1")).status);
    expect(statuses).toEqual(["queued", "searching", "awaiting_selection", "completed"]);
  });

  it("polls, retries, cancels, and reprocesses with encoded job identities", async () => {
    const { fetch, requests } = routedFetch([
      { match: "/retry", response: { status: 202, body: JSON.stringify(jobFixture("queued")) } },
      { match: "/cancel", response: { status: 200, body: JSON.stringify(jobFixture("cancelled")) } },
      { match: "/reprocess", response: { status: 202, body: JSON.stringify(jobFixture("processing")) } },
      { match: "/jobs/", response: { status: 200, body: JSON.stringify(jobFixture("processing")) } },
    ]);
    const client = new AnimeMusicFetcherClient({
      http: createAnimeMusicFetcherUpstreamHttp({ fetch, maxRetries: 0 }),
    });

    await expect(client.getJob("job/id with spaces")).resolves.toMatchObject({ status: "processing" });
    await expect(client.retryJob("job/id with spaces")).resolves.toMatchObject({ status: "queued" });
    await expect(client.cancelJob("job/id with spaces")).resolves.toMatchObject({ status: "cancelled" });
    await expect(client.reprocessJob("job/id with spaces")).resolves.toMatchObject({ status: "processing" });
    expect(requests.map((entry) => new URL(entry.url).pathname)).toEqual([
      "/api/v2/jobs/job%2Fid%20with%20spaces",
      "/api/v1/jobs/job%2Fid%20with%20spaces/retry",
      "/api/v1/jobs/job%2Fid%20with%20spaces/cancel",
      "/api/v1/jobs/job%2Fid%20with%20spaces/reprocess",
    ]);
  });

  it("parses item results, warnings, and deliveries without exposing AMF absolute paths", async () => {
    const fixture = {
      ...jobFixture("completed_with_warnings"),
      warnings: ["OST could not be found"],
      completed_at: "2026-07-21T12:30:00Z",
      item_results: [
        {
          requested_item_index: 0,
          label: "OP1",
          kind: "OP",
          number: 1,
          status: "delivered",
          candidate_indexes: [0],
          selected_release_indexes: [0],
          matched_releases: ["Frieren OP1"],
          delivered_files: ["anime-ongaku-staging/request/01.flac"],
          file_count: 1,
        },
      ],
      deliveries: [
        {
          requested_item_index: 0,
          label: "OP1",
          kind: "OP",
          number: 1,
          requested_metadata: { title: "Yuusha" },
          files: [
            {
              file_index: 0,
              relative_path: "anime-ongaku-staging/request/01.flac",
              absolute_path: "/library/anime-ongaku-staging/request/01.flac",
              media_url: "/api/v1/jobs/amf-job-1/files/0",
              download_url: "/api/v1/jobs/amf-job-1/files/0?download=true",
              size: 1234,
              sha256: "a".repeat(64),
              metadata: {
                title: "Yuusha",
                artist: "YOASOBI",
                album: "The Book 3",
                albumartist: "YOASOBI",
                track: "1/3",
                disc: 1,
                source_url: "https://tracker.invalid/private",
                absolute_path: "/library/private.flac",
              },
            },
          ],
        },
      ],
    };
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);

    const job = await client.getJob("amf-job-1");

    expect(job.warnings).toEqual(["OST could not be found"]);
    expect(job.item_results[0]).toMatchObject({ status: "delivered", file_count: 1 });
    expect(job.deliveries[0]?.files[0]).toMatchObject({
      file_index: 0,
      relative_path: "anime-ongaku-staging/request/01.flac",
      sha256: "a".repeat(64),
      metadata: {
        title: "Yuusha",
        artist: "YOASOBI",
        album: "The Book 3",
        albumartist: "YOASOBI",
        track: "1/3",
        disc: 1,
      },
    });
    expect(job.deliveries[0]?.files[0]).not.toHaveProperty("absolute_path");
    expect(job.deliveries[0]?.files[0]).not.toHaveProperty("media_url");
    expect(job.deliveries[0]?.files[0]).not.toHaveProperty("download_url");
    expect(job.deliveries[0]?.files[0]?.metadata).not.toHaveProperty("source_url");
    expect(job.deliveries[0]?.files[0]?.metadata).not.toHaveProperty("absolute_path");
    expect(JSON.stringify(job.deliveries)).not.toContain("/library/");
  });

  it("projects AMF 0.2 localized media into safe delivery metadata with English display first", async () => {
    const fixture = {
      ...jobFixture("completed"),
      output_manifest: undefined,
      deliveries: undefined,
      media: {
        anime: {
          titles: { english: "The Apothecary Diaries", romaji: "Kusuriya no Hitorigoto", japanese: "薬屋のひとりごと" },
          albums: [{
            titles: { english: "Season 2 Original Soundtrack", romaji: "Kusuriya no Hitorigoto 2 OST", japanese: "薬屋のひとりごと 第2期 OST" },
            songs: [{
              file_index: 7,
              requested_item_indexes: [0],
              labels: ["OP1"],
              titles: { english: "Hyakka Ryouran", romaji: "Hyakka Ryouran", japanese: "百花繚乱" },
              artists: [{ english: "Lilas Ikuta", romaji: "Ikuta Lilas", japanese: "幾田りら" }],
              relative_path: "anime-ongaku-staging/request/07.flac",
              absolute_path: "/library/anime-ongaku-staging/request/07.flac",
              media_url: "/api/v1/jobs/amf-job-1/files/7",
              download_url: "/api/v1/jobs/amf-job-1/files/7?download=true",
              size: 1234,
              sha256: "b".repeat(64),
              metadata: { track: 1, source_url: "https://private.invalid/source" },
            }],
          }],
        },
      },
      item_results: [{
        requested_item_index: 0,
        label: "OP1",
        kind: "OP",
        number: 1,
        status: "delivered",
        candidate_indexes: [], selected_release_indexes: [], matched_releases: [], delivered_files: [], file_count: 1,
      }],
    };
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);

    const job = await client.getJob("amf-job-1");

    expect(job.deliveries).toHaveLength(1);
    expect(job.deliveries[0]?.files[0]?.metadata).toEqual({
      track: 1,
      localized: {
        animeTitles: { english: "The Apothecary Diaries", romaji: "Kusuriya no Hitorigoto", japanese: "薬屋のひとりごと" },
        albumTitles: { english: "Season 2 Original Soundtrack", romaji: "Kusuriya no Hitorigoto 2 OST", japanese: "薬屋のひとりごと 第2期 OST" },
        songTitles: { english: "Hyakka Ryouran", romaji: "Hyakka Ryouran", japanese: "百花繚乱" },
        artists: [{ english: "Lilas Ikuta", romaji: "Ikuta Lilas", japanese: "幾田りら" }],
      },
    });
    expect(JSON.stringify(job)).not.toContain("private.invalid");
    expect(JSON.stringify(job)).not.toContain("/library/");
  });

  it("keeps legacy item association when valid AMF media omits requested item indexes", async () => {
    const file = {
      file_index: 2, relative_path: "anime-ongaku-staging/request/02.flac", absolute_path: "/library/anime-ongaku-staging/request/02.flac",
      media_url: "/api/v1/jobs/amf-job-1/files/2", download_url: "/api/v1/jobs/amf-job-1/files/2?download=true",
    };
    const fixture = { ...jobFixture("completed"), deliveries: [{ requested_item_index: 0, label: "OP1", kind: "OP", number: 1, files: [file] }],
      media: { anime: { titles: { english: "English Anime", romaji: null, japanese: null }, albums: [{
        titles: { english: "English Album", romaji: null, japanese: null }, songs: [{ ...file,
          titles: { english: "English Song", romaji: null, japanese: null }, artists: [], labels: [], metadata: {} }],
      }] } } };
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);
    const job = await client.getJob("amf-job-1");
    expect(job.deliveries[0]?.requested_item_index).toBe(0);
    expect(job.deliveries[0]?.files[0]?.metadata).toMatchObject({ localized: { songTitles: { english: "English Song" } } });
  });

  it("defaults response collections and nullable warnings without inventing delivery evidence", async () => {
    const fixture = jobFixture();
    const { source_files: _sourceFiles, deliveries: _deliveries, item_results: _itemResults, ...withoutCollections } = fixture;
    const { client } = clientFor([{ status: 200, body: JSON.stringify({ ...withoutCollections, warnings: null }) }]);

    await expect(client.getJob("amf-job-1")).resolves.toMatchObject({
      source_files: [],
      deliveries: [],
      item_results: [],
      warnings: [],
    });
  });

  it("preserves the same file index when separate requested items reference it", async () => {
    const deliveryFile = {
      file_index: 4,
      relative_path: "anime-ongaku-staging/request/shared.flac",
      absolute_path: "/library/anime-ongaku-staging/request/shared.flac",
      media_url: "/api/v1/jobs/amf-job-1/files/4",
      download_url: "/api/v1/jobs/amf-job-1/files/4?download=true",
    };
    const fixture = {
      ...jobFixture("completed"),
      deliveries: [
        { requested_item_index: 0, label: "OP1", kind: "OP", files: [deliveryFile] },
        { requested_item_index: 1, label: "OST", kind: "OST", files: [deliveryFile] },
      ],
    };
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);

    const job = await client.getJob("amf-job-1");
    expect(job.deliveries.map((delivery) => [delivery.requested_item_index, delivery.files[0]?.file_index]))
      .toEqual([[0, 4], [1, 4]]);
  });

  it("projects an AMF job without opaque provider URLs, paths, errors, or passthrough fields", async () => {
    const fixture = {
      ...jobFixture("failed"),
      request_payload: { source_url: "https://tracker.invalid/private", absolute_path: "/downloads/private" },
      candidate_snapshot: [{ download_url: "https://tracker.invalid/candidate" }],
      selected_releases: [{ locator: "magnet:?xt=private" }],
      downloads: [{ save_path: "/downloads/job", source_url: "https://tracker.invalid/download" }],
      output_manifest: [{ absolute_path: "/library/private.flac" }],
      error_stage: "/downloads/private-stage",
      error_message: "failed at /config/private with https://tracker.invalid/token",
      warnings: ["provider used https://tracker.invalid/warn and /library/private.flac"],
      source_files: [{
        source_file_index: 0,
        release_index: 0,
        relative_path: "retained/song.flac",
        media_url: "/api/v1/jobs/amf-job-1/source-files/0",
        metadata: {
          title: "https://tracker.invalid/not-a-title",
          artist: "/downloads/private",
          absolute_path: "/downloads/private",
          source_url: "https://tracker.invalid/source",
        },
        suggested_item_indexes: [0],
        secret_extension: "https://tracker.invalid/unknown",
      }],
      deliveries: [{
        requested_item_index: 0,
        label: "OP1",
        kind: "OP",
        requested_metadata: { source_url: "https://tracker.invalid/requested" },
        secret_extension: "/config/unknown",
        files: [{
          file_index: 0,
          relative_path: "anime-ongaku-staging/request/song.flac",
          absolute_path: "/library/anime-ongaku-staging/request/song.flac",
          media_url: "/api/v1/jobs/amf-job-1/files/0",
          download_url: "/api/v1/jobs/amf-job-1/files/0?download=true",
          metadata: {
            title: "magnet:?xt=private",
            album: "C:\\private\\album",
            source_url: "https://tracker.invalid/delivery",
            absolute_path: "/library/private",
          },
          secret_extension: "magnet:?xt=private",
        }],
      }],
      item_results: [{
        requested_item_index: 0,
        label: "OP1",
        kind: "OP",
        status: "found",
        matched_releases: ["release https://tracker.invalid/title"],
        secret_extension: "/downloads/private",
      }],
      secret_extension: "https://tracker.invalid/top-level",
    };
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);

    const job = await client.getJob("amf-job-1");
    const serialized = JSON.stringify(job);

    expect(job).not.toHaveProperty("request_payload");
    expect(job).not.toHaveProperty("candidate_snapshot");
    expect(job).not.toHaveProperty("selected_releases");
    expect(job).not.toHaveProperty("downloads");
    expect(job).not.toHaveProperty("output_manifest");
    expect(job).not.toHaveProperty("error_message");
    expect(job).not.toHaveProperty("secret_extension");
    expect(job).toMatchObject({ has_error: true, error_stage: "[redacted]" });
    expect(job.deliveries[0]).not.toHaveProperty("requested_metadata");
    expect(job.deliveries[0]?.files[0]?.metadata).toEqual({});
    expect(job.source_files[0]?.metadata).toEqual({});
    expect(job.deliveries[0]?.files[0]).not.toHaveProperty("media_url");
    expect(job.deliveries[0]?.files[0]).not.toHaveProperty("download_url");
    expect(job.source_files[0]).not.toHaveProperty("media_url");
    expect(serialized).not.toContain("tracker.invalid");
    expect(serialized).not.toContain("magnet:");
    expect(serialized).not.toContain("/downloads/");
    expect(serialized).not.toContain("/library/");
    expect(serialized).not.toContain("/config/");
  });
});

describe("AnimeMusicFetcherClient deterministic failures", () => {
  it("rejects malformed JSON, missing fields, and unsafe delivery paths", async () => {
    const malformedCases = [
      "not-json",
      JSON.stringify({ id: "missing-fields" }),
      JSON.stringify({
        ...jobFixture("completed"),
        deliveries: [{
          requested_item_index: 0,
          label: "OP1",
          kind: "OP",
          files: [{
            file_index: 0,
            relative_path: "../private/song.flac",
            absolute_path: "/library/../private/song.flac",
            media_url: "/media/0",
            download_url: "/media/0?download=true",
          }],
        }],
      }),
    ];

    for (const body of malformedCases) {
      const { client } = clientFor([{ status: 200, body }]);
      await expect(client.getJob("amf-job-1")).rejects.toMatchObject({
        name: "AnimeMusicFetcherError",
        code: "MALFORMED_RESPONSE",
        retryable: false,
      });
    }
  });

  it.each([
    "",
    "/absolute/song.flac",
    "C:/library/song.flac",
    "//server/share/song.flac",
    "folder\\song.flac",
    "./folder/song.flac",
    "folder/./song.flac",
    "folder/../song.flac",
    "folder//song.flac",
  ])("rejects unsafe delivery relative path %j", async (relativePath) => {
    const fixture = {
      ...jobFixture("completed"),
      deliveries: [{
        requested_item_index: 0,
        label: "OP1",
        kind: "OP",
        files: [{
          file_index: 0,
          relative_path: relativePath,
          absolute_path: "/library/song.flac",
          media_url: "/media/0",
          download_url: "/media/0?download=true",
        }],
      }],
    };
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);
    await expect(client.getJob("amf-job-1")).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("requires AMF absolute_path in the wire response but drops it after validation", async () => {
    const fixture = {
      ...jobFixture("completed"),
      deliveries: [{
        requested_item_index: 0,
        label: "OP1",
        kind: "OP",
        files: [{
          file_index: 0,
          relative_path: "safe/song.flac",
          absolute_path: "",
          media_url: "/media/0",
          download_url: "/media/0?download=true",
        }],
      }],
    };
    const { client } = clientFor([{ status: 200, body: JSON.stringify(fixture) }]);
    await expect(client.getJob("amf-job-1")).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it.each([
    [400, "BAD_REQUEST", false],
    [401, "AUTHENTICATION_FAILED", false],
    [403, "AUTHENTICATION_FAILED", false],
    [404, "NOT_FOUND", false],
    [408, "UPSTREAM_TIMEOUT", true],
    [409, "IDEMPOTENCY_CONFLICT", false],
    [422, "BAD_REQUEST", false],
    [429, "RATE_LIMITED", true],
    [500, "UPSTREAM_FAILURE", true],
  ] as const)("classifies HTTP %i as %s", async (status, code, retryable) => {
    const { client } = clientFor([{ status, body: "private /library/path?token=secret" }]);
    const error = await client.submitJob(request, "stable-key").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnimeMusicFetcherError);
    expect(error).toMatchObject({ code, retryable, status });
    expect(String(error)).not.toContain("private");
    expect(String(error)).not.toContain("token");
    expect(String(error)).not.toContain("/library/");
  });

  it("uses a neutral state conflict for non-submission 409 responses", async () => {
    const { client } = clientFor([{ status: 409, body: "not retryable in current state" }]);
    await expect(client.retryJob("amf-job-1")).rejects.toMatchObject({
      code: "CONFLICT",
      retryable: false,
      status: 409,
    });
  });

  it("classifies transport failures as retryable without leaking the requested URL", async () => {
    const { client } = clientFor([new Error("connect ECONNREFUSED http://secret.invalid/private")]);
    const error = await client.getJob("private-job-id").catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "AnimeMusicFetcherError",
      code: "NETWORK_FAILURE",
      retryable: true,
    });
    expect(String(error)).not.toContain("secret.invalid");
    expect(String(error)).not.toContain("private-job-id");
  });

  it("uses a background token-bucket lane and redacts URLs from upstream logs", async () => {
    const { fetch } = fakeFetch([{ status: 200, body: JSON.stringify(jobFixture()) }]);
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1 });
    const acquire = vi.spyOn(bucket, "acquire");
    const logs: unknown[] = [];
    const client = new AnimeMusicFetcherClient({
      http: createAnimeMusicFetcherUpstreamHttp({
        fetch,
        maxRetries: 0,
        bucket,
        logger: { info: (data, message) => logs.push({ data, message }) },
      }),
    });

    await client.getJob("private-job-id");

    expect(acquire).toHaveBeenCalledWith("background");
    expect(JSON.stringify(logs)).not.toContain("private-job-id");
    expect(JSON.stringify(logs)).not.toContain("192.168.68.68");
  });
});
