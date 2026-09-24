import { describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { assertSchemaCompatible, REQUIRED_SCHEMA_VERSION } from "@/db/schemaCompatibility";
import { isDeploymentReady } from "@/services/readinessPolicy";
import { createDatabaseProbe, probeDatabase, writeReadinessTimestamp } from "@/services/deploymentReadiness";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("deployment readiness", () => {
  it("requires Discord, DB, and every policy cache ready", () => {
    expect(isDeploymentReady(true, true, ["ready", "ready", "ready"])).toBe(true);
    expect(isDeploymentReady(false, true, ["ready", "ready", "ready"])).toBe(false);
    expect(isDeploymentReady(true, false, ["ready", "ready", "ready"])).toBe(false);
    expect(isDeploymentReady(true, true, ["ready", "degraded", "ready"])).toBe(false);
    expect(isDeploymentReady(true, true, ["ready", "uninitialized", "ready"])).toBe(false);
  });

  it("times out a stalled DB probe so the next probe can run", async () => {
    await expect(probeDatabase(() => new Promise(() => {}), 10)).rejects.toThrow("timed out");
    let attempts = 0;
    await probeDatabase(async () => { attempts++; });
    expect(attempts).toBe(1);
  });

  it("does not start another DB request while a timed-out request is pending", async () => {
    let finish!: () => void;
    let attempts = 0;
    const probe = createDatabaseProbe(() => {
      attempts++;
      return attempts === 1 ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve();
    }, 10);

    await expect(probe()).rejects.toThrow("timed out");
    await expect(probe()).rejects.toThrow("still running");
    expect(attempts).toBe(1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(probe()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("replaces the readiness timestamp without exposing an empty file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snipsik-readiness-"));
    const file = join(dir, "ready");
    try {
      await writeReadinessTimestamp(file, 1);
      const writes = (async () => {
        for (let index = 0; index < 30; index++) await writeReadinessTimestamp(file, index + 2);
      })();
      const reads = Promise.all(Array.from({ length: 100 }, () => readFile(file, "utf8")));
      await writes;
      expect((await reads).every((value) => /^\d+$/.test(value))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("schema deployment gate", () => {
  it("accepts an applied baseline and rejects a missing required column", async () => {
    const db = createClient({ url: "file::memory:" });
    try {
      await db.execute("CREATE TABLE watch_channels (id INTEGER, guild_id TEXT, channel_id TEXT, created_by TEXT, created_at INTEGER)");
      await db.execute("CREATE TABLE guild_configs (guild_id TEXT, auto_shorten_enabled INTEGER, auto_shorten_min_url_length INTEGER, ignored_domains TEXT, version INTEGER, created_at INTEGER, updated_at INTEGER)");
      await db.execute("CREATE TABLE user_configs (user_id TEXT, auto_dm_mode TEXT, dm_format TEXT, auto_shorten_min_url_length INTEGER, ignored_domains TEXT, fixupx_enabled INTEGER, version INTEGER, created_at INTEGER, updated_at INTEGER)");
      expect(REQUIRED_SCHEMA_VERSION).toBe(1);
      await expect(assertSchemaCompatible(db)).resolves.toBeUndefined();
      await db.execute("ALTER TABLE user_configs DROP COLUMN fixupx_enabled");
      await expect(assertSchemaCompatible(db)).rejects.toThrow("Schema v1 missing user_configs: fixupx_enabled");
    } finally {
      db.close();
    }
  });
});
