import { describe, expect, it } from "vitest";
import { RealKitsuAuthClient } from "../src/kitsu/kitsuAuthClient.js";
import { KitsuAuthError } from "../src/auth/types.js";
import { UpstreamHttp } from "../src/http/upstream.js";
import { routedFetch } from "./helpers/fakeFetch.js";
import { FakeTime } from "./helpers/fakeTime.js";

const TOKEN_OK = JSON.stringify({
  access_token: "at-1",
  refresh_token: "rt-1",
  expires_in: 3600,
  created_at: 1_700_000_000,
});

const SELF_USER = JSON.stringify({
  data: [{ id: "12345", type: "users", attributes: { name: "Nolan", slug: "nolan" } }],
});

function client(routes: Parameters<typeof routedFetch>[0]) {
  const { fetch, requests } = routedFetch(routes);
  const time = new FakeTime();
  const http = new UpstreamHttp({ fetch, sleep: time.sleep, maxRetries: 0 });
  return {
    client: new RealKitsuAuthClient({ http, clientId: "cid", clientSecret: "csec" }),
    requests,
  };
}

describe("RealKitsuAuthClient.login", () => {
  it("performs the password grant then resolves the self user", async () => {
    const { client: kitsu, requests } = client([
      { match: "/oauth/token", response: { status: 200, body: TOKEN_OK } },
      { match: "filter%5Bself%5D=true", response: { status: 200, body: SELF_USER } },
    ]);

    const result = await kitsu.login("nolan", "p@ss word");

    expect(result.kitsuUserId).toBe("12345");
    expect(result.username).toBe("Nolan");
    expect(result.accessToken).toBe("at-1");
    expect(result.refreshToken).toBe("rt-1");
    expect(result.expiresAt?.getTime()).toBe((1_700_000_000 + 3600) * 1000);

    const tokenReq = requests[0]!;
    expect(tokenReq.init?.method).toBe("POST");
    const body = String(tokenReq.init?.body);
    expect(body).toContain("grant_type=password");
    expect(body).toContain("username=nolan");
    expect(body).toContain("client_id=cid");
    expect(body).not.toContain("p@ss word"); // password must be form-encoded

    const selfReq = requests[1]!;
    expect(selfReq.url).toContain("users?");
    const headers = selfReq.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer at-1");
  });

  it("maps OAuth failures to KitsuAuthError", async () => {
    const { client: kitsu } = client([
      {
        match: "/oauth/token",
        response: {
          status: 401,
          body: JSON.stringify({ error: "invalid_grant", error_description: "wrong password" }),
        },
      },
    ]);
    await expect(kitsu.login("nolan", "bad")).rejects.toThrow(KitsuAuthError);
    await expect(kitsu.login("nolan", "bad")).rejects.toThrow(/wrong password/);
  });

  it("fails with KitsuAuthError when the self-user lookup returns nobody", async () => {
    const { client: kitsu } = client([
      { match: "/oauth/token", response: { status: 200, body: TOKEN_OK } },
      { match: "filter%5Bself%5D=true", response: { status: 200, body: '{"data":[]}' } },
    ]);
    await expect(kitsu.login("nolan", "pw")).rejects.toThrow(KitsuAuthError);
  });
});

describe("RealKitsuAuthClient.refresh", () => {
  it("exchanges a refresh token", async () => {
    const { client: kitsu, requests } = client([
      { match: "/oauth/token", response: { status: 200, body: TOKEN_OK } },
    ]);
    const tokens = await kitsu.refresh("rt-old");
    expect(tokens.accessToken).toBe("at-1");
    const body = String(requests[0]!.init?.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=rt-old");
  });
});
