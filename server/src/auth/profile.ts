import { randomBytes } from "node:crypto";
import { unlink, mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_INPUT_PIXELS = 4096 * 4096;
const AVATAR_EDGE_PIXELS = 512;

export type AvatarMimeType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface UserProfile {
  displayName: string | null;
  avatarPath: string | null;
}

export interface UserProfileRepo {
  getUserProfile(userId: string): Promise<UserProfile | null>;
  updateUserProfile(userId: string, patch: Partial<UserProfile>): Promise<UserProfile | null>;
}

export interface UserProfileApi {
  getProfile(userId: string): Promise<UserProfile>;
  updateDisplayName(userId: string, displayName: string | null): Promise<UserProfile>;
  saveAvatar(userId: string, bytes: Buffer, declaredMimeType: string): Promise<UserProfile>;
  removeAvatar(userId: string): Promise<UserProfile>;
  readAvatar(userId: string): Promise<{ bytes: Buffer; mimeType: AvatarMimeType } | null>;
}

export class DrizzleUserProfileRepo implements UserProfileRepo {
  constructor(private readonly db: Db) {}

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const [row] = await this.db
      .select({ displayName: users.displayName, avatarPath: users.avatarPath })
      .from(users)
      .where(eq(users.kitsuUserId, userId))
      .limit(1);
    return row ? { displayName: row.displayName, avatarPath: row.avatarPath } : null;
  }

  async updateUserProfile(userId: string, patch: Partial<UserProfile>): Promise<UserProfile | null> {
    const updated = await this.db
      .update(users)
      .set({
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.avatarPath !== undefined ? { avatarPath: patch.avatarPath } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.kitsuUserId, userId))
      .returning({ displayName: users.displayName, avatarPath: users.avatarPath });
    const row = updated[0];
    return row ? { displayName: row.displayName, avatarPath: row.avatarPath } : null;
  }
}

export class InvalidAvatarError extends Error {
  constructor(message = "The avatar must be a valid PNG, JPEG, GIF, or WebP image no larger than 2 MiB.") {
    super(message);
    this.name = "InvalidAvatarError";
  }
}

interface AvatarFile {
  bytes: Buffer;
  mimeType: AvatarMimeType;
}

