import { createClient } from "@libsql/client";
import postgres from "postgres";

interface MigrationSummary {
  tableName: string;
  sourceCount: number;
  targetBeforeCount: number;
  targetAfterCount: number;
  success: boolean;
}

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

// Resolve Source (PostgreSQL) URL
const sourcePgUrl =
  process.env.SOURCE_PG_URL ||
  process.env.PG_DATABASE_URL ||
  (process.env.DATABASE_URL?.startsWith("postgres")
    ? process.env.DATABASE_URL
    : undefined);

// Resolve Target (Turso / LibSQL) URL and Token
const targetTursoUrl =
  process.env.TARGET_TURSO_URL ||
  process.env.TURSO_DATABASE_URL ||
  (!process.env.DATABASE_URL?.startsWith("postgres")
    ? process.env.DATABASE_URL
    : undefined);

const targetTursoToken =
  process.env.TARGET_TURSO_AUTH_TOKEN ||
  process.env.TURSO_AUTH_TOKEN ||
  process.env.DATABASE_AUTH_TOKEN;

console.log("=================================================");
console.log("🚀 Snipsik DB Migration Tool: PostgreSQL -> Turso");
console.log("=================================================");
console.log(`Mode: ${isDryRun ? "🔍 DRY RUN (Simulation)" : "⚡ LIVE RUN"}`);

if (!sourcePgUrl) {
  console.error("❌ Error: Source PostgreSQL connection URL is missing.");
  console.error(
    "Please set SOURCE_PG_URL or PG_DATABASE_URL environment variable.",
  );
  process.exit(1);
}

if (!targetTursoUrl) {
  console.error("❌ Error: Target Turso connection URL is missing.");
  console.error(
    "Please set TARGET_TURSO_URL or TURSO_DATABASE_URL environment variable.",
  );
  process.exit(1);
}

console.log(`Source PG URL:   ${sourcePgUrl.replace(/:[^:@]+@/, ":****@")}`);
console.log(`Target Turso URL: ${targetTursoUrl}`);
console.log(
  `Auth Token:      ${targetTursoToken ? "Provided (masked)" : "None (e.g. local file or dev)"}`,
);
console.log("-------------------------------------------------");

const pg = postgres(sourcePgUrl, { max: 1 });
const turso = createClient({
  url: targetTursoUrl,
  authToken: targetTursoToken,
});

