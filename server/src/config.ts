import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  MEDIA_ROOT: z.string().min(1),
  // Kitsu credentials are unused until the real OAuth client lands (S2).
  KITSU_CLIENT_ID: z.string().optional(),
  KITSU_CLIENT_SECRET: z.string().optional(),
  KITSU_AUTH_MODE: z.enum(["stub", "real"]).default("stub"),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(360),
  AUDIO_BACKFILL_DELAY_SECONDS: z.coerce.number().int().nonnegative().default(8),
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
