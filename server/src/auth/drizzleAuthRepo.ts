import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { deviceSessions, users } from "../db/schema.js";
import {
  AuthRepo,
  CreateSessionInput,
  SessionRecord,
  UpsertUserInput,
  UserRecord,
} from "./types.js";

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof deviceSessions.$inferSelect;

function toUserRecord(row: UserRow): UserRecord {
  return {
    kitsuUserId: row.kitsuUserId,
    username: row.username,
    kitsuAuthState: row.kitsuAuthState,
    lastSyncAt: row.lastSyncAt,
  };
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    deviceName: row.deviceName,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
  };
}

export class DrizzleAuthRepo implements AuthRepo {
  constructor(private readonly db: Db) {}

  async upsertUser(input: UpsertUserInput): Promise<{ user: UserRecord; created: boolean }> {
    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.kitsuUserId, input.kitsuUserId))
      .limit(1);

    if (existing.length === 0) {
      const inserted = await this.db
        .insert(users)
        .values({
          kitsuUserId: input.kitsuUserId,
          username: input.username,
          kitsuAccessToken: input.kitsuAccessToken,
          kitsuRefreshToken: input.kitsuRefreshToken,
          kitsuTokenExpiresAt: input.kitsuTokenExpiresAt,
        })
        .returning();
      return { user: toUserRecord(inserted[0]!), created: true };
    }

    const updated = await this.db
      .update(users)
      .set({
        username: input.username,
        kitsuAccessToken: input.kitsuAccessToken,
        kitsuRefreshToken: input.kitsuRefreshToken,
        kitsuTokenExpiresAt: input.kitsuTokenExpiresAt,
        kitsuAuthState: "OK", // a fresh Kitsu grant clears any REAUTH_REQUIRED state
        updatedAt: new Date(),
      })
      .where(eq(users.kitsuUserId, input.kitsuUserId))
      .returning();
    return { user: toUserRecord(updated[0]!), created: false };
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const inserted = await this.db
      .insert(deviceSessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        deviceName: input.deviceName,
        expiresAt: input.expiresAt,
      })
      .returning();
    return toSessionRecord(inserted[0]!);
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<{ session: SessionRecord; user: UserRecord } | null> {
    const rows = await this.db
      .select({ session: deviceSessions, user: users })
      .from(deviceSessions)
      .innerJoin(users, eq(deviceSessions.userId, users.kitsuUserId))
      .where(eq(deviceSessions.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { session: toSessionRecord(row.session), user: toUserRecord(row.user) };
  }

  async touchSession(sessionId: number, lastUsedAt: Date): Promise<void> {
    await this.db
      .update(deviceSessions)
      .set({ lastUsedAt })
      .where(eq(deviceSessions.id, sessionId));
  }

  async deleteSession(sessionId: number): Promise<void> {
    await this.db.delete(deviceSessions).where(eq(deviceSessions.id, sessionId));
  }

  async deleteSessionForUser(sessionId: number, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(deviceSessions)
      .where(and(eq(deviceSessions.id, sessionId), eq(deviceSessions.userId, userId)))
      .returning({ id: deviceSessions.id });
    return deleted.length > 0;
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(deviceSessions)
      .where(eq(deviceSessions.userId, userId))
      .orderBy(deviceSessions.createdAt);
    return rows.map(toSessionRecord);
  }
}
