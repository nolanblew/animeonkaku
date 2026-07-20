import type { NormalizedProviderRelease, NormalizedProviderTrack } from "../types.js";

/** Merge repeated query results without making query order affect scoring. */
export function mergeMusicCandidates(candidates: readonly NormalizedProviderRelease[]): NormalizedProviderRelease[] {
  const releases: NormalizedProviderRelease[] = [];
  for (const candidate of candidates) {
    const normalized = { ...candidate, tracks: mergeTracks(candidate.tracks) };
    const matchingIndexes = releases.flatMap((existing, index) => sameReleaseIdentity(existing, normalized) ? [index] : []);
    if (matchingIndexes.length === 0) {
      releases.push(normalized);
      continue;
    }
    let combined = normalized;
    for (const index of [...matchingIndexes].reverse()) {
      combined = mergeRelease(releases[index]!, combined);
      releases.splice(index, 1);
    }
    releases.push(combined);
  }
  return releases.sort((a, b) => releaseIdentity(a).localeCompare(releaseIdentity(b)) || releaseTieKey(a).localeCompare(releaseTieKey(b)));
}

function sameReleaseIdentity(left: NormalizedProviderRelease, right: NormalizedProviderRelease): boolean {
  if (left.provider.toLowerCase() !== right.provider.toLowerCase()) return false;
  if (left.providerReleaseId === right.providerReleaseId) return true;
  const leftRelease = left.musicbrainzReleaseId?.trim().toLowerCase();
  const rightRelease = right.musicbrainzReleaseId?.trim().toLowerCase();
  return Boolean(leftRelease && rightRelease && leftRelease === rightRelease);
}

function releaseIdentity(release: NormalizedProviderRelease): string {
  const provider = release.provider.toLowerCase();
  return release.musicbrainzReleaseId
    ? `${provider}:mb-release:${release.musicbrainzReleaseId.toLowerCase()}`
    : `${provider}:${release.providerReleaseId}`;
}

function trackIdentity(track: NormalizedProviderTrack): string {
  const provider = track.provider.toLowerCase();
  return track.musicbrainzRecordingId
    ? `${provider}:mb-recording:${track.musicbrainzRecordingId.toLowerCase()}`
    : `${provider}:${track.providerTrackId}`;
}

function mergeTracks(tracks: readonly NormalizedProviderTrack[]): NormalizedProviderTrack[] {
  const merged: NormalizedProviderTrack[] = [];
  for (const track of tracks) {
    const matchingIndexes = merged.flatMap((candidate, index) => sameTrackIdentity(candidate, track) ? [index] : []);
    if (matchingIndexes.length === 0) {
      merged.push(track);
      continue;
    }
    let combined = track;
    for (const index of [...matchingIndexes].reverse()) {
      combined = mergeTrack(merged[index]!, combined);
      merged.splice(index, 1);
    }
    merged.push(combined);
  }
  return merged.sort((a, b) => trackIdentity(a).localeCompare(trackIdentity(b)) || trackTieKey(a).localeCompare(trackTieKey(b)));
}

function sameTrackIdentity(left: NormalizedProviderTrack, right: NormalizedProviderTrack): boolean {
  if (left.provider.toLowerCase() !== right.provider.toLowerCase()) return false;
  if (left.providerTrackId === right.providerTrackId) return true;
  const leftRecording = left.musicbrainzRecordingId?.trim().toLowerCase();
  const rightRecording = right.musicbrainzRecordingId?.trim().toLowerCase();
  return Boolean(leftRecording && rightRecording && leftRecording === rightRecording);
}

