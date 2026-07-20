import { LidarrProviderError } from "./errors.js";

export interface LidarrPathMapping {
  rootFolderPath: string;
  sharedRoot: string;
  pathPrefixFrom?: string;
  pathPrefixTo?: string;
}

/** Maps container paths with a boundary check so similarly-prefixed folders cannot escape. */
export function mapLidarrPath(sourcePath: string, mapping: LidarrPathMapping): string {
  const configured = mapping.pathPrefixFrom && mapping.pathPrefixTo
    ? { from: mapping.pathPrefixFrom, to: mapping.pathPrefixTo }
    : { from: mapping.rootFolderPath, to: mapping.sharedRoot };
  const windows = windowsLike(sourcePath, configured.from, configured.to);
  const source = canonicalSafe(sourcePath);
  const from = canonicalSafe(configured.from).replace(/\/$/, "");
  const sourceComparable = windows ? source.toLowerCase() : source;
  const fromComparable = windows ? from.toLowerCase() : from;

  if (sourceComparable !== fromComparable && !sourceComparable.startsWith(`${fromComparable}/`)) {
    throw new LidarrProviderError(
      "PATH_NOT_MAPPED",
      "Lidarr track file is outside the configured shared path",
      false,
    );
  }

  const suffix = source.slice(from.length).replace(/^\/+/, "");
  const separator = configured.to.includes("\\") && !configured.to.includes("/") ? "\\" : "/";
  const target = configured.to.replace(/[\\/]+$/, "");
  const mapped = suffix.length === 0 ? target : `${target}${separator}${suffix.replace(/\//g, separator)}`;
  const canonicalTarget = canonicalSafe(target).replace(/\/$/, "");
  const canonicalMapped = canonicalSafe(mapped);
  const targetComparable = windows ? canonicalTarget.toLowerCase() : canonicalTarget;
  const mappedComparable = windows ? canonicalMapped.toLowerCase() : canonicalMapped;
  if (
    mappedComparable !== targetComparable &&
    !mappedComparable.startsWith(`${targetComparable}/`)
  ) {
    throw unmappedPath();
  }
  return mapped;
}

function canonicalSafe(value: string): string {
  const canonical = value.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (canonical.split("/").some((segment) => segment === "." || segment === "..")) {
    throw unmappedPath();
  }
  return canonical;
}

function windowsLike(...values: string[]): boolean {
  return values.some((value) => /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\"));
}

function unmappedPath(): LidarrProviderError {
  return new LidarrProviderError(
    "PATH_NOT_MAPPED",
    "Lidarr track file is outside the configured shared path",
    false,
  );
}