function toUnixTimestamp(dateValue: unknown): number {
  if (dateValue instanceof Date) {
    return Math.floor(dateValue.getTime() / 1000);
  }
  if (typeof dateValue === "string" || typeof dateValue === "number") {
    return Math.floor(new Date(dateValue).getTime() / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

async function migrate(): Promise<void> {
  const summaries: MigrationSummary[] = [];

  try {
    // 1. Verify connections
    console.log("Checking database connections...");
    await pg`SELECT 1`;
    console.log("  ✓ PostgreSQL connected successfully.");
    await turso.execute("SELECT 1");
    console.log("  ✓ Turso / LibSQL connected successfully.");
    console.log("-------------------------------------------------");

    // ==========================================
    // Table 1: watch_channels
    // ==========================================
    console.log("📦 Migrating [watch_channels]...");
    const pgWatchRows = await pg`
      SELECT id, guild_id, channel_id, created_by, created_at
      FROM watch_channels
      ORDER BY id ASC
    `;
    const tursoWatchBefore = await turso.execute(
      "SELECT count(*) as count FROM watch_channels",
    );
    const watchBeforeCount = Number(tursoWatchBefore.rows[0]?.count ?? 0);

    console.log(`  Found ${pgWatchRows.length} rows in PostgreSQL.`);
    console.log(`  Current Turso count: ${watchBeforeCount}`);

    if (isDryRun) {
      console.log(
        `  [DRY-RUN] Would upsert ${pgWatchRows.length} rows into watch_channels.`,
      );
      if (pgWatchRows.length > 0) {
        console.log("  Sample row:", JSON.stringify(pgWatchRows[0]));
      }
    } else {
      for (const row of pgWatchRows) {
        await turso.execute({
          sql: `
            INSERT INTO watch_channels (id, guild_id, channel_id, created_by, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              guild_id = excluded.guild_id,
              channel_id = excluded.channel_id,
              created_by = excluded.created_by,
              created_at = excluded.created_at
          `,
          args: [
            row.id,
            row.guild_id,
            row.channel_id,
            row.created_by,
            toUnixTimestamp(row.created_at),
          ],
        });
      }
    }

    const tursoWatchAfter = isDryRun
      ? watchBeforeCount
      : Number(
          (await turso.execute("SELECT count(*) as count FROM watch_channels"))
            .rows[0]?.count ?? 0,
        );

    summaries.push({
      tableName: "watch_channels",
      sourceCount: pgWatchRows.length,
      targetBeforeCount: watchBeforeCount,
      targetAfterCount: tursoWatchAfter,
      success: isDryRun || tursoWatchAfter >= pgWatchRows.length,
    });

    // ==========================================
    // Table 2: guild_configs
    // ==========================================
    console.log("\n📦 Migrating [guild_configs]...");
    const pgGuildRows = await pg`
      SELECT guild_id, auto_shorten_enabled, auto_shorten_min_url_length, ignored_domains, created_at, updated_at
      FROM guild_configs
      ORDER BY guild_id ASC
    `;
    const tursoGuildBefore = await turso.execute(
      "SELECT count(*) as count FROM guild_configs",
    );
    const guildBeforeCount = Number(tursoGuildBefore.rows[0]?.count ?? 0);

    console.log(`  Found ${pgGuildRows.length} rows in PostgreSQL.`);
    console.log(`  Current Turso count: ${guildBeforeCount}`);

    if (isDryRun) {
      console.log(
        `  [DRY-RUN] Would upsert ${pgGuildRows.length} rows into guild_configs.`,
      );
      if (pgGuildRows.length > 0) {
        console.log("  Sample row:", JSON.stringify(pgGuildRows[0]));
      }
    } else {
      for (const row of pgGuildRows) {
        const ignoredDomainsJson = JSON.stringify(
          Array.isArray(row.ignored_domains) ? row.ignored_domains : [],
        );
        await turso.execute({
          sql: `
            INSERT INTO guild_configs (guild_id, auto_shorten_enabled, auto_shorten_min_url_length, ignored_domains, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
              auto_shorten_enabled = excluded.auto_shorten_enabled,
              auto_shorten_min_url_length = excluded.auto_shorten_min_url_length,
              ignored_domains = excluded.ignored_domains,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `,
          args: [
            row.guild_id,
            row.auto_shorten_enabled ? 1 : 0,
            row.auto_shorten_min_url_length ?? null,
            ignoredDomainsJson,
            toUnixTimestamp(row.created_at),
            toUnixTimestamp(row.updated_at),
          ],
        });
      }
    }

    const tursoGuildAfter = isDryRun
      ? guildBeforeCount
      : Number(
          (await turso.execute("SELECT count(*) as count FROM guild_configs"))
            .rows[0]?.count ?? 0,
        );

    summaries.push({
      tableName: "guild_configs",
      sourceCount: pgGuildRows.length,
      targetBeforeCount: guildBeforeCount,
      targetAfterCount: tursoGuildAfter,
      success: isDryRun || tursoGuildAfter >= pgGuildRows.length,
    });

    // ==========================================
    // Table 3: user_configs
    // ==========================================
    console.log("\n📦 Migrating [user_configs]...");
    const pgUserRows = await pg`
      SELECT user_id, auto_dm_mode, dm_format, auto_shorten_min_url_length, ignored_domains, fixupx_enabled, created_at, updated_at
      FROM user_configs
      ORDER BY user_id ASC
    `;
    const tursoUserBefore = await turso.execute(
      "SELECT count(*) as count FROM user_configs",
    );
    const userBeforeCount = Number(tursoUserBefore.rows[0]?.count ?? 0);

    console.log(`  Found ${pgUserRows.length} rows in PostgreSQL.`);
    console.log(`  Current Turso count: ${userBeforeCount}`);

    if (isDryRun) {
      console.log(
        `  [DRY-RUN] Would upsert ${pgUserRows.length} rows into user_configs.`,
      );
      if (pgUserRows.length > 0) {
        console.log("  Sample row:", JSON.stringify(pgUserRows[0]));
      }
    } else {
      for (const row of pgUserRows) {
        const ignoredDomainsJson = JSON.stringify(
          Array.isArray(row.ignored_domains) ? row.ignored_domains : [],
        );
        await turso.execute({
          sql: `
            INSERT INTO user_configs (user_id, auto_dm_mode, dm_format, auto_shorten_min_url_length, ignored_domains, fixupx_enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              auto_dm_mode = excluded.auto_dm_mode,
              dm_format = excluded.dm_format,
              auto_shorten_min_url_length = excluded.auto_shorten_min_url_length,
              ignored_domains = excluded.ignored_domains,
              fixupx_enabled = excluded.fixupx_enabled,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `,
          args: [
            row.user_id,
            row.auto_dm_mode || "inherit",
            row.dm_format || "replace",
            row.auto_shorten_min_url_length ?? null,
            ignoredDomainsJson,
            row.fixupx_enabled ? 1 : 0,
            toUnixTimestamp(row.created_at),
            toUnixTimestamp(row.updated_at),
          ],
        });
      }
    }

    const tursoUserAfter = isDryRun
      ? userBeforeCount
      : Number(
          (await turso.execute("SELECT count(*) as count FROM user_configs"))
            .rows[0]?.count ?? 0,
        );

    summaries.push({
      tableName: "user_configs",
      sourceCount: pgUserRows.length,
      targetBeforeCount: userBeforeCount,
      targetAfterCount: tursoUserAfter,
      success: isDryRun || tursoUserAfter >= pgUserRows.length,
    });

    // ==========================================
    // Summary Report
    // ==========================================
    console.log("\n=================================================");
    console.log("📊 Migration Summary Report");
    console.log("=================================================");
    console.table(
      summaries.map((s) => ({
        Table: s.tableName,
        "PG (Source)": s.sourceCount,
        "Turso Before": s.targetBeforeCount,
        "Turso After": s.targetAfterCount,
        Status: s.success ? (isDryRun ? "DRY RUN OK" : "SUCCESS") : "FAILED",
      })),
    );

    const allSucceeded = summaries.every((s) => s.success);
    if (allSucceeded) {
      console.log(
        `\n✨ Migration ${isDryRun ? "simulation" : "process"} completed successfully!`,
      );
    } else {
      console.error("\n⚠️ Some tables failed verification!");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Migration failed with error:", error);
    process.exit(1);
  } finally {
    await pg.end();
    turso.close();
  }
}

migrate();
