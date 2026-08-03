import type {
  MusicCatalogAcceptanceIntent,
  MusicCatalogResolution,
  MusicCatalogResolutionReason,
  MusicCatalogResolver,
  MusicCatalogResolverInput,
  MusicCatalogTarget,
  MusicMatchEvidence,
  MusicMatchEvidenceSignal,
  MusicReleaseClassification,
  MusicReleaseType,
  NormalizedProviderRelease,
  NormalizedProviderTrack,
} from "../types.js";
import { mergeMusicCandidates } from "./candidates.js";
import { containsNormalized, exactOrNear, normalizeMusicText } from "./normalize.js";
import { buildMusicCatalogQueries } from "./queries.js";

export const FULL_SIZE_CONFIDENCE_THRESHOLD = 85;
export const RELATED_RELEASE_CONFIDENCE_THRESHOLD = 80;
export const MUSIC_MATCH_MINIMUM_MARGIN = 10;

type ScoredFullTrack = {
  release: NormalizedProviderRelease;
  track: NormalizedProviderTrack;
  score: number;
  signals: MusicMatchEvidenceSignal[];
  reasons: MusicCatalogResolutionReason[];
  eligible: boolean;
};

type ScoredRelatedRelease = {
  release: NormalizedProviderRelease;
  score: number;
  classification: MusicReleaseClassification;
  eligible: boolean;
  generalAliasOnly: boolean;
};

const EXCLUSION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "instrumental", pattern: /(?:^| )(?:instrumental|instrumentals|インスト(?:ゥルメンタル)?)(?: |$)/u },
  { label: "karaoke", pattern: /(?:^| )(?:karaoke|カラオケ)(?: |$)/u },
  { label: "off-vocal", pattern: /(?:^| )(?:off vocal|offvocal|オフボーカル)(?: (?:ver|version))?(?: |$)/u },
  { label: "live", pattern: /(?:^| )(?:live|ライブ)(?: (?:ver|version|版))?(?: |$)/u },
  { label: "remix", pattern: /(?:^| )(?:remix|remixed|リミックス)(?: |$)/u },
  { label: "cover", pattern: /(?:^| )(?:cover|covered|カバー)(?: |$)/u },
  { label: "tv-size", pattern: /(?:^| )(?:tv size|tv edit|tv ver|tv version|anime size|テレビサイズ|tvサイズ)(?: |$)/u },
  { label: "short", pattern: /(?:^| )(?:short|short ver|short version|ショート)(?: |$)/u },
  { label: "edit", pattern: /(?:^| )(?:radio edit|opening edit|ending edit|edit version|edited)(?: |$)/u },
  { label: "alternate-performer", pattern: /(?:^| )(?:self cover|performed by|another vocal|alternate vocal|character ver)(?: |$)/u },
];

const RELEASE_TYPES: Array<{ releaseType: MusicReleaseType; patterns: RegExp[] }> = [
  { releaseType: "SOUNDTRACK", patterns: [/\b(?:original soundtrack|soundtrack|ost)\b/u, /(?:オリジナル)?サウンドトラック/u, /劇伴/u] },
  { releaseType: "CHARACTER", patterns: [/\bcharacter songs?\b/u, /キャラクターソング/u, /キャラソン/u] },
  { releaseType: "IMAGE", patterns: [/\bimage (?:song|album)s?\b/u, /イメージ(?:ソング|アルバム)/u] },
  { releaseType: "INSERT", patterns: [/\binsert songs?\b/u, /挿入歌/u] },
];

export class ConservativeMusicCatalogResolver implements MusicCatalogResolver {
  buildQueries(target: MusicCatalogTarget) {
    return buildMusicCatalogQueries(target);
  }

  resolve(input: MusicCatalogResolverInput): MusicCatalogResolution {
    const candidates = mergeMusicCandidates(input.candidates);
    return input.target.kind === "FULL_SIZE"
      ? resolveFullSize(input.target, candidates)
      : resolveRelatedRelease(input.target, candidates);
  }
}

