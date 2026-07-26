import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSafeAmfRelativePath } from "../animeMusicFetcher/schemas.js";

// AMF also supports "ape" and "wv" (see AMF README), but Anime Ongaku
// deliberately does not import those (MC-S05R). Anything outside this set is
// rejected here as defence in depth; the request builder additionally asks
// AMF to prefer only these formats up front (see requests/builder.ts) so the
// rejection path below is a fallback, not the primary defense.
export const SUPPORTED_AUDIO_EXTENSIONS = new Set([".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav"]);
export const SUPPORTED_AUDIO_FORMATS = [...SUPPORTED_AUDIO_EXTENSIONS].map((extension) => extension.slice(1));

export class AmfDeliveryValidationError extends Error {
  constructor(message: string, readonly operatorAction = true) {
    super(message);
    this.name = "AmfDeliveryValidationError";
  }
}

/**
 * A delivery was rejected solely because its file extension is outside
 * {@link SUPPORTED_AUDIO_EXTENSIONS}. This is distinguished from other
 * validation failures (unsafe paths, missing files, hash/size mismatches) so
 * that a caller can classify it as a closable outcome rather than a generic
 * "needs operator review" attention state — the request builder already
 * asked AMF not to select these formats, so a delivery landing here anyway
 * cannot be resolved by operator action on the Anime Ongaku side. See F6/F3
 * in `.planning/18-amf-fetch-robustness-review.md`. Wiring the closable
 * outcome into `deliveryService.ts` is MC-S18's responsibility; this
 * subclass only makes the case identifiable.
 */
export class AmfUnsupportedFormatDeliveryError extends AmfDeliveryValidationError {
  constructor(readonly extension: string) {
    super(`Unsupported AMF delivery audio extension: ${extension || "missing"}.`);
    this.name = "AmfUnsupportedFormatDeliveryError";
  }
}

export interface AmfDeliveryFileEvidence {
  relativePath: string;
  size: number | null;
  sha256: string | null;
}

export interface VerifiedAmfDeliveryFile { path: string; byteSize: number; sha256: string }

export async function validateAmfDeliveryFile(root: string, input: AmfDeliveryFileEvidence, expectedPrefix?: string): Promise<VerifiedAmfDeliveryFile> {
  if (!isSafeAmfRelativePath(input.relativePath)) {
    throw new AmfDeliveryValidationError("AMF delivery path is not a safe relative path.");
  }
  if (expectedPrefix !== undefined && input.relativePath !== expectedPrefix
    && !input.relativePath.startsWith(`${expectedPrefix}/`)) {
    throw new AmfDeliveryValidationError("AMF delivery path is outside the persisted batch destination.");
  }
  const extension = extname(input.relativePath).toLowerCase();
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new AmfUnsupportedFormatDeliveryError(extension);
  }
  const canonicalRoot = await realpath(resolve(root)).catch(() => null);
  if (!canonicalRoot) throw new AmfDeliveryValidationError("The configured AMF library root is unavailable.");
  const canonicalFile = await realpath(join(canonicalRoot, ...input.relativePath.split("/"))).catch(() => null);
  if (!canonicalFile) throw new AmfDeliveryValidationError("The AMF delivery file is missing.");
  const relativeToRoot = relative(canonicalRoot, canonicalFile);
  if (relativeToRoot === ".." || relativeToRoot.startsWith(`..${sep}`) || isAbsolute(relativeToRoot)) {
    throw new AmfDeliveryValidationError("The AMF delivery file resolves outside the configured library root.");
  }
  const fileStat = await stat(canonicalFile);
  if (!fileStat.isFile()) throw new AmfDeliveryValidationError("The AMF delivery path is not a file.");
  if (input.size !== null && fileStat.size !== input.size) {
    throw new AmfDeliveryValidationError("The AMF delivery file size conflicts with its manifest.");
  }
  const actual = await hashFile(canonicalFile);
  if (input.sha256 !== null) {
    if (actual !== input.sha256.toLowerCase()) {
      throw new AmfDeliveryValidationError("The AMF delivery file hash conflicts with its manifest.");
    }
  }
  return { path: canonicalFile, byteSize: fileStat.size, sha256: actual };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
