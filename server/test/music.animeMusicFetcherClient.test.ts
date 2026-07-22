import { describe, expect, it, vi } from "vitest";
import { TokenBucket } from "../src/http/tokenBucket.js";
import {
  AMF_API_BASE_URL,
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
      "/api/v1/jobs/job%2Fid%20with%20spaces",
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
  it("rejects malformed JSON, missing fields, unknown statuses, and unsafe delivery paths", async () => {
    const malformedCases = [
      "not-json",
      JSON.stringify({ id: "missing-fields" }),
      JSON.stringify(jobFixture("brand_new_status")),
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
