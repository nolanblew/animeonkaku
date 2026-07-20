import { z } from "zod";

export const PUBLIC_KITSU_CLIENT_ID =
  "dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd";
export const PUBLIC_KITSU_CLIENT_SECRET =
  "54d7307928f63414defd96399fc31ba847961ceaecef3a5fd93144e960c0e151";

const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0" || normalized === "") return false;
  return value;
}, z.boolean());

const optionalNonBlankString = z.preprocess(blankToUndefined, z.string().min(1).optional());
const optionalPositiveInteger = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().positive().optional(),
);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  MEDIA_ROOT: z.string().min(1),
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
  MUSIC_PROVIDER: z.enum(["disabled", "LIDARR"]).default("disabled"),
  LIDARR_BASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  LIDARR_API_KEY: optionalNonBlankString,
  LIDARR_ROOT_FOLDER_PATH: optionalNonBlankString,
  LIDARR_SHARED_ROOT: optionalNonBlankString,
  LIDARR_PATH_PREFIX_FROM: optionalNonBlankString,
  LIDARR_PATH_PREFIX_TO: optionalNonBlankString,
  LIDARR_QUALITY_PROFILE_ID: optionalPositiveInteger,
  LIDARR_METADATA_PROFILE_ID: optionalPositiveInteger,
  LIDARR_OWNERSHIP_TAG_ID: optionalPositiveInteger,
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

  const config = parsed.data;
  const issues: string[] = [];
  if (config.MUSIC_DISCOVERY_ENABLED && config.MUSIC_PROVIDER === "disabled") {
    issues.push("MUSIC_DISCOVERY_ENABLED requires MUSIC_PROVIDER=LIDARR");
  }

  if (config.MUSIC_PROVIDER === "LIDARR") {
    const requiredLidarrFields = [
      "LIDARR_BASE_URL",
      "LIDARR_API_KEY",
      "LIDARR_ROOT_FOLDER_PATH",
      "LIDARR_SHARED_ROOT",
      "LIDARR_QUALITY_PROFILE_ID",
      "LIDARR_METADATA_PROFILE_ID",
    ] as const;
    for (const field of requiredLidarrFields) {
      if (config[field] === undefined) issues.push(`${field}: required when MUSIC_PROVIDER=LIDARR`);
    }
    if ((config.LIDARR_PATH_PREFIX_FROM === undefined) !== (config.LIDARR_PATH_PREFIX_TO === undefined)) {
      issues.push("LIDARR_PATH_PREFIX_FROM and LIDARR_PATH_PREFIX_TO must be set together");
    }
  }

  if (issues.length > 0) {
    throw new Error(`Invalid environment configuration — ${issues.join("; ")}`);
  }
  return config;
}
