/**
 * Server-side port of the Android dynamic-playlist filter + sort engine
 * (`data/filter/FilterEvaluator.kt`, `SortComparators.kt`). Kept behaviourally in lock-step so a
 * dynamic playlist materialized on the server matches what the device would have produced.
 *
 * Specs are stored/transported as the Moshi polymorphic JSON the client writes: each node is an
 * object with a `"type"` discriminator (`and`, `or`, `genre_in`, `aired_on`, …). We evaluate the
 * parsed JSON directly rather than reifying a TS union, so unknown/legacy nodes degrade safely.
 *
 * Device-specific dimensions (`downloaded` filter, `DOWNLOADED` sort) have no server meaning;
 * the server treats "downloaded" as the empty set (nothing downloaded) — documented in plan 10.
 */

export interface EvalAnime {
  title: string | null;
  startDate: string | null; // YYYY-MM-DD
  subtype: string | null;
  averageRating: number | null;
  userRating: number | null;
  watchingStatus: string | null;
  libraryUpdatedAt: number | null; // epoch ms
  kitsuId: string | null;
}

export interface EvalTheme {
  id: number;
  title: string;
  themeType: string | null;
  artistName: string | null;
  animeThemesId: number | null;
}

export interface EvalContext {
  themes: EvalTheme[];
  animeByThemesId: Map<number, EvalAnime>;
  genresByKitsuId: Map<string, Set<string>>;
  likedThemeIds: Set<number>;
  dislikedThemeIds: Set<number>;
  downloadedThemeIds: Set<number>;
  playCountByTheme: Map<number, number>;
  lastPlayedByTheme: Map<number, number>;
  nowMillis: number;
}

type Json = Record<string, unknown>;

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Ordered themeIds matching `filter`, sorted by `sort` (with the canonical fallback order). */
export function evaluate(
  filter: unknown,
  sort: unknown,
  ctx: EvalContext,
): number[] {
  const matched = ctx.themes.filter((theme) => matches(filter, theme, ctx));
  const comparator = buildComparator(sort, ctx);
  return [...matched].sort(comparator).map((theme) => theme.id);
}

