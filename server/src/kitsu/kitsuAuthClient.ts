import { KitsuAuthError, type KitsuAuthClient, type KitsuAuthResult } from "../auth/types.js";
import type { UpstreamHttp } from "../http/upstream.js";
import { parseKitsuTokenResponse } from "./authParsing.js";
import type { KitsuSelfUser, KitsuTokens } from "./types.js";

const AUTH_TOKEN_URL = "https://kitsu.io/api/oauth/token";
const EDGE_BASE_URL = "https://kitsu.io/api/edge";

export interface RealKitsuAuthClientDeps {
  http: UpstreamHttp;
  clientId: string;
  clientSecret: string;
}

/** Real Kitsu OAuth password/refresh grants (doc 02), selected via KITSU_AUTH_MODE=real. */
export class RealKitsuAuthClient implements KitsuAuthClient {
  constructor(private readonly deps: RealKitsuAuthClientDeps) {}

  async login(username: string, password: string): Promise<KitsuAuthResult> {
    const tokens = await this.tokenGrant({
      grant_type: "password",
      username,
      password,
    });

    const self = await this.fetchSelfUser(tokens.accessToken);
    if (!self) {
      throw new KitsuAuthError("Kitsu login succeeded but returned no user.");
    }

    return {
      kitsuUserId: self.id,
      username: self.name || username,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    };
  }

  async refresh(refreshToken: string): Promise<KitsuTokens> {
    return this.tokenGrant({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  private async tokenGrant(fields: Record<string, string>): Promise<KitsuTokens> {
    const body = new URLSearchParams({
      ...fields,
      client_id: this.deps.clientId,
      client_secret: this.deps.clientSecret,
    }).toString();

    const response = await this.deps.http.request(AUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    return parseKitsuTokenResponse(await response.text(), response.status);
  }

  private async fetchSelfUser(accessToken: string): Promise<KitsuSelfUser | null> {
    const params = new URLSearchParams({ "filter[self]": "true" });
    const response = await this.deps.http.request(`${EDGE_BASE_URL}/users?${params}`, {
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw new KitsuAuthError(`Kitsu self-user lookup failed (HTTP ${response.status}).`);
    }

    const json = (await response.json()) as {
      data?: Array<{ id?: unknown; attributes?: { name?: unknown; slug?: unknown } }>;
    };
    const user = json.data?.[0];
    if (!user || user.id === undefined || user.id === null) return null;
    const name = user.attributes?.name ?? user.attributes?.slug;
    return { id: String(user.id), name: typeof name === "string" ? name : "" };
  }
}
