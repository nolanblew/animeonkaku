import { createHash, randomBytes } from "node:crypto";

/** Opaque session token: 32 bytes of CSPRNG entropy, base64url (43 chars). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored only as sha256 hex digests (doc 04: hashed at rest). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
