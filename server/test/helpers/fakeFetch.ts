import type { FetchLike } from "../../src/http/types.js";

export interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

export type FakeResponse =
  | { status: number; body?: string; headers?: Record<string, string> }
  | Error;

/**
 * Scripted fetch: returns/throws the queued responses in order and records
 * every request. The last script entry repeats if more requests arrive.
 */
export function fakeFetch(script: FakeResponse[]): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, init });
    const entry = script[Math.min(index, script.length - 1)]!;
    index += 1;
    if (entry instanceof Error) throw entry;
    return new Response(entry.body ?? "", {
      status: entry.status,
      headers: entry.headers ?? {},
    });
  };
  return { fetch, requests };
}

/** Routes requests by URL substring; falls back to 404. */
export function routedFetch(
  routes: Array<{ match: string | RegExp; response: FakeResponse | ((url: string) => FakeResponse) }>,
): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, init });
    for (const route of routes) {
      const matched =
        typeof route.match === "string" ? url.includes(route.match) : route.match.test(url);
      if (matched) {
        const entry = typeof route.response === "function" ? route.response(url) : route.response;
        if (entry instanceof Error) throw entry;
        return new Response(entry.body ?? "", { status: entry.status, headers: entry.headers ?? {} });
      }
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, requests };
}
