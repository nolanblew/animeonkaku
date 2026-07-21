import type { ZodType } from "zod";
import type { UpstreamHttp } from "../../http/upstream.js";
import {
  amfMalformedResponse,
  amfInvalidRequest,
  amfNetworkError,
  amfResponseError,
} from "./errors.js";
import {
  amfHealthSchema,
  amfJobCreateSchema,
  amfJobSchema,
  amfReadinessSchema,
  type AmfJob,
  type AmfJobCreate,
} from "./schemas.js";

export const AMF_API_BASE_URL = "http://192.168.68.68:9292/api/v1";
const AMF_SERVICE_BASE_URL = new URL(AMF_API_BASE_URL).origin;

export interface AnimeMusicFetcherClientOptions {
  http: UpstreamHttp;
}

export class AnimeMusicFetcherClient {
  constructor(private readonly options: AnimeMusicFetcherClientOptions) {}

  async getHealth() {
    return this.requestJson("health check", `${AMF_SERVICE_BASE_URL}/health`, undefined, amfHealthSchema);
  }

  async getReadiness() {
    return this.requestJson("readiness check", `${AMF_SERVICE_BASE_URL}/ready`, undefined, amfReadinessSchema);
  }

  async submitJob(input: AmfJobCreate, idempotencyKey: string): Promise<AmfJob> {
    const parsedRequest = amfJobCreateSchema.safeParse(input);
    if (!parsedRequest.success) throw amfInvalidRequest("job submission input");
    const request = parsedRequest.data;
    if (idempotencyKey.length === 0 || idempotencyKey.length > 200) {
      throw amfInvalidRequest("idempotency key");
    }
    return this.requestJson(
      "job submission",
      `${AMF_API_BASE_URL}/jobs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(request),
      },
      amfJobSchema,
    );
  }

  async getJob(jobId: string): Promise<AmfJob> {
    return this.requestJson("job poll", this.jobUrl(jobId), undefined, amfJobSchema);
  }

  async retryJob(jobId: string): Promise<AmfJob> {
    return this.requestJson("job retry", `${this.jobUrl(jobId)}/retry`, { method: "POST" }, amfJobSchema);
  }

  async cancelJob(jobId: string): Promise<AmfJob> {
    return this.requestJson("job cancellation", `${this.jobUrl(jobId)}/cancel`, { method: "POST" }, amfJobSchema);
  }

  private jobUrl(jobId: string): string {
    if (jobId.length === 0) throw amfInvalidRequest("job identity");
    return `${AMF_API_BASE_URL}/jobs/${encodeURIComponent(jobId)}`;
  }

  private async requestJson<T>(
    action: string,
    url: string,
    init: RequestInit | undefined,
    schema: ZodType<T>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.options.http.request(url, init);
    } catch {
      throw amfNetworkError(action);
    }
    if (!response.ok) throw amfResponseError(response.status, action);

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw amfMalformedResponse(action);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw amfMalformedResponse(action);
    return parsed.data;
  }
}
