import { describe, expect, it } from "bun:test";
import { envSchema } from "@/config";

describe("Config Schema AUTO_SHORTEN_MIN_URL_LENGTH parsing", () => {
  const baseEnv = {
    DISCORD_TOKEN: "mock-token",
    DISCORD_CLIENT_ID: "1234567890",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    SINK_BASE_URL: "https://s.japsik.com",
    SINK_API_TOKEN: "mock-sink-token",
  };

  it("defaults to 70 when AUTO_SHORTEN_MIN_URL_LENGTH is undefined", () => {
    const parsed = envSchema.parse({ ...baseEnv });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(70);
  });

  it("rejects non-numeric characters and falls back to 70 for partially numeric input", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      AUTO_SHORTEN_MIN_URL_LENGTH: "10invalid",
    });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(70);
  });

  it("falls back to 70 for negative numbers or invalid strings", () => {
    expect(
      envSchema.parse({ ...baseEnv, AUTO_SHORTEN_MIN_URL_LENGTH: "-5" })
        .AUTO_SHORTEN_MIN_URL_LENGTH,
    ).toBe(70);
    expect(
      envSchema.parse({ ...baseEnv, AUTO_SHORTEN_MIN_URL_LENGTH: "abc" })
        .AUTO_SHORTEN_MIN_URL_LENGTH,
    ).toBe(70);
  });

  it("parses 0 as valid without threshold restriction", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      AUTO_SHORTEN_MIN_URL_LENGTH: "0",
    });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(0);
  });

  it("parses valid positive integer within 0..2048", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      AUTO_SHORTEN_MIN_URL_LENGTH: " 120 ",
    });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(120);
  });

  it("caps maximum value at 2048", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      AUTO_SHORTEN_MIN_URL_LENGTH: "5000",
    });
    expect(parsed.AUTO_SHORTEN_MIN_URL_LENGTH).toBe(2048);
  });

  describe("DATABASE_URL validation", () => {
    it("accepts valid libsql URL", () => {
      const parsed = envSchema.parse({
        ...baseEnv,
        DATABASE_URL: "libsql://my-db-org.turso.io",
      });
      expect(parsed.DATABASE_URL).toBe("libsql://my-db-org.turso.io");
    });

    it("accepts valid file URL for local SQLite", () => {
      const parsed = envSchema.parse({
        ...baseEnv,
        DATABASE_URL: "file:local.db",
      });
      expect(parsed.DATABASE_URL).toBe("file:local.db");
    });

    it("rejects unsupported URL scheme in production environment", () => {
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        expect(() =>
          envSchema.parse({
            ...baseEnv,
            DATABASE_URL: "mysql://user:pass@localhost:3306/db",
          }),
        ).toThrow("DATABASE_URL must be a valid LibSQL connection URL");

        expect(() =>
          envSchema.parse({
            ...baseEnv,
            DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
          }),
        ).toThrow("PostgreSQL URLs are no longer supported");
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });
});
