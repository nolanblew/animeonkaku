import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export class MediaPathEscapeError extends Error {
  constructor() {
    super("Media path escapes the configured media root.");
    this.name = "MediaPathEscapeError";
  }
}

/**
 * Resolve a path below MEDIA_ROOT and verify both its lexical location and the
 * canonical location of its nearest existing ancestor. The ancestor check is
 * what prevents a junction/symlink below MEDIA_ROOT from redirecting a new
 * destination file outside the managed store.
 */
export async function resolveManagedMediaPath(mediaRoot: string, relativePath: string): Promise<string> {
  const configuredRoot = resolve(mediaRoot);
  const canonicalRoot = await realpath(configuredRoot);
  const absolutePath = resolve(configuredRoot, relativePath);
  assertContained(configuredRoot, absolutePath);

  let probe = absolutePath;
  while (true) {
    try {
      const canonicalProbe = await realpath(probe);
      assertContained(canonicalRoot, canonicalProbe);
      return absolutePath;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      if (probe === configuredRoot) throw error;
      const parent = dirname(probe);
      if (parent === probe) throw new MediaPathEscapeError();
      probe = parent;
    }
  }
}

function assertContained(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new MediaPathEscapeError();
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