function resolveFullSize(
  target: MusicCatalogTarget,
  releases: NormalizedProviderRelease[],
): MusicCatalogResolution {
  const scored = releases.flatMap((release) => release.tracks.map((track) => scoreFullTrack(target, release, track)));
  if (scored.length === 0) {
    return terminal("REJECTED", 0, releases.length === 0 ? ["NO_CANDIDATE"] : ["TRACK_NOT_IDENTIFIABLE"]);
  }

  const eligible = uniqueFullCandidates(scored.filter((candidate) => candidate.eligible)).sort(compareFullCandidates);
  if (eligible.length === 0) {
    const rejected = [...scored].sort(compareFullCandidates)[0]!;
    return {
      outcome: "REJECTED",
      confidence: rejected.score,
      evidence: evidence(rejected.signals, rejected.reasons),
      reasons: rejected.reasons,
      release: rejected.release,
      track: rejected.track,
    };
  }

  const best = eligible[0]!;
  const runnerUp = eligible[1];
  const reasons: MusicCatalogResolutionReason[] = [];
  if (best.score < FULL_SIZE_CONFIDENCE_THRESHOLD) reasons.push("BELOW_CONFIDENCE_THRESHOLD");
  if (runnerUp && best.score - runnerUp.score < MUSIC_MATCH_MINIMUM_MARGIN) reasons.push("INSUFFICIENT_MARGIN");
  if (reasons.length > 0) {
    return {
      outcome: "AMBIGUOUS",
      confidence: best.score,
      evidence: evidence(best.signals, reasons),
      reasons,
      release: best.release,
      track: best.track,
    };
  }

  const intent: MusicCatalogAcceptanceIntent = {
    kind: "FULL_SIZE",
    animeThemesAnimeId: target.animeThemesAnimeId,
    ...(target.animeThemesSongId !== undefined ? { animeThemesSongId: target.animeThemesSongId } : {}),
    release: best.release,
    song: best.track,
  };
  return {
    outcome: "ACCEPTED",
    confidence: best.score,
    evidence: evidence(best.signals, []),
    reasons: [],
    release: best.release,
    track: best.track,
    intent,
  };
}

function scoreFullTrack(
  target: MusicCatalogTarget,
  release: NormalizedProviderRelease,
  track: NormalizedProviderTrack,
): ScoredFullTrack {
  const signals: MusicMatchEvidenceSignal[] = [];
  const reasons: MusicCatalogResolutionReason[] = [];
  const targetRecording = cleanIdentity(target.musicbrainzRecordingId);
  const candidateRecording = cleanIdentity(track.musicbrainzRecordingId);
  const exclusion = fullSizeExclusionLabel(`${track.title} ${release.title}`);
  const metadataConflicts = new Set(track.metadataConflicts ?? []);

  if (targetRecording && candidateRecording && targetRecording !== candidateRecording) {
    signals.push({ kind: "MUSICBRAINZ_RECORDING_CONFLICT", points: 0, detail: `${targetRecording} != ${candidateRecording}` });
    reasons.push("CONFLICTING_RECORDING_ID");
  } else if (targetRecording && candidateRecording === targetRecording) {
    signals.push({ kind: "MUSICBRAINZ_RECORDING_EXACT", points: 60, detail: targetRecording });
  }
  if (exclusion) {
    signals.push({ kind: "EXCLUSION", points: 0, detail: exclusion });
    reasons.push("FULL_SIZE_EXCLUSION");
  }
  if (metadataConflicts.has("TITLE")) signals.push({ kind: "TITLE_CONFLICT", points: 0, detail: "conflicting duplicate metadata" });
  if (metadataConflicts.has("ARTIST")) signals.push({ kind: "ARTIST_CONFLICT", points: 0, detail: "conflicting duplicate metadata" });
  if (metadataConflicts.has("DURATION")) signals.push({ kind: "DURATION_CONFLICT", points: 0, detail: "conflicting duplicate metadata" });
  if (metadataConflicts.has("RECORDING_ID")) {
    signals.push({ kind: "MUSICBRAINZ_RECORDING_CONFLICT", points: 0, detail: "conflicting duplicate metadata" });
    reasons.push("CONFLICTING_RECORDING_ID");
  }
  if (metadataConflicts.size > 0) reasons.push("TRACK_NOT_IDENTIFIABLE");

  const titleMatch = target.title ? exactOrNear(target.title, track.title, 0.9) : false;
  const artistMatch = target.artist ? exactOrNear(target.artist, track.artistCredit, 0.8) : false;
  if (titleMatch) signals.push({ kind: "TITLE_MATCH", points: 30, detail: normalizeMusicText(track.title) });
  else if (target.title) signals.push({ kind: "TITLE_CONFLICT", points: 0, detail: normalizeMusicText(track.title) });
  if (artistMatch) signals.push({ kind: "ARTIST_MATCH", points: 25, detail: normalizeMusicText(track.artistCredit) });
  else if (target.artist) signals.push({ kind: "ARTIST_CONFLICT", points: 0, detail: normalizeMusicText(track.artistCredit) });

  const durationMatch = plausibleFullDuration(target.durationSeconds, track.durationSeconds);
  if (durationMatch) signals.push({ kind: "DURATION_MATCH", points: 15, detail: `${track.durationSeconds}s` });
  else if (target.durationSeconds !== undefined && track.durationSeconds !== undefined) {
    signals.push({ kind: "DURATION_CONFLICT", points: 0, detail: `tv ${target.durationSeconds}s, candidate ${track.durationSeconds}s` });
  }
  const animeAlias = matchingAlias(release.title, target.animeTitles);
  if (animeAlias) signals.push({ kind: "RELEASE_ANIME_ALIAS", points: 10, detail: normalizeMusicText(animeAlias) });
  const expectedReleaseIds = new Set((target.expectedMusicbrainzReleaseIds ?? []).map(cleanIdentity).filter((id): id is string => id !== undefined));
  const releaseIdentityMatched = [release.musicbrainzReleaseId, release.musicbrainzReleaseGroupId]
    .map(cleanIdentity)
    .some((id) => id !== undefined && expectedReleaseIds.has(id));
  if (releaseIdentityMatched) {
    signals.push({ kind: "RELEASE_TYPE", points: 5, detail: "expected MusicBrainz release identity" });
  }

  const exactRecording = targetRecording !== undefined && candidateRecording === targetRecording;
  if (exactRecording && target.title && !titleMatch) reasons.push("TRACK_NOT_IDENTIFIABLE");
  if (exactRecording && target.artist && !artistMatch) reasons.push("TRACK_NOT_IDENTIFIABLE");
  if (target.durationSeconds !== undefined && track.durationSeconds !== undefined && !durationMatch) {
    reasons.push("TRACK_NOT_IDENTIFIABLE");
  }
  if (!exactRecording && !(titleMatch && artistMatch)) reasons.push("TRACK_NOT_IDENTIFIABLE");
  // Duration is evidence only when both sides expose it. Older AnimeThemes
  // records legitimately lack TV duration; that must remain below confidence,
  // not become a false hard rejection.
  if (!exactRecording && target.durationSeconds !== undefined && track.durationSeconds !== undefined && !durationMatch) {
    reasons.push("TRACK_NOT_IDENTIFIABLE");
  }
  const uniqueReasons = [...new Set(reasons)];
  return {
    release,
    track,
    score: signals.reduce((sum, signal) => sum + signal.points, 0),
    signals,
    reasons: uniqueReasons,
    eligible: uniqueReasons.length === 0,
  };
}

