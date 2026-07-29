const NON_WORD = /[^\p{L}\p{N}]+/gu;

/** Stable catalog comparison key: width/case folded with punctuation collapsed. */
export function normalizeMusicText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .normalize("NFKD")
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, "")
    .normalize("NFKC")
    .replace(NON_WORD, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function musicTokens(value: string): string[] {
  const normalized = normalizeMusicText(value);
  return normalized.length === 0 ? [] : [...new Set(normalized.split(" "))].sort();
}

export function tokenSimilarity(left: string, right: string): number {
  const a = new Set(musicTokens(left));
  const b = new Set(musicTokens(right));
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function exactOrNear(left: string, right: string, minimum = 0.85): boolean {
  const normalizedLeft = normalizeMusicText(left);
  const normalizedRight = normalizeMusicText(right);
  return normalizedLeft.length > 0 &&
    (normalizedLeft === normalizedRight || tokenSimilarity(normalizedLeft, normalizedRight) >= minimum);
}

export function containsNormalized(haystack: string, needle: string): boolean {
  const normalizedHaystack = ` ${normalizeMusicText(haystack)} `;
  const normalizedNeedle = normalizeMusicText(needle);
  return normalizedNeedle.length > 0 && normalizedHaystack.includes(` ${normalizedNeedle} `);
}
