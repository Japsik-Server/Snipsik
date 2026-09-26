import { describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import {
  assertSchemaCompatible,
  REQUIRED_SCHEMA_VERSION,
} from "@/db/schemaCompatibility";
import { firstConfiguredValue } from "@/db/connectionConfig";
import { ALLOWED_DB_PROTOCOLS } from "@/db/checkSchema";
import { isDeploymentReady } from "@/services/readinessPolicy";
import {
  createDatabaseProbe,
  probeDatabase,
  writeReadinessTimestamp,
} from "@/services/deploymentReadiness";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("deployment readiness", () => {
  it("requires Discord, DB, and every policy cache ready", () => {
    expect(isDeploymentReady(true, true, ["ready", "ready", "ready"])).toBe(
      true,
    );
    expect(isDeploymentReady(false, true, ["ready", "ready", "ready"])).toBe(
      false,
    );
    expect(isDeploymentReady(true, false, ["ready", "ready", "ready"])).toBe(
      false,
    );
    expect(isDeploymentReady(true, true, ["ready", "degraded", "ready"])).toBe(
      false,
    );
    expect(
      isDeploymentReady(true, true, ["ready", "uninitialized", "ready"]),
    ).toBe(false);
  });

  it("times out a stalled DB probe so the next probe can run", async () => {
    await expect(
      probeDatabase(() => new Promise(() => {}), 10),
    ).rejects.toThrow("timed out");
    let attempts = 0;
    await probeDatabase(async () => {
      attempts++;
    });
    expect(attempts).toBe(1);
  });

  it("does not start another DB request while a timed-out request is pending", async () => {
    let finish!: () => void;
    let attempts = 0;
    const probe = createDatabaseProbe(() => {
      attempts++;
      return attempts === 1
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve();
    }, 10);

    await expect(probe()).rejects.toThrow("timed out");
    await expect(probe()).rejects.toThrow("still running");
    expect(attempts).toBe(1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(probe()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("retries after the previous database transport is cancelled", async () => {
    let attempts = 0;
    let cancelCount = 0;
    let rejectRequest!: (error: Error) => void;
    const probe = createDatabaseProbe(
      () => {
        attempts++;
        return new Promise<void>((_, reject) => {
          rejectRequest = reject;
        });
      },
      10,
      () => {
        cancelCount++;
        rejectRequest(new Error("aborted"));
      },
    );

    await expect(probe()).rejects.toThrow("timed out");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(probe()).rejects.toThrow("timed out");
    expect(attempts).toBe(2);
    expect(cancelCount).toBe(2);
  });

  it("replaces the readiness timestamp without exposing an empty file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snipsik-readiness-"));
    const file = join(dir, "ready");
    try {
      await writeReadinessTimestamp(file, 1);
      const writes = (async () => {
        for (let index = 0; index < 30; index++)
          await writeReadinessTimestamp(file, index + 2);
      })();
      const reads = Promise.all(
        Array.from({ length: 100 }, () => readFile(file, "utf8")),
      );
      await writes;
      expect((await reads).every((value) => /^\d+$/.test(value))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("schema deployment gate", () => {
  it("selects the first nonempty runtime and preflight connection value", () => {
    expect(firstConfiguredValue("", "fallback")).toBe("fallback");
    expect(firstConfiguredValue("primary", "fallback")).toBe("primary");
    expect(firstConfiguredValue("  ", undefined)).toBeUndefined();
  });

  it("uses the runtime database URL fallback when DATABASE_URL is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snipsik-schema-fallback-"));
    try {
      const process = Bun.spawn(["bun", "src/db/checkSchema.ts"], {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...globalThis.process.env,
          DATABASE_URL: "",
          TURSO_DATABASE_URL: `file:${join(dir, "fallback.db")}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await process.exited).not.toBe(0);
      const output = await new Response(process.stderr).text();
      expect(output).toContain("Schema v1 missing");
      expect(output).not.toContain(
        "DATABASE_URL or TURSO_DATABASE_URL is required",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts an applied baseline and rejects a missing required column", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snipsik-schema-baseline-"));
    const originalTursoUrl = process.env.TURSO_DATABASE_URL;
    let db: ReturnType<typeof createClient> | undefined;
    try {
      process.env.TURSO_DATABASE_URL = `file:${join(dir, "baseline.db")}`;
      const databaseUrl = process.env.TURSO_DATABASE_URL;
      if (!databaseUrl)
        throw new Error(
          "TURSO_DATABASE_URL is required for schema baseline test",
        );
      db = createClient({ url: databaseUrl });
      await db.execute(
        "CREATE TABLE watch_channels (id INTEGER, guild_id TEXT, channel_id TEXT, created_by TEXT, created_at INTEGER)",
      );
      await db.execute(
        "CREATE TABLE guild_configs (guild_id TEXT, auto_shorten_enabled INTEGER, auto_shorten_min_url_length INTEGER, ignored_domains TEXT, version INTEGER, created_at INTEGER, updated_at INTEGER)",
      );
      await db.execute(
        "CREATE TABLE user_configs (user_id TEXT, auto_dm_mode TEXT, dm_format TEXT, auto_shorten_min_url_length INTEGER, ignored_domains TEXT, fixupx_enabled INTEGER, version INTEGER, created_at INTEGER, updated_at INTEGER)",
      );
      expect(REQUIRED_SCHEMA_VERSION).toBe(1);
      await expect(assertSchemaCompatible(db)).resolves.toBeUndefined();
      await db.execute("ALTER TABLE user_configs DROP COLUMN fixupx_enabled");
      await expect(assertSchemaCompatible(db)).rejects.toThrow(
        "Schema v1 missing user_configs: fixupx_enabled",
      );
    } finally {
      db?.close();
      if (originalTursoUrl === undefined) {
        delete process.env.TURSO_DATABASE_URL;
      } else {
        process.env.TURSO_DATABASE_URL = originalTursoUrl;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid database URL protocol during schema preflight", async () => {
    const process = Bun.spawn(["bun", "src/db/checkSchema.ts"], {
      cwd: join(import.meta.dir, ".."),
      env: {
        ...globalThis.process.env,
        DATABASE_URL: "invalid://some-host",
        TURSO_DATABASE_URL: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await process.exited).not.toBe(0);
    const output = await new Response(process.stderr).text();
    expect(output).toContain(
      `Invalid database URL: must start with one of ${ALLOWED_DB_PROTOCOLS.join(", ")}`,
    );
  });

  it("rejects an empty or malformed database URL structure during schema preflight", async () => {
    const process = Bun.spawn(["bun", "src/db/checkSchema.ts"], {
      cwd: join(import.meta.dir, ".."),
      env: {
        ...globalThis.process.env,
        DATABASE_URL: "https:",
        TURSO_DATABASE_URL: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await process.exited).not.toBe(0);
    const output = await new Response(process.stderr).text();
    expect(output).toContain(
      "Invalid database URL: must be a valid absolute URL",
    );
  });
});
