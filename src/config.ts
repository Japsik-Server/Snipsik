import { z } from "zod";

export const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DATABASE_URL: z
    .string()
    .optional()
    .transform((val) => {
      // In test mode, default to isolated in-memory SQLite database if omitted or if a legacy postgres URL is present in local .env
      if (
        process.env.NODE_ENV === "test" &&
        (!val || val.startsWith("postgres:") || val.startsWith("postgresql:"))
      ) {
        return "file::memory:";
      }
      return val || process.env.TURSO_DATABASE_URL || "";
    })
    .pipe(
      z
        .string()
        .min(1, "DATABASE_URL or TURSO_DATABASE_URL is required")
        .refine(
          (url) => {
            const trimmed = url.trim();
            const lower = trimmed.toLowerCase();
            if (
              lower.startsWith("postgres:") ||
              lower.startsWith("postgresql:")
            ) {
              return false;
            }
            if (lower.startsWith("file:")) {
              return trimmed.length > 5;
            }
            try {
              const parsed = new URL(trimmed);
              const validProtocols = [
                "libsql:",
                "https:",
                "http:",
                "wss:",
                "ws:",
              ];
              return (
                validProtocols.includes(parsed.protocol) &&
                parsed.host.length > 0
              );
            } catch {
              return false;
            }
          },
          {
            message:
              "DATABASE_URL must be a valid LibSQL connection URL with a host (e.g. 'libsql://database-org.turso.io') or a valid local file path (e.g. 'file:local.db'). PostgreSQL URLs are no longer supported.",
          },
        ),
    ),
  DATABASE_AUTH_TOKEN: z
    .string()
    .optional()
    .transform((val) => val || process.env.TURSO_AUTH_TOKEN || undefined),
  SINK_BASE_URL: z
    .string()
    .url("SINK_BASE_URL must be a valid URL")
    .transform((url) => url.replace(/\/+$/, "")),
  SINK_API_TOKEN: z.string().min(1, "SINK_API_TOKEN is required"),
  RANDOM_SLUG_LENGTH: z
    .string()
    .optional()
    .default("3")
    .transform((val) => {
      const parsed = parseInt(val, 10);
      return isNaN(parsed) || parsed < 2 ? 3 : parsed;
    }),
  ADMIN_USER_IDS: z
    .string()
    .optional()
    .default("")
    .transform((val) =>
      val
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  AUTO_SHORTEN_MIN_URL_LENGTH: z
    .string()
    .optional()
    .default("70")
    .transform((val) => {
      const trimmed = val.trim();
      if (!/^\d+$/.test(trimmed)) return 70;
      const parsed = parseInt(trimmed, 10);
      if (isNaN(parsed) || parsed < 0) return 70;
      return Math.min(parsed, 2048);
    }),
  IGNORED_DOMAINS: z
    .string()
    .optional()
    .default("")
    .transform((val) =>
      val
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0),
    ),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export type Config = z.infer<typeof envSchema>;

let parsedConfig: Config;

try {
  parsedConfig = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    const errorDetails = error.errors
      .map((err) => `  - ${err.path.join(".")}: ${err.message}`)
      .join("\n");
    console.error(
      `\x1b[31m❌ Environment Configuration Error:\x1b[0m\n${errorDetails}`,
    );
    process.exit(1);
  }
  throw error;
}

export const config = parsedConfig;
