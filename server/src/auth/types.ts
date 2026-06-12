export interface KitsuAuthResult {
  kitsuUserId: string;
  username: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

/** Performs the Kitsu OAuth password grant. Real implementation lands in S2. */
export interface KitsuAuthClient {
  login(username: string, password: string): Promise<KitsuAuthResult>;
}

/** Upstream rejected the credentials (or equivalent) — maps to HTTP 401. */
export class KitsuAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KitsuAuthError";
  }
}

export interface UserRecord {
  kitsuUserId: string;
  username: string;
  kitsuAuthState: string;
  lastSyncAt: Date | null;
}

export interface SessionRecord {
  id: number;
  userId: string;
  deviceName: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

export interface UpsertUserInput {
  kitsuUserId: string;
  username: string;
  kitsuAccessToken: string;
  kitsuRefreshToken: string | null;
  kitsuTokenExpiresAt: Date | null;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  deviceName: string;
  expiresAt: Date;
}

export interface AuthRepo {
  /** Insert or update the user row; `created` is true when the user did not exist before. */
  upsertUser(input: UpsertUserInput): Promise<{ user: UserRecord; created: boolean }>;
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  findSessionByTokenHash(
    tokenHash: string,
  ): Promise<{ session: SessionRecord; user: UserRecord } | null>;
  touchSession(sessionId: number, lastUsedAt: Date): Promise<void>;
  deleteSession(sessionId: number): Promise<void>;
  /** Returns false when the session does not exist or belongs to another user. */
  deleteSessionForUser(sessionId: number, userId: string): Promise<boolean>;
  listSessions(userId: string): Promise<SessionRecord[]>;
}