function mergeRelease(left: NormalizedProviderRelease, right: NormalizedProviderRelease): NormalizedProviderRelease {
  const rightScore = releaseCompleteness(right);
  const leftScore = releaseCompleteness(left);
  const preferred = rightScore > leftScore || (rightScore === leftScore && releaseTieKey(right) < releaseTieKey(left)) ? right : left;
  const fallback = preferred === left ? right : left;
  const musicbrainzReleaseId = preferred.musicbrainzReleaseId ?? fallback.musicbrainzReleaseId;
  const musicbrainzReleaseGroupId = preferred.musicbrainzReleaseGroupId ?? fallback.musicbrainzReleaseGroupId;
  const releaseDate = preferred.releaseDate ?? fallback.releaseDate;
  const artworkUrl = preferred.artworkUrl ?? fallback.artworkUrl;
  return {
    ...preferred,
    ...(musicbrainzReleaseId ? { musicbrainzReleaseId } : {}),
    ...(musicbrainzReleaseGroupId ? { musicbrainzReleaseGroupId } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    ...(artworkUrl ? { artworkUrl } : {}),
    tracks: mergeTracks([...left.tracks, ...right.tracks]),
  };
}

function preferTrack(left: NormalizedProviderTrack, right: NormalizedProviderTrack): NormalizedProviderTrack {
  const rightScore = trackCompleteness(right);
  const leftScore = trackCompleteness(left);
  return rightScore > leftScore || (rightScore === leftScore && trackTieKey(right) < trackTieKey(left)) ? right : left;
}

function mergeTrack(left: NormalizedProviderTrack, right: NormalizedProviderTrack): NormalizedProviderTrack {
  const preferred = preferTrack(left, right);
  const fallback = preferred === left ? right : left;
  const conflicts = new Set<"RECORDING_ID" | "TITLE" | "ARTIST" | "DURATION">([
    ...(left.metadataConflicts ?? []),
    ...(right.metadataConflicts ?? []),
  ]);
  if (
    left.musicbrainzRecordingId && right.musicbrainzRecordingId &&
    left.musicbrainzRecordingId.trim().toLowerCase() !== right.musicbrainzRecordingId.trim().toLowerCase()
  ) conflicts.add("RECORDING_ID");
  if (left.normalizedTitle !== right.normalizedTitle) conflicts.add("TITLE");
  if (left.normalizedArtist !== right.normalizedArtist) conflicts.add("ARTIST");
  if (
    left.durationSeconds !== undefined && right.durationSeconds !== undefined &&
    Math.abs(left.durationSeconds - right.durationSeconds) > 2
  ) conflicts.add("DURATION");
  const musicbrainzRecordingId = preferred.musicbrainzRecordingId ?? fallback.musicbrainzRecordingId;
  const durationSeconds = preferred.durationSeconds ?? fallback.durationSeconds;
  const trackNumber = preferred.trackNumber ?? fallback.trackNumber;
  return {
    ...preferred,
    ...(musicbrainzRecordingId ? { musicbrainzRecordingId } : {}),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(trackNumber === undefined ? {} : { trackNumber }),
    ...(conflicts.size === 0 ? {} : { metadataConflicts: [...conflicts].sort() }),
  };
}

function releaseCompleteness(value: NormalizedProviderRelease): number {
  return Number(Boolean(value.musicbrainzReleaseId)) + Number(Boolean(value.musicbrainzReleaseGroupId)) +
    Number(Boolean(value.releaseDate)) + Number(Boolean(value.artworkUrl)) + value.tracks.length;
}

function trackCompleteness(value: NormalizedProviderTrack): number {
  return Number(Boolean(value.musicbrainzRecordingId)) + Number(value.durationSeconds !== undefined) +
    Number(value.trackNumber !== undefined);
}

function releaseTieKey(value: NormalizedProviderRelease): string {
  return `${value.provider}\u0000${value.providerReleaseId}\u0000${value.normalizedTitle}\u0000${value.title}`;
}

function trackTieKey(value: NormalizedProviderTrack): string {
  return [
    value.provider,
    value.providerTrackId,
    value.musicbrainzRecordingId ?? "",
    value.normalizedTitle,
    value.title,
    value.normalizedArtist,
    value.artistCredit,
    String(value.durationSeconds ?? ""),
    String(value.discNumber),
    String(value.trackNumber ?? ""),
  ].join("\u0000");
}
