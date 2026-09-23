import { describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { assertSchemaCompatible, REQUIRED_SCHEMA_VERSION } from "@/db/schemaCompatibility";
import { isDeploymentReady } from "@/services/readinessPolicy";

describe("deployment readiness", () => {
  it("requires Discord, DB, and every policy cache ready", () => {
    expect(isDeploymentReady(true, true, ["ready", "ready", "ready"])).toBe(true);
    expect(isDeploymentReady(false, true, ["ready", "ready", "ready"])).toBe(false);
    expect(isDeploymentReady(true, false, ["ready", "ready", "ready"])).toBe(false);
    expect(isDeploymentReady(true, true, ["ready", "degraded", "ready"])).toBe(false);
    expect(isDeploymentReady(true, true, ["ready", "uninitialized", "ready"])).toBe(false);
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
