import { z } from "zod";

export const PUBLIC_KITSU_CLIENT_ID =
  "dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd";
export const PUBLIC_KITSU_CLIENT_SECRET =
  "54d7307928f63414defd96399fc31ba847961ceaecef3a5fd93144e960c0e151";
const DEFAULT_ADMIN_PASSWORD = "Password123";

/**
 * Production passwords need enough entropy for a small self-hosted deployment
 * without making routine configuration unnecessarily cumbersome. A literal
 * space satisfies the lowercase-or-space category; all whitespace is excluded
 * from the special category so it cannot be counted twice.
 */
export function isValidProductionAdminPassword(password: string): boolean {
  if (password.length < 6) return false;

  const categoryCount = [
    /[A-Z]/.test(password),
    /[a-z ]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9\s]/.test(password),
  ].filter(Boolean).length;

  return categoryCount >= 3;
}

const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0" || normalized === "") return false;
  return value;
}, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  MEDIA_ROOT: z.string().min(1),
  AMF_LIBRARY_ROOT: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  KITSU_CLIENT_ID: z.preprocess(blankToUndefined, z.string().default(PUBLIC_KITSU_CLIENT_ID)),
  KITSU_CLIENT_SECRET: z.preprocess(
    blankToUndefined,
    z.string().default(PUBLIC_KITSU_CLIENT_SECRET),
  ),
  KITSU_AUTH_MODE: z.enum(["stub", "real"]).default("stub"),
  // Per-user periodic full sync cadence. Freshness between weekly full syncs
  // comes from login/device-activity delta triggers.
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(10080),
  AUDIO_BACKFILL_DELAY_SECONDS: z.coerce.number().int().nonnegative().default(8),
  // Override the AnimeThemes API origin to route through an operator-controlled
  // mirror/reverse-proxy when the public host hard-blocks this server's IP
  // (Cloudflare 403). Defaults to the public API.
  ANIMETHEMES_BASE_URL: z.preprocess(
    blankToUndefined,
    z.string().url().default("https://api.animethemes.moe"),
  ),
  // Catalog exposure and automatic discovery are independent rollout switches.
  MUSIC_CATALOG_ENABLED: booleanFromEnvironment.default(false),
  MUSIC_DISCOVERY_ENABLED: booleanFromEnvironment.default(false),
  ADMIN_PASSWORD: z.string().min(1).default(DEFAULT_ADMIN_PASSWORD),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }

  if (parsed.data.NODE_ENV !== "development" && parsed.data.NODE_ENV !== "test"
    && !isValidProductionAdminPassword(parsed.data.ADMIN_PASSWORD)) {
    throw new Error(
      "Invalid environment configuration — ADMIN_PASSWORD must be at least 6 characters and use at least 3 of uppercase, lowercase-or-space, digit, and special categories outside development/test.",
    );
  }
  return parsed.data;
}