/** Stores profile metadata in the database and user-uploaded avatars below MEDIA_ROOT. */
export class UserProfileService implements UserProfileApi {
  private readonly avatarRoot: string;
  private readonly avatarMutations = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: UserProfileRepo,
    private readonly mediaRoot: string,
  ) {
    this.avatarRoot = resolve(mediaRoot, "images", "avatars");
  }

  async getProfile(userId: string): Promise<UserProfile> {
    const profile = await this.repo.getUserProfile(userId);
    return profile ?? { displayName: null, avatarPath: null };
  }

  async updateDisplayName(userId: string, displayName: string | null): Promise<UserProfile> {
    const updated = await this.repo.updateUserProfile(userId, { displayName });
    if (!updated) throw new Error("User profile no longer exists.");
    return updated;
  }

  async saveAvatar(userId: string, bytes: Buffer, declaredMimeType: string): Promise<UserProfile> {
    return this.withAvatarMutation(userId, () => this.saveAvatarLocked(userId, bytes, declaredMimeType));
  }

  private async saveAvatarLocked(userId: string, bytes: Buffer, declaredMimeType: string): Promise<UserProfile> {
    const file = await validateAvatar(bytes, declaredMimeType);
    await mkdir(this.avatarRoot, { recursive: true });
    const fileName = `${safeFileStem(userId)}-${randomBytes(16).toString("hex")}.${extension(file.mimeType)}`;
    const absolutePath = join(this.avatarRoot, fileName);
    // Store portable POSIX separators in the database; resolve() accepts
    // these on Windows when reading the configured media root.
    const relativePath = `images/avatars/${fileName}`;
    const previous = await this.getProfile(userId);

    // Buffer writes are bounded by validateAvatar, so this does not permit an
    // upload to exhaust the server process. Persist metadata only after bytes
    // have reached disk; a failed DB write removes the orphaned new file.
    await writeFile(absolutePath, file.bytes, { flag: "wx" });
    try {
      const updated = await this.repo.updateUserProfile(userId, { avatarPath: relativePath });
      if (!updated) throw new Error("User profile no longer exists.");
      await removeStoredAvatar(this.mediaRoot, previous.avatarPath);
      return updated;
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async removeAvatar(userId: string): Promise<UserProfile> {
    return this.withAvatarMutation(userId, () => this.removeAvatarLocked(userId));
  }

  private async removeAvatarLocked(userId: string): Promise<UserProfile> {
    const previous = await this.getProfile(userId);
    const updated = await this.repo.updateUserProfile(userId, { avatarPath: null });
    if (!updated) throw new Error("User profile no longer exists.");
    await removeStoredAvatar(this.mediaRoot, previous.avatarPath);
    return updated;
  }

  /** Reads only a path previously written by saveAvatar, never an arbitrary user path. */
  async readAvatar(userId: string): Promise<{ bytes: Buffer; mimeType: AvatarMimeType } | null> {
    const profile = await this.getProfile(userId);
    if (!profile.avatarPath) return null;
    const absolutePath = resolveInsideMediaRoot(this.mediaRoot, profile.avatarPath);
    if (!absolutePath) return null;
    try {
      const bytes = await readFile(absolutePath);
      const mimeType = mimeFromExtension(extname(absolutePath));
      if (!mimeType || sniffMimeType(bytes) !== mimeType) return null;
      return { bytes, mimeType };
    } catch (error) {
      const code = error as NodeJS.ErrnoException;
      if (code.code === "ENOENT") return null;
      throw error;
    }
  }

  private async withAvatarMutation<T>(userId: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.avatarMutations.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(mutation);
    const settled = current.then(() => undefined, () => undefined);
    this.avatarMutations.set(userId, settled);
    try {
      return await current;
    } finally {
      if (this.avatarMutations.get(userId) === settled) this.avatarMutations.delete(userId);
    }
  }
}

export async function validateAvatar(bytes: Buffer, declaredMimeType: string): Promise<AvatarFile> {
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) throw new InvalidAvatarError();
  const mimeType = normalizeMimeType(declaredMimeType);
  if (!mimeType || sniffMimeType(bytes) !== mimeType) throw new InvalidAvatarError();

  try {
    // Decode the image rather than trusting its signature, cap decoder work,
    // and store a normalized single-frame image so malformed or oversized
    // inputs never become server-served files.
    const normalized = await sharp(bytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: MAX_AVATAR_INPUT_PIXELS,
    })
      .rotate()
      .resize({
        width: AVATAR_EDGE_PIXELS,
        height: AVATAR_EDGE_PIXELS,
        fit: "cover",
        position: "attention",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    if (normalized.length === 0 || normalized.length > MAX_AVATAR_BYTES) throw new InvalidAvatarError();
    return { bytes: normalized, mimeType: "image/webp" };
  } catch (error) {
    if (error instanceof InvalidAvatarError) throw error;
    throw new InvalidAvatarError();
  }
}

function normalizeMimeType(value: string): AvatarMimeType | null {
  const normalized = value.split(";", 1)[0]!.trim().toLowerCase();
  return isAvatarMimeType(normalized) ? normalized : null;
}

function sniffMimeType(bytes: Buffer): AvatarMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function isAvatarMimeType(value: string): value is AvatarMimeType {
  return value === "image/png" || value === "image/jpeg" || value === "image/gif" || value === "image/webp";
}

function extension(mimeType: AvatarMimeType): string {
  return mimeType.slice("image/".length).replace("jpeg", "jpg");
}

function mimeFromExtension(value: string): AvatarMimeType | null {
  const normalized = value.toLowerCase();
  if (normalized === ".png") return "image/png";
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg";
  if (normalized === ".gif") return "image/gif";
  if (normalized === ".webp") return "image/webp";
  return null;
}

function safeFileStem(userId: string): string {
  // User IDs are not trusted as path components. Keep the name useful for
  // operators while allowing only a conservative ASCII subset.
  const stem = userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return stem || "user";
}

function resolveInsideMediaRoot(mediaRoot: string, relativePath: string): string | null {
  if (isAbsolute(relativePath)) return null;
  const root = resolve(mediaRoot);
  const target = resolve(root, relativePath);
  const relativeTarget = relative(root, target);
  return relativeTarget && !relativeTarget.startsWith("..") && !isAbsolute(relativeTarget)
    ? target
    : null;
}

async function removeStoredAvatar(mediaRoot: string, relativePath: string | null): Promise<void> {
  if (!relativePath) return;
  const path = resolveInsideMediaRoot(mediaRoot, relativePath);
  if (!path) return;
  await unlink(path).catch(() => undefined);
}
