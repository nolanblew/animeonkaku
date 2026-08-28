import {
  AuthRepo,
  CreateSessionInput,
  SessionRecord,
  UpsertUserInput,
  UserRecord,
} from "../../src/auth/types.js";
import type { UserProfile, UserProfileRepo } from "../../src/auth/profile.js";

interface StoredUser extends UserRecord {
  displayName: string | null;
  avatarPath: string | null;
  kitsuAccessToken: string;
  kitsuRefreshToken: string | null;
}

interface StoredSession extends SessionRecord {
  tokenHash: string;
}

export class FakeAuthRepo implements AuthRepo, UserProfileRepo {
  users = new Map<string, StoredUser>();
  sessions = new Map<number, StoredSession>();
  private nextSessionId = 1;

  async upsertUser(input: UpsertUserInput): Promise<{ user: UserRecord; created: boolean }> {
    const existing = this.users.get(input.kitsuUserId);
    const user: StoredUser = {
      kitsuUserId: input.kitsuUserId,
      username: input.username,
      kitsuAvatarUrl: input.kitsuAvatarUrl,
      displayName: existing?.displayName ?? null,
      avatarPath: existing?.avatarPath ?? null,
      kitsuAuthState: "OK",
      lastSyncAt: existing?.lastSyncAt ?? null,
      kitsuAccessToken: input.kitsuAccessToken,
      kitsuRefreshToken: input.kitsuRefreshToken,
    };
    this.users.set(input.kitsuUserId, user);
    return { user, created: !existing };
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const session: StoredSession = {
      id: this.nextSessionId++,
      userId: input.userId,
      deviceName: input.deviceName,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      expiresAt: input.expiresAt,
      tokenHash: input.tokenHash,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string) {
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) {
        const user = this.users.get(session.userId);
        if (!user) return null;
        return { session, user };
      }
    }
    return null;
  }

  async touchSession(sessionId: number, lastUsedAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) session.lastUsedAt = lastUsedAt;
  }

  async deleteSession(sessionId: number): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async deleteSessionForUser(sessionId: number, userId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return false;
    this.sessions.delete(sessionId);
    return true;
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()].filter((s) => s.userId === userId);
  }

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const user = this.users.get(userId);
    return user ? { displayName: user.displayName, avatarPath: user.avatarPath } : null;
  }

  async updateUserProfile(userId: string, patch: Partial<UserProfile>): Promise<UserProfile | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    if (patch.displayName !== undefined) user.displayName = patch.displayName;
    if (patch.avatarPath !== undefined) user.avatarPath = patch.avatarPath;
    return { displayName: user.displayName, avatarPath: user.avatarPath };
  }
}
