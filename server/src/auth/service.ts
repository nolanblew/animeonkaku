import { generateToken, hashToken } from "./tokens.js";
import {
  AuthRepo,
  KitsuAuthClient,
  SessionRecord,
  UserRecord,
} from "./types.js";

// TETHER (handoff to backend devs): sessions are now effectively non-expiring for this
// personal deployment. The token only becomes invalid via explicit logout, device revoke,
// or a deliberate server-side reset (deleting session rows). 100 years keeps the existing
// non-null expiresAt column (no schema migration). See .planning/tether/03-backend-handoff.md.
export const SESSION_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000;

export interface LoginInput {
  username: string;
  password: string;
  deviceName?: string | undefined;
}

export interface LoginResult {
  token: string;
  user: { kitsuUserId: string; username: string };
  isNewUser: boolean;
}

export interface AuthContext {
  user: UserRecord;
  session: SessionRecord;
}

export interface DeviceInfo {
  id: number;
  deviceName: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}

export interface MeResult {
  user: { kitsuUserId: string; username: string };
  kitsuAuthState: string;
  lastSyncAt: number | null;
  devices: DeviceInfo[];
}

export class AuthService {
  constructor(
    private readonly repo: AuthRepo,
    private readonly kitsu: KitsuAuthClient,
  ) {}

  /** Kitsu password grant via the injected client, then local user + device session. */
  async login(input: LoginInput): Promise<LoginResult> {
    const kitsuAuth = await this.kitsu.login(input.username, input.password);
    const { user, created } = await this.repo.upsertUser({
      kitsuUserId: kitsuAuth.kitsuUserId,
      username: kitsuAuth.username,
      kitsuAccessToken: kitsuAuth.accessToken,
      kitsuRefreshToken: kitsuAuth.refreshToken,
      kitsuTokenExpiresAt: kitsuAuth.expiresAt,
    });

    const token = generateToken();
    await this.repo.createSession({
      userId: user.kitsuUserId,
      tokenHash: hashToken(token),
      deviceName: input.deviceName ?? "unknown",
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    return {
      token,
      user: { kitsuUserId: user.kitsuUserId, username: user.username },
      isNewUser: created,
    };
  }

  /** Resolves a bearer token to its user+session; null when unknown or expired. */
  async authenticate(token: string): Promise<AuthContext | null> {
    const found = await this.repo.findSessionByTokenHash(hashToken(token));
    if (!found) return null;
    if (found.session.expiresAt.getTime() <= Date.now()) return null;
    await this.repo.touchSession(found.session.id, new Date());
    return found;
  }

  async me(ctx: AuthContext): Promise<MeResult> {
    const sessions = await this.repo.listSessions(ctx.user.kitsuUserId);
    return {
      user: { kitsuUserId: ctx.user.kitsuUserId, username: ctx.user.username },
      kitsuAuthState: ctx.user.kitsuAuthState,
      lastSyncAt: ctx.user.lastSyncAt?.getTime() ?? null,
      devices: sessions.map((s) => ({
        id: s.id,
        deviceName: s.deviceName,
        createdAt: s.createdAt.getTime(),
        lastUsedAt: s.lastUsedAt.getTime(),
        current: s.id === ctx.session.id,
      })),
    };
  }

  async logout(ctx: AuthContext): Promise<void> {
    await this.repo.deleteSession(ctx.session.id);
  }

  /** Returns false when the session does not exist or belongs to another user. */
  async revokeDevice(ctx: AuthContext, sessionId: number): Promise<boolean> {
    return this.repo.deleteSessionForUser(sessionId, ctx.user.kitsuUserId);
  }
}
