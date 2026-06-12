import { KitsuAuthClient, KitsuAuthError, KitsuAuthResult } from "./types.js";

const STUB_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Accepts any non-empty credentials and derives a deterministic Kitsu user id
 * from the username. Used until the real Kitsu OAuth client lands (S2) and in
 * tests; selected via KITSU_AUTH_MODE=stub.
 */
export class StubKitsuAuthClient implements KitsuAuthClient {
  async login(username: string, password: string): Promise<KitsuAuthResult> {
    if (!username.trim() || !password) {
      throw new KitsuAuthError("Invalid Kitsu credentials.");
    }
    return {
      kitsuUserId: `stub-${username.trim().toLowerCase()}`,
      username: username.trim(),
      accessToken: "stub-access-token",
      refreshToken: "stub-refresh-token",
      expiresAt: new Date(Date.now() + STUB_TOKEN_TTL_MS),
    };
  }
}
