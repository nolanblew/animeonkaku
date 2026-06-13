import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import type { JobAdminService } from "../src/jobs/adminRoutes.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-test-"));

class FakeJobAdmin implements JobAdminService {
  retried: number[] = [];

  async listJobs(status?: string) {
    return [
      {
        id: 42,
        type: "FETCH_AUDIO",
        priority: 0,
        state: status ?? "FAILED",
        payload: { themeId: 3040 },
        dedupeKey: "FETCH_AUDIO:3040",
        attempts: 2,
        maxAttempts: 5,
        nextRunAt: new Date(0),
        lastError: "origin down",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ];
  }

  async retryJob(id: number) {
    this.retried.push(id);
    return {
      id,
      type: "FETCH_AUDIO",
      priority: 0,
      state: "QUEUED",
      payload: { themeId: 3040 },
      dedupeKey: "FETCH_AUDIO:3040",
      attempts: 2,
      maxAttempts: 5,
      nextRunAt: new Date(0),
      lastError: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }
}

let app: FastifyInstance;
let jobs: FakeJobAdmin;

beforeEach(() => {
  jobs = new FakeJobAdmin();
  app = buildApp({
    authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
    health: { pingDb: async () => {}, mediaRoot },
    jobs,
  });
});

afterEach(async () => {
  await app.close();
});

async function token() {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username: "nolan", password: "hunter2" },
  });
  return res.json().token as string;
}

describe("job admin routes", () => {
  it("requires bearer auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/jobs?status=failed" });
    expect(res.statusCode).toBe(401);
  });

  it("lists jobs filtered by status", async () => {
    const bearer = await token();
    const res = await app.inject({
      method: "GET",
      url: "/v1/jobs?status=FAILED",
      headers: { authorization: `Bearer ${bearer}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().jobs[0]).toMatchObject({
      id: 42,
      state: "FAILED",
      payload: { themeId: 3040 },
    });
  });

  it("retries failed jobs", async () => {
    const bearer = await token();
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/42/retry",
      headers: { authorization: `Bearer ${bearer}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().job.state).toBe("QUEUED");
    expect(jobs.retried).toEqual([42]);
  });
});
