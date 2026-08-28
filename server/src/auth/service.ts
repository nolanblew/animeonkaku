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
export const SESSION_IDLE_REAUTH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A returning user whose server library was synced within this window gets a
 * DELTA first-sync at login (activity-triggered deltas keep them fresh); any
 * longer and we re-run a FULL library sync. Full sync only refreshes the
 * library (tombstoning removed entries) — playlists, likes/dislikes, and play
 * counts are never touched by it.
 */
export const FULL_RESYNC_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type LoginSyncMode = "FULL" | "DELTA";

export interface LoginInput {
  username: string;
  password: string;
  deviceName?: string | undefined;
}

export interface LoginResult {
  token: string;
  user: { kitsuUserId: string; username: string };
  kitsuAvatarUrl: string | null;
  isNewUser: boolean;
  /** Which first-sync the server will run (and the client should present). */
  syncMode: LoginSyncMode;
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
  kitsuAvatarUrl: string | null;
  kitsuAuthState: string;
  lastSyncAt: number | null;
  devices: DeviceInfo[];
}

export class AuthService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: AuthRepo,
    private readonly kitsu: KitsuAuthClient,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /** Kitsu password grant via the injected client, then local user + device session. */
  async login(input: LoginInput): Promise<LoginResult> {
    const kitsuAuth = await this.kitsu.login(input.username, input.password);
    const { user, created } = await this.repo.upsertUser({
      kitsuUserId: kitsuAuth.kitsuUserId,
      username: kitsuAuth.username,
      kitsuAvatarUrl: kitsuAuth.avatarUrl ?? null,
      kitsuAccessToken: kitsuAuth.accessToken,
      kitsuRefreshToken: kitsuAuth.refreshToken,
      kitsuTokenExpiresAt: kitsuAuth.expiresAt,
    });

    const token = generateToken();
    await this.repo.createSession({
      userId: user.kitsuUserId,
      tokenHash: hashToken(token),
      deviceName: input.deviceName ?? "unknown",
      expiresAt: new Date(this.now().getTime() + SESSION_TTL_MS),
    });

    return {
      token,
      user: { kitsuUserId: user.kitsuUserId, username: user.username },
      kitsuAvatarUrl: user.kitsuAvatarUrl,
      isNewUser: created,
      syncMode: this.resolveSyncMode(created, user.lastSyncAt),
    };
  }

  /**
   * New users and users whose library hasn't synced on this server within
   * FULL_RESYNC_AFTER_MS need a FULL library sync; everyone else just gets a
   * DELTA to pick up whatever changed since the server's last (auto) sync.
   */
  private resolveSyncMode(created: boolean, lastSyncAt: Date | null): LoginSyncMode {
    if (created || !lastSyncAt) return "FULL";
    const age = this.now().getTime() - lastSyncAt.getTime();
    return age >= FULL_RESYNC_AFTER_MS ? "FULL" : "DELTA";
  }

  /** Resolves a bearer token to its user+session; null when unknown or expired. */
  async authenticate(token: string): Promise<AuthContext | null> {
    const found = await this.repo.findSessionByTokenHash(hashToken(token));
    if (!found) return null;
    const now = this.now();
    if (found.session.expiresAt.getTime() <= now.getTime()) return null;
    if (now.getTime() - found.session.lastUsedAt.getTime() >= SESSION_IDLE_REAUTH_AFTER_MS) {
      await this.repo.deleteSession(found.session.id);
      return null;
    }
    await this.repo.touchSession(found.session.id, now);
    return found;
  }

  async me(ctx: AuthContext): Promise<MeResult> {
    const sessions = await this.repo.listSessions(ctx.user.kitsuUserId);
    return {
      user: { kitsuUserId: ctx.user.kitsuUserId, username: ctx.user.username },
      kitsuAvatarUrl: ctx.user.kitsuAvatarUrl,
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
