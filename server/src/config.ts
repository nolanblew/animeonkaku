import { z } from "zod";

export const PUBLIC_KITSU_CLIENT_ID =
  "dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd";
export const PUBLIC_KITSU_CLIENT_SECRET =
  "54d7307928f63414defd96399fc31ba847961ceaecef3a5fd93144e960c0e151";

const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

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
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(360),
  AUDIO_BACKFILL_DELAY_SECONDS: z.coerce.number().int().nonnegative().default(8),
  // Override the AnimeThemes API origin to route through an operator-controlled
  // mirror/reverse-proxy when the public host hard-blocks this server's IP
  // (Cloudflare 403). Defaults to the public API.
  ANIMETHEMES_BASE_URL: z.preprocess(
    blankToUndefined,
    z.string().url().default("https://api.animethemes.moe"),
  ),
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
  return parsed.data;
}
