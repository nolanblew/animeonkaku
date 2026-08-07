import {
  AuthRepo,
  CreateSessionInput,
  SessionRecord,
  UpsertUserInput,
  UserRecord,
} from "../../src/auth/types.js";

interface StoredUser extends UserRecord {
  kitsuAccessToken: string;
  kitsuRefreshToken: string | null;
}

interface StoredSession extends SessionRecord {
  tokenHash: string;
}

export class FakeAuthRepo implements AuthRepo {
  users = new Map<string, StoredUser>();
  sessions = new Map<number, StoredSession>();
  private nextSessionId = 1;

  async upsertUser(input: UpsertUserInput): Promise<{ user: UserRecord; created: boolean }> {
    const existing = this.users.get(input.kitsuUserId);
    const user: StoredUser = {
      kitsuUserId: input.kitsuUserId,
      username: input.username,
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
}