function resolveRelatedRelease(
  target: MusicCatalogTarget,
  releases: NormalizedProviderRelease[],
): MusicCatalogResolution {
  if (releases.length === 0) return terminal("REJECTED", 0, ["NO_CANDIDATE"]);
  const scored = releases.map((release) => scoreRelatedRelease(target, release)).sort(compareRelatedCandidates);
  const eligible = scored.filter((candidate) => candidate.eligible);
  if (eligible.length === 0) {
    const rejected = scored[0]!;
    const reasons = rejected.classification.evidence.reasons;
    return {
      outcome: rejected.classification.relationship === "AMBIGUOUS" ? "AMBIGUOUS" : "REJECTED",
      confidence: rejected.score,
      evidence: rejected.classification.evidence,
      reasons,
      release: rejected.release,
      releaseClassification: rejected.classification,
    };
  }

  const best = eligible[0]!;
  const runnerUp = eligible[1];
  const reasons: MusicCatalogResolutionReason[] = [];
  if (best.score < RELATED_RELEASE_CONFIDENCE_THRESHOLD) reasons.push("BELOW_CONFIDENCE_THRESHOLD");
  if (runnerUp && best.score - runnerUp.score < MUSIC_MATCH_MINIMUM_MARGIN) reasons.push("INSUFFICIENT_MARGIN");
  if (reasons.length > 0) {
    const classification = { ...best.classification, relationship: "AMBIGUOUS" as const, evidence: evidence(best.classification.evidence.signals, reasons) };
    return { outcome: "AMBIGUOUS", confidence: best.score, evidence: classification.evidence, reasons, release: best.release, releaseClassification: classification };
  }

  const intent: MusicCatalogAcceptanceIntent = {
    kind: "RELATED_RELEASE",
    animeThemesAnimeId: target.animeThemesAnimeId,
    release: best.release,
    releaseType: best.classification.releaseType,
    songs: best.release.tracks,
  };
  return { outcome: "ACCEPTED", confidence: best.score, evidence: best.classification.evidence, reasons: [], release: best.release, releaseClassification: best.classification, intent };
}