/** Count without sorting. */
export function countMatches(filter: unknown, ctx: EvalContext): number {
  let count = 0;
  for (const theme of ctx.themes) if (matches(filter, theme, ctx)) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// Filter matching (mirrors FilterEvaluator.matches)
// ---------------------------------------------------------------------------

export function matches(node: unknown, theme: EvalTheme, ctx: EvalContext): boolean {
  if (!isJson(node) || typeof node.type !== "string") return false;
  const anime = theme.animeThemesId !== null ? ctx.animeByThemesId.get(theme.animeThemesId) ?? null : null;
  const animeKitsuId = anime?.kitsuId ?? null;

  switch (node.type) {
    case "and": {
      const children = asArray(node.children);
      return children.length === 0 || children.every((c) => matches(c, theme, ctx));
    }
    case "or": {
      const children = asArray(node.children);
      return children.length > 0 && children.some((c) => matches(c, theme, ctx));
    }
    case "not":
      return !matches(node.child, theme, ctx);

    case "genre_in": {
      if (animeKitsuId === null) return false;
      const genreSlugs = ctx.genresByKitsuId.get(animeKitsuId);
      if (!genreSlugs) return false;
      const slugs = asStringArray(node.slugs);
      return node.matchAll === true
        ? slugs.every((s) => genreSlugs.has(s))
        : slugs.some((s) => genreSlugs.has(s));
    }
    case "aired_on": {
      const year = startYear(anime);
      if (year === null) return false;
      const anchorYear = resolveYear(node.anchor, ctx.nowMillis);
      return compareDateOp(node.operator, year, anchorYear, () =>
        node.endAnchor != null ? resolveYear(node.endAnchor, ctx.nowMillis) : anchorYear,
      );
    }
    case "season_in": {
      const month = startMonth(anime);
      if (month === null) return false;
      const season = monthToSeason(month);
      if (season === null) return false;
      return asStringArray(node.seasons).includes(season);
    }
    case "subtype_in": {
      const subtype = anime?.subtype;
      if (subtype == null) return false;
      return asStringArray(node.subtypes).map((s) => s.toLowerCase()).includes(subtype.toLowerCase());
    }
    case "average_rating_gte": {
      const rating = anime?.averageRating;
      return rating != null && rating >= num(node.min);
    }
    case "user_rating_gte": {
      const rating = anime?.userRating;
      return rating != null && rating >= num(node.min);
    }
    case "watching_status_in": {
      const status = anime?.watchingStatus;
      if (status == null) return false;
      return asStringArray(node.statuses).includes(status);
    }
    case "watched_on": {
      const updatedAt = anime?.libraryUpdatedAt;
      if (updatedAt == null) return false;
      const anchorMs = resolveMillis(node.anchor, ctx.nowMillis);
      return compareMillisOp(node.operator, updatedAt, anchorMs, () =>
        node.endAnchor != null ? resolveMillis(node.endAnchor, ctx.nowMillis) : anchorMs,
      );
    }
    case "theme_type_in": {
      const type = theme.themeType?.toUpperCase();
      if (type == null) return false;
      return asStringArray(node.types).some((prefix) => type.startsWith(prefix.toUpperCase()));
    }
    case "artist_in": {
      const artistName = theme.artistName;
      if (artistName == null) return false;
      const lower = artistName.toLowerCase();
      return asStringArray(node.artistNames).some((name) => lower.includes(name.toLowerCase()));
    }
    case "title_matches": {
      const title = anime?.title;
      if (title == null) return false;
      return matchesPattern(title, str(node.pattern), node.isRegex === true);
    }
    case "song_title_matches":
      return matchesPattern(theme.title, str(node.pattern), node.isRegex === true);
    case "liked":
      return ctx.likedThemeIds.has(theme.id);
    case "disliked":
      return ctx.dislikedThemeIds.has(theme.id);
    case "downloaded":
      return ctx.downloadedThemeIds.has(theme.id); // server: empty set
    case "play_count_gte":
      return (ctx.playCountByTheme.get(theme.id) ?? 0) >= num(node.min);
    case "played_on": {
      const lastPlayed = ctx.lastPlayedByTheme.get(theme.id);
      if (lastPlayed == null) return false;
      const anchorMs = resolveMillis(node.anchor, ctx.nowMillis);
      return comparePlayedOp(node.operator, lastPlayed, anchorMs, () =>
        node.endAnchor != null ? resolveMillis(node.endAnchor, ctx.nowMillis) : anchorMs,
      );
    }

    // Legacy nodes (read-only parity with deprecated FilterNode variants)
    case "aired_before": {
      const year = startYear(anime);
      return year != null && year < num(node.year);
    }
    case "aired_after": {
      const year = startYear(anime);
      return year != null && year >= num(node.year);
    }
    case "aired_between": {
      const year = startYear(anime);
      return year != null && year >= num(node.minYear) && year <= num(node.maxYear);
    }
    case "library_updated_after": {
      const updatedAt = anime?.libraryUpdatedAt;
      return updatedAt != null && updatedAt > num(node.epochMillis);
    }
    case "library_updated_within": {
      const updatedAt = anime?.libraryUpdatedAt;
      return updatedAt != null && updatedAt > ctx.nowMillis - num(node.durationMillis);
    }
    case "played_since": {
      const lastPlayed = ctx.lastPlayedByTheme.get(theme.id);
      return lastPlayed != null && lastPlayed >= num(node.epochMillis);
    }
    default:
      return false;
  }
}

// AiredOn: GT means year >= anchor; LT means year < anchor; BETWEEN inclusive.
function compareDateOp(op: unknown, year: number, anchorYear: number, endYear: () => number): boolean {
  switch (op) {
    case "GT":
      return year >= anchorYear;
    case "LT":
      return year < anchorYear;
    case "BETWEEN": {
      const end = endYear();
      return year >= Math.min(anchorYear, end) && year <= Math.max(anchorYear, end);
    }
    default:
      return false;
  }
}

// WatchedOn: GT strictly greater; LT strictly less; BETWEEN inclusive.
function compareMillisOp(op: unknown, value: number, anchor: number, endMs: () => number): boolean {
  switch (op) {
    case "GT":
      return value > anchor;
    case "LT":
      return value < anchor;
    case "BETWEEN": {
      const end = endMs();
      return value >= Math.min(anchor, end) && value <= Math.max(anchor, end);
    }
    default:
      return false;
  }
}

// PlayedOn: GT means >= anchor (matches Kotlin); LT strictly less; BETWEEN inclusive.
function comparePlayedOp(op: unknown, value: number, anchor: number, endMs: () => number): boolean {
  switch (op) {
    case "GT":
      return value >= anchor;
    case "LT":
      return value < anchor;
    case "BETWEEN": {
      const end = endMs();
      return value >= Math.min(anchor, end) && value <= Math.max(anchor, end);
    }
    default:
      return false;
  }
}

function matchesPattern(text: string, pattern: string, isRegex: boolean): boolean {
  if (pattern.trim().length === 0) return true;
  if (isRegex) {
    try {
      return new RegExp(pattern).test(text);
    } catch {
      return false;
    }
  }
  return text.toLowerCase().includes(pattern.toLowerCase());
}

// ---------------------------------------------------------------------------
// Date anchors (mirror resolveYear / resolveMillis)
// ---------------------------------------------------------------------------

function resolveYear(anchor: unknown, nowMillis: number): number {
  if (!isJson(anchor)) return new Date(nowMillis).getUTCFullYear();
  if (anchor.type === "absolute_year") return num(anchor.year);
  const minus = minusPeriod(nowMillis, str(anchor.unit), num(anchor.amount));
  return minus.year;
}

function resolveMillis(anchor: unknown, nowMillis: number): number {
  if (!isJson(anchor)) return nowMillis;
  if (anchor.type === "absolute_year") return Date.UTC(num(anchor.year), 0, 1);
  const minus = minusPeriod(nowMillis, str(anchor.unit), num(anchor.amount));
  return Date.UTC(minus.year, minus.month - 1, minus.day);
}

interface YMD {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** java.time.LocalDate-equivalent subtraction from the UTC day containing nowMillis. */
function minusPeriod(nowMillis: number, unit: string, amount: number): YMD {
  const epochDay = Math.floor(nowMillis / MS_PER_DAY);
  const base = new Date(epochDay * MS_PER_DAY);
  let y = base.getUTCFullYear();
  let m = base.getUTCMonth() + 1;
  let d = base.getUTCDate();
  switch (unit) {
    case "DAYS": {
      const shifted = new Date((epochDay - amount) * MS_PER_DAY);
      return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
    }
    case "MONTHS": {
      const total = y * 12 + (m - 1) - amount;
      y = Math.floor(total / 12);
      m = (total % 12 + 12) % 12 + 1;
      d = Math.min(d, daysInMonth(y, m));
      return { year: y, month: m, day: d };
    }
    case "YEARS": {
      y -= amount;
      d = Math.min(d, daysInMonth(y, m));
      return { year: y, month: m, day: d };
    }
    default:
      return { year: y, month: m, day: d };
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Sorting (mirrors buildThemeComparator)
// ---------------------------------------------------------------------------

type Cmp = (a: EvalTheme, b: EvalTheme) => number;

const GOLDEN = BigInt.asIntN(64, 0x9e3779b97f4a7c15n);

const THEME_TYPE_ORDER = ["OP", "IN", "ED"];

const DEFAULT_CATEGORICAL: Record<string, string[]> = {
  THEME_TYPE: THEME_TYPE_ORDER,
  SEASON: ["WINTER", "SPRING", "SUMMER", "FALL"],
  WATCHING_STATUS: ["current", "completed"],
  SUBTYPE: ["tv", "movie", "ova", "ona", "special", "music"],
};

export function buildComparator(sort: unknown, ctx: EvalContext): Cmp {
  const keys = isJson(sort) ? asArray(sort.keys) : [];
  const comparators: Cmp[] = [];
  for (const key of keys) {
    if (isJson(key)) comparators.push(comparatorForKey(key, ctx));
  }
  comparators.push(defaultOrder(ctx));
  return (a, b) => {
    for (const cmp of comparators) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

function comparatorForKey(key: Json, ctx: EvalContext): Cmp {
  const attr = str(key.attribute);
  if (attr === "RANDOM") {
    return (a, b) => {
      const ra = BigInt.asIntN(64, (BigInt(a.id) ^ BigInt(ctx.nowMillis)) * GOLDEN);
      const rb = BigInt.asIntN(64, (BigInt(b.id) ^ BigInt(ctx.nowMillis)) * GOLDEN);
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    };
  }
  const desc = str(key.direction) === "DESC";
  const order = asStringArray(key.categoricalOrder).length > 0
    ? asStringArray(key.categoricalOrder)
    : DEFAULT_CATEGORICAL[attr] ?? [];

  switch (attr) {
    case "TITLE":
      return stringCmp(desc, (t) => t.title);
    case "ARTIST":
      return nullableStringCmp(desc, (t) => t.artistName);
    case "ANIME_TITLE":
      return nullableStringCmp(desc, (t) => animeFor(t, ctx)?.title ?? null);
    case "THEME_TYPE":
      return (a, b) => {
        const r = rankCmp(categoricalRank(a.themeType?.toUpperCase().slice(0, 2) ?? null, order),
          categoricalRank(b.themeType?.toUpperCase().slice(0, 2) ?? null, order));
        return r !== 0 ? r : seq(a.themeType) - seq(b.themeType);
      };
    case "WATCHING_STATUS":
      return (a, b) => rankCmp(
        categoricalRank(animeFor(a, ctx)?.watchingStatus ?? null, order),
        categoricalRank(animeFor(b, ctx)?.watchingStatus ?? null, order));
    case "SUBTYPE":
      return (a, b) => rankCmp(
        categoricalRank(animeFor(a, ctx)?.subtype?.toLowerCase() ?? null, order),
        categoricalRank(animeFor(b, ctx)?.subtype?.toLowerCase() ?? null, order));
    case "SEASON":
      return (a, b) => rankCmp(
        categoricalRank(seasonOf(animeFor(a, ctx)), order),
        categoricalRank(seasonOf(animeFor(b, ctx)), order));
    case "AIRED_DATE":
      return nullableNumberCmp(desc, (t) => startMillis(animeFor(t, ctx)));
    case "WATCHED_DATE":
      return nullableNumberCmp(desc, (t) => animeFor(t, ctx)?.libraryUpdatedAt ?? null);
    case "AVERAGE_RATING":
      return nullableNumberCmp(desc, (t) => animeFor(t, ctx)?.averageRating ?? null);
    case "MY_RATING":
      return nullableNumberCmp(desc, (t) => animeFor(t, ctx)?.userRating ?? null);
    case "PLAY_COUNT":
      return numberCmp(desc, (t) => ctx.playCountByTheme.get(t.id) ?? 0);
    case "LAST_PLAYED":
      return nullableNumberCmp(desc, (t) => ctx.lastPlayedByTheme.get(t.id) ?? null);
    case "LIKED":
      return boolCmp(desc, (t) => ctx.likedThemeIds.has(t.id));
    case "DOWNLOADED":
      return boolCmp(desc, (t) => ctx.downloadedThemeIds.has(t.id));
    default:
      return () => 0;
  }
}

function defaultOrder(ctx: EvalContext): Cmp {
  const typeOrder = THEME_TYPE_ORDER;
  return (a, b) => {
    const titleCmp = ciCompare(animeFor(a, ctx)?.title ?? "", animeFor(b, ctx)?.title ?? "");
    if (titleCmp !== 0) return titleCmp;
    const rankA = categoricalRank(a.themeType?.toUpperCase().slice(0, 2) ?? null, typeOrder);
    const rankB = categoricalRank(b.themeType?.toUpperCase().slice(0, 2) ?? null, typeOrder);
    if (rankA !== rankB) return rankA - rankB;
    return seq(a.themeType) - seq(b.themeType);
  };
}

function stringCmp(desc: boolean, sel: (t: EvalTheme) => string): Cmp {
  return (a, b) => {
    const cmp = ciCompare(sel(a), sel(b));
    return desc ? -cmp : cmp;
  };
}

function nullableStringCmp(desc: boolean, sel: (t: EvalTheme) => string | null): Cmp {
  return (a, b) => {
    const va = sel(a);
    const vb = sel(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1; // nulls always last
    if (vb === null) return -1;
    const cmp = ciCompare(va, vb);
    return desc ? -cmp : cmp;
  };
}

function numberCmp(desc: boolean, sel: (t: EvalTheme) => number): Cmp {
  return (a, b) => {
    const cmp = sel(a) - sel(b);
    return desc ? -cmp : cmp;
  };
}

function nullableNumberCmp(desc: boolean, sel: (t: EvalTheme) => number | null): Cmp {
  return (a, b) => {
    const va = sel(a);
    const vb = sel(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return desc ? -cmp : cmp;
  };
}

function boolCmp(desc: boolean, sel: (t: EvalTheme) => boolean): Cmp {
  return (a, b) => {
    const cmp = (sel(a) ? 0 : 1) - (sel(b) ? 0 : 1);
    return desc ? -cmp : cmp;
  };
}

export function categoricalRank(value: string | null, order: string[]): number {
  if (value === null) return order.length;
  const upper = value.toUpperCase();
  const idx = order.findIndex((o) => upper.startsWith(o.toUpperCase()));
  return idx >= 0 ? idx : order.length;
}

function rankCmp(a: number, b: number): number {
  return a - b;
}

function seq(themeType: string | null): number {
  if (!themeType) return 0;
  const digits = themeType.replace(/\D/g, "");
  return digits.length > 0 ? Number.parseInt(digits, 10) : 0;
}

function ciCompare(a: string, b: string): number {
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

function animeFor(theme: EvalTheme, ctx: EvalContext): EvalAnime | null {
  return theme.animeThemesId !== null ? ctx.animeByThemesId.get(theme.animeThemesId) ?? null : null;
}

function seasonOf(anime: EvalAnime | null): string | null {
  const month = startMonth(anime);
  return month === null ? null : monthToSeason(month);
}

function startYear(anime: EvalAnime | null): number | null {
  const raw = anime?.startDate;
  if (!raw) return null;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

function startMonth(anime: EvalAnime | null): number | null {
  const raw = anime?.startDate;
  if (!raw || raw.length < 7) return null;
  const month = Number.parseInt(raw.slice(5, 7), 10);
  return Number.isNaN(month) ? null : month;
}

function startMillis(anime: EvalAnime | null): number | null {
  const raw = anime?.startDate;
  if (!raw) return null;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  if (Number.isNaN(year)) return null;
  const month = clamp(Number.parseInt(raw.slice(5, 7), 10) || 1, 1, 12);
  const day = clamp(Number.parseInt(raw.slice(8, 10), 10) || 1, 1, 28);
  return Date.UTC(year, month - 1, day);
}

function monthToSeason(month: number): string | null {
  if (month >= 1 && month <= 3) return "WINTER";
  if (month >= 4 && month <= 6) return "SPRING";
  if (month >= 7 && month <= 9) return "SUMMER";
  if (month >= 10 && month <= 12) return "FALL";
  return null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === "string");
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value) || 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