function scoreRelatedRelease(target: MusicCatalogTarget, release: NormalizedProviderRelease): ScoredRelatedRelease {
  const signals: MusicMatchEvidenceSignal[] = [];
  const reasons: MusicCatalogResolutionReason[] = [];
  const generalAlias = matchingAlias(release.title, target.animeTitles);
  const hasSeasonAliases = (target.seasonSpecificTitles?.length ?? 0) > 0;
  const seasonAlias = hasSeasonAliases ? matchingAlias(release.title, target.seasonSpecificTitles ?? []) : generalAlias;
  const alias = seasonAlias;
  const releaseType = classifyReleaseType(release.title);
  if (alias) signals.push({ kind: "RELEASE_ANIME_ALIAS", points: 60, detail: normalizeMusicText(alias) });
  else {
    signals.push({
      kind: "RELEASE_ANIME_ALIAS_MISSING",
      points: 0,
      detail: generalAlias && hasSeasonAliases
        ? `franchise alias only: ${normalizeMusicText(generalAlias)}`
        : normalizeMusicText(release.title),
    });
    reasons.push("RELEASE_NOT_SEASON_SPECIFIC");
  }
  if (releaseType !== "OTHER") signals.push({ kind: "RELEASE_TYPE", points: 25, detail: releaseType });
  else {
    signals.push({ kind: "RELEASE_TYPE_UNCLASSIFIED", points: 0, detail: normalizeMusicText(release.title) });
    reasons.push("RELEASE_RELATIONSHIP_AMBIGUOUS");
  }
  const uniqueReasons = [...new Set(reasons)];
  const generalAliasOnly = Boolean(generalAlias && hasSeasonAliases && !seasonAlias);
  const relationship = uniqueReasons.length === 0
    ? "SEASON_SPECIFIC"
    : generalAliasOnly || (releaseType === "OTHER" && Boolean(generalAlias))
      ? "AMBIGUOUS"
      : "UNRELATED";
  const classification: MusicReleaseClassification = { releaseType, relationship, evidence: evidence(signals, uniqueReasons) };
  return { release, score: signals.reduce((sum, signal) => sum + signal.points, 0), classification, eligible: uniqueReasons.length === 0, generalAliasOnly };
}

function matchingAlias(value: string, aliases: readonly string[]): string | undefined {
  return aliases.filter((alias) => normalizeMusicText(alias).length >= 4).find((alias) => containsNormalized(value, alias));
}

function classifyReleaseType(value: string): MusicReleaseType {
  const normalized = normalizeMusicText(value);
  return RELEASE_TYPES.find(({ patterns }) => patterns.some((pattern) => pattern.test(normalized)))?.releaseType ?? "OTHER";
}

export function fullSizeExclusionLabel(value: string): string | undefined {
  const normalized = normalizeMusicText(value);
  return EXCLUSION_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.label;
}

function plausibleFullDuration(tvSeconds: number | undefined, candidateSeconds: number | undefined): boolean {
  if (candidateSeconds === undefined || candidateSeconds <= 0 || tvSeconds === undefined || tvSeconds <= 0) return false;
  return candidateSeconds >= tvSeconds + 30 && candidateSeconds >= tvSeconds * 1.25;
}

function evidence(signals: MusicMatchEvidenceSignal[], reasons: MusicCatalogResolutionReason[]): MusicMatchEvidence {
  return { signals, reasons };
}

function terminal(outcome: "REJECTED", confidence: number, reasons: MusicCatalogResolutionReason[]): MusicCatalogResolution {
  return { outcome, confidence, evidence: evidence([], reasons), reasons };
}

function cleanIdentity(value: string | undefined): string | undefined {
  const cleaned = value?.trim().toLowerCase();
  return cleaned ? cleaned : undefined;
}

function compareFullCandidates(a: ScoredFullTrack, b: ScoredFullTrack): number {
  return b.score - a.score || a.release.provider.localeCompare(b.release.provider) ||
    a.release.providerReleaseId.localeCompare(b.release.providerReleaseId) || a.track.providerTrackId.localeCompare(b.track.providerTrackId);
}

function uniqueFullCandidates(candidates: ScoredFullTrack[]): ScoredFullTrack[] {
  const unique = new Map<string, ScoredFullTrack>();
  for (const candidate of candidates) {
    const recordingId = cleanIdentity(candidate.track.musicbrainzRecordingId);
    const key = recordingId
      ? `mb:${recordingId}`
      : `${candidate.track.provider.toLowerCase()}:${candidate.track.providerTrackId}`;
    const existing = unique.get(key);
    if (!existing || compareFullCandidates(candidate, existing) < 0) unique.set(key, candidate);
  }
  return [...unique.values()];
}

function compareRelatedCandidates(a: ScoredRelatedRelease, b: ScoredRelatedRelease): number {
  return b.score - a.score || a.release.provider.localeCompare(b.release.provider) || a.release.providerReleaseId.localeCompare(b.release.providerReleaseId);
}
