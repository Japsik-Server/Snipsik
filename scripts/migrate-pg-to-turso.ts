import { createClient, type InStatement } from "@libsql/client";
import postgres from "postgres";

interface MigrationSummary {
  tableName: string;
  sourceCount: number;
  targetBeforeCount: number;
  targetAfterCount: number;
  success: boolean;
}

const BATCH_SIZE = 100;

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isForce = args.includes("--force");

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

function maskUrlCredentials(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = "****";
    }
    if (parsed.username) {
      parsed.username = "****";
    }
    return parsed.toString();
  } catch {
    return "[URL with masked credentials]";
  }
}

console.log(`Source PG URL:   ${maskUrlCredentials(sourcePgUrl)}`);
console.log(`Target Turso URL: ${maskUrlCredentials(targetTursoUrl)}`);
console.log(
  `Auth Token:      ${targetTursoToken ? "Provided (masked)" : "None (e.g. local file or dev)"}`,
);
console.log("-------------------------------------------------");

const pg = postgres(sourcePgUrl, { max: 1 });
const turso = createClient({
  url: targetTursoUrl,
  authToken: targetTursoToken,
});

/**
 * Converts a date value to Unix timestamp in milliseconds matching Drizzle's mode: 'timestamp_ms'
 * and JavaScript Date.getTime() convention, preserving full millisecond accuracy from PostgreSQL.
 */
function toTimestampMs(
  dateValue: unknown,
  columnName: string,
  rowIdentifier: string,
): number {
  if (dateValue instanceof Date) {
    const time = dateValue.getTime();
    if (!Number.isNaN(time)) {
      return time;
    }
  } else if (typeof dateValue === "string" || typeof dateValue === "number") {
    const parsed = new Date(dateValue).getTime();
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  throw new Error(
    `Invalid or unparseable timestamp value '${String(dateValue)}' for column '${columnName}' in row [${rowIdentifier}]`,
  );
}

async function executeInTransaction(
  client: ReturnType<typeof createClient>,
  statements: InStatement[],
): Promise<void> {
  if (statements.length === 0) return;
  const tx = await client.transaction("write");
  try {
    await tx.batch(statements);
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
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

    // Helper to query table count with helpful schema-missing detection
    async function getTargetTableCount(tableName: string): Promise<number> {
      try {
        const res = await turso.execute(
          `SELECT count(*) as c FROM ${tableName}`,
        );
        return Number(res.rows[0]?.c ?? 0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("no such table") || msg.includes("SQLITE_ERROR")) {
          console.error(
            `\n❌ Error: Target table '${tableName}' does not exist in the Turso database.`,
          );
          console.error(
            "Please apply the database schema before running the migration:",
          );
          console.error("  bun run db:push\n");
          process.exit(1);
        }
        throw err;
      }
    }

    // Pre-flight safety check: prevent accidental clobbering of post-cutover Turso data
    const preflightCounts = {
      watchChannels: await getTargetTableCount("watch_channels"),
      guildConfigs: await getTargetTableCount("guild_configs"),
      userConfigs: await getTargetTableCount("user_configs"),
    };
    const hasExistingData =
      preflightCounts.watchChannels > 0 ||
      preflightCounts.guildConfigs > 0 ||
      preflightCounts.userConfigs > 0;

    if (!isDryRun && hasExistingData && !isForce) {
      console.error(
        "\n⚠️  SAFETY ABORT: Target Turso database already contains existing data!",
      );
      console.error(
        `   - watch_channels: ${preflightCounts.watchChannels} row(s)`,
      );
      console.error(
        `   - guild_configs:  ${preflightCounts.guildConfigs} row(s)`,
      );
      console.error(
        `   - user_configs:   ${preflightCounts.userConfigs} row(s)`,
      );
      console.error(
        "\nTo prevent accidental data loss or clobbering post-cutover changes, live migration is halted.",
      );
      console.error(
        "If you intentionally want to overwrite existing target rows, re-run with --force:",
      );
      console.error("  bun run db:transfer --force\n");
      process.exit(1);
    }

    // ==========================================
    // Table 1: watch_channels (Streaming Migration)
    // ==========================================
    console.log("📦 Migrating [watch_channels]...");
    const [totalWatchSourceRes] =
      await pg`SELECT count(*)::int as count FROM watch_channels`;
    const totalWatchSource = Number(totalWatchSourceRes?.count ?? 0);
    const watchBeforeCount = preflightCounts.watchChannels;
    console.log(`  Found ${totalWatchSource} rows in PostgreSQL.`);
    console.log(`  Current Turso count: ${watchBeforeCount}`);

    let watchVerified = true;
    let lastWatchId = 0;
    let processedWatchRows = 0;

    while (true) {
      const chunk = await pg`
        SELECT id, guild_id, channel_id, created_by, created_at
        FROM watch_channels
        WHERE id > ${lastWatchId}
        ORDER BY id ASC
        LIMIT ${BATCH_SIZE}
      `;

      if (chunk.length === 0) break;

      // Validate data conversions for every row in the chunk
      for (const row of chunk) {
        toTimestampMs(
          row.created_at,
          "created_at",
          `watch_channel:id=${row.id}`,
        );
      }

      if (!isDryRun) {
        const statements: InStatement[] = chunk.map((row) => ({
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
            toTimestampMs(
              row.created_at,
              "created_at",
              `watch_channel:id=${row.id}`,
            ),
          ],
        }));

        await executeInTransaction(turso, statements);

        // 100% full-content verification for this chunk
        const chunkIds = chunk.map((r) => r.id);
        const placeholders = chunkIds.map(() => "?").join(",");
        const targetChunkRes = await turso.execute({
          sql: `SELECT id, guild_id, channel_id, created_by, created_at FROM watch_channels WHERE id IN (${placeholders})`,
          args: chunkIds,
        });
        const targetMap = new Map(
          targetChunkRes.rows.map((r) => [Number(r.id), r]),
        );

        for (const sourceRow of chunk) {
          const targetRow = targetMap.get(Number(sourceRow.id));
          const expectedCreated = toTimestampMs(
            sourceRow.created_at,
            "created_at",
            `watch_channel:id=${sourceRow.id}`,
          );
          if (
            !targetRow ||
            targetRow.guild_id !== sourceRow.guild_id ||
            targetRow.channel_id !== sourceRow.channel_id ||
            targetRow.created_by !== sourceRow.created_by ||
            targetRow.created_at !== expectedCreated
          ) {
            console.error(
              `  ❌ Content verification failed for watch_channels id=${sourceRow.id}:`,
              { source: sourceRow, target: targetRow },
            );
            watchVerified = false;
            break;
          }
        }
      }

      lastWatchId = chunk[chunk.length - 1].id;
      processedWatchRows += chunk.length;
      process.stdout.write(
        `\r  Progress: ${processedWatchRows}/${totalWatchSource} rows (${Math.round((processedWatchRows / (totalWatchSource || 1)) * 100)}%)`,
      );
    }
    console.log();

    if (!isDryRun && totalWatchSource > 0) {
      // Synchronize SQLite AUTOINCREMENT sequence counter
      await turso.execute({
        sql: `DELETE FROM sqlite_sequence WHERE name = ?`,
        args: ["watch_channels"],
      });
      await turso.execute({
        sql: `
          INSERT INTO sqlite_sequence (name, seq)
          VALUES (?, (SELECT COALESCE(MAX(id), 0) FROM watch_channels))
        `,
        args: ["watch_channels"],
      });

      const seqCheckRes = await turso.execute({
        sql: `SELECT seq FROM sqlite_sequence WHERE name = ?`,
        args: ["watch_channels"],
      });
      const targetSeq = Number(seqCheckRes.rows[0]?.seq ?? 0);
      const maxIdRes = await turso.execute(
        "SELECT COALESCE(MAX(id), 0) as max_id FROM watch_channels",
      );
      const maxId = Number(maxIdRes.rows[0]?.max_id ?? 0);
      if (targetSeq < maxId) {
        console.error(
          `  ❌ sqlite_sequence verification failed: seq=${targetSeq} is less than MAX(id)=${maxId}!`,
        );
        watchVerified = false;
      } else {
        console.log(
          `  ✓ Synchronized and verified sqlite_sequence for watch_channels: seq=${targetSeq} (MAX(id)=${maxId}).`,
        );
      }
    }

    const tursoWatchAfter = isDryRun
      ? watchBeforeCount
      : await getTargetTableCount("watch_channels");

    summaries.push({
      tableName: "watch_channels",
      sourceCount: totalWatchSource,
      targetBeforeCount: watchBeforeCount,
      targetAfterCount: tursoWatchAfter,
      success: watchVerified,
    });

    // ==========================================
    // Table 2: guild_configs (Streaming Migration)
    // ==========================================
    console.log("\n📦 Migrating [guild_configs]...");
    const [totalGuildSourceRes] =
      await pg`SELECT count(*)::int as count FROM guild_configs`;
    const totalGuildSource = Number(totalGuildSourceRes?.count ?? 0);
    const guildBeforeCount = preflightCounts.guildConfigs;
    console.log(`  Found ${totalGuildSource} rows in PostgreSQL.`);
    console.log(`  Current Turso count: ${guildBeforeCount}`);

    let guildVerified = true;
    let lastGuildId = "";
    let processedGuildRows = 0;

    while (true) {
      const chunk =
        lastGuildId === ""
          ? await pg`
              SELECT guild_id, auto_shorten_enabled, auto_shorten_min_url_length, ignored_domains, created_at, updated_at
              FROM guild_configs
              ORDER BY guild_id ASC
              LIMIT ${BATCH_SIZE}
            `
          : await pg`
              SELECT guild_id, auto_shorten_enabled, auto_shorten_min_url_length, ignored_domains, created_at, updated_at
              FROM guild_configs
              WHERE guild_id > ${lastGuildId}
              ORDER BY guild_id ASC
              LIMIT ${BATCH_SIZE}
            `;

      if (chunk.length === 0) break;

      // Validate data conversions for every row in chunk
      for (const row of chunk) {
        toTimestampMs(
          row.created_at,
          "created_at",
          `guild_config:${row.guild_id}`,
        );
        toTimestampMs(
          row.updated_at,
          "updated_at",
          `guild_config:${row.guild_id}`,
        );
        JSON.stringify(
          Array.isArray(row.ignored_domains) ? row.ignored_domains : [],
        );
      }

      if (!isDryRun) {
        const statements: InStatement[] = chunk.map((row) => ({
          sql: `
            INSERT INTO guild_configs (guild_id, auto_shorten_enabled, auto_shorten_min_url_length, ignored_domains, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
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
            JSON.stringify(
              Array.isArray(row.ignored_domains) ? row.ignored_domains : [],
            ),
            toTimestampMs(
              row.created_at,
              "created_at",
              `guild_config:${row.guild_id}`,
            ),
            toTimestampMs(
              row.updated_at,
              "updated_at",
              `guild_config:${row.guild_id}`,
            ),
          ],
        }));

        await executeInTransaction(turso, statements);

        // 100% full-content verification for this chunk
        const chunkIds = chunk.map((r) => r.guild_id);
        const placeholders = chunkIds.map(() => "?").join(",");
        const targetChunkRes = await turso.execute({
          sql: `SELECT guild_id, auto_shorten_enabled, auto_shorten_min_url_length, ignored_domains, created_at, updated_at FROM guild_configs WHERE guild_id IN (${placeholders})`,
          args: chunkIds,
        });
        const targetMap = new Map(
          targetChunkRes.rows.map((r) => [String(r.guild_id), r]),
        );

        for (const sourceRow of chunk) {
          const targetRow = targetMap.get(String(sourceRow.guild_id));
          const expectedCreated = toTimestampMs(
            sourceRow.created_at,
            "created_at",
            `guild_config:${sourceRow.guild_id}`,
          );
          const expectedUpdated = toTimestampMs(
            sourceRow.updated_at,
            "updated_at",
            `guild_config:${sourceRow.guild_id}`,
          );
          const expectedAuto = sourceRow.auto_shorten_enabled ? 1 : 0;
          const expectedDomains = JSON.stringify(
            Array.isArray(sourceRow.ignored_domains)
              ? sourceRow.ignored_domains
              : [],
          );

          if (
            !targetRow ||
            targetRow.auto_shorten_enabled !== expectedAuto ||
            targetRow.auto_shorten_min_url_length !==
              (sourceRow.auto_shorten_min_url_length ?? null) ||
            targetRow.ignored_domains !== expectedDomains ||
            targetRow.created_at !== expectedCreated ||
            targetRow.updated_at !== expectedUpdated
          ) {
            console.error(
              `  ❌ Content verification failed for guild_configs guild_id=${sourceRow.guild_id}:`,
              { source: sourceRow, target: targetRow },
            );
            guildVerified = false;
            break;
          }
        }
      }

      lastGuildId = chunk[chunk.length - 1].guild_id;
      processedGuildRows += chunk.length;
      process.stdout.write(
        `\r  Progress: ${processedGuildRows}/${totalGuildSource} rows (${Math.round((processedGuildRows / (totalGuildSource || 1)) * 100)}%)`,
      );
    }
    console.log();

    const tursoGuildAfter = isDryRun
      ? guildBeforeCount
      : await getTargetTableCount("guild_configs");

    summaries.push({
      tableName: "guild_configs",
      sourceCount: totalGuildSource,
      targetBeforeCount: guildBeforeCount,
      targetAfterCount: tursoGuildAfter,
      success: guildVerified,
    });

    // ==========================================
    // Table 3: user_configs (Streaming Migration)
    // ==========================================
    console.log("\n📦 Migrating [user_configs]...");
    const [totalUserSourceRes] =
      await pg`SELECT count(*)::int as count FROM user_configs`;
    const totalUserSource = Number(totalUserSourceRes?.count ?? 0);
    const userBeforeCount = preflightCounts.userConfigs;
    console.log(`  Found ${totalUserSource} rows in PostgreSQL.`);
    console.log(`  Current Turso count: ${userBeforeCount}`);

    let userVerified = true;
    let lastUserId = "";
    let processedUserRows = 0;

    while (true) {
      const chunk =
        lastUserId === ""
          ? await pg`
              SELECT user_id, auto_dm_mode, dm_format, auto_shorten_min_url_length, ignored_domains, fixupx_enabled, created_at, updated_at
              FROM user_configs
              ORDER BY user_id ASC
              LIMIT ${BATCH_SIZE}
            `
          : await pg`
              SELECT user_id, auto_dm_mode, dm_format, auto_shorten_min_url_length, ignored_domains, fixupx_enabled, created_at, updated_at
              FROM user_configs
              WHERE user_id > ${lastUserId}
              ORDER BY user_id ASC
              LIMIT ${BATCH_SIZE}
            `;

      if (chunk.length === 0) break;

      // Validate data conversions for every row in chunk
      for (const row of chunk) {
        toTimestampMs(
          row.created_at,
          "created_at",
          `user_config:${row.user_id}`,
        );
        toTimestampMs(
          row.updated_at,
          "updated_at",
          `user_config:${row.user_id}`,
        );
        JSON.stringify(
          Array.isArray(row.ignored_domains) ? row.ignored_domains : [],
        );
      }

      if (!isDryRun) {
        const statements: InStatement[] = chunk.map((row) => ({
          sql: `
            INSERT INTO user_configs (user_id, auto_dm_mode, dm_format, auto_shorten_min_url_length, ignored_domains, fixupx_enabled, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
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
            row.auto_dm_mode ?? "inherit",
            row.dm_format ?? "replace",
            row.auto_shorten_min_url_length ?? null,
            JSON.stringify(
              Array.isArray(row.ignored_domains) ? row.ignored_domains : [],
            ),
            row.fixupx_enabled ? 1 : 0,
            toTimestampMs(
              row.created_at,
              "created_at",
              `user_config:${row.user_id}`,
            ),
            toTimestampMs(
              row.updated_at,
              "updated_at",
              `user_config:${row.user_id}`,
            ),
          ],
        }));

        await executeInTransaction(turso, statements);

        // 100% full-content verification for this chunk
        const chunkIds = chunk.map((r) => r.user_id);
        const placeholders = chunkIds.map(() => "?").join(",");
        const targetChunkRes = await turso.execute({
          sql: `SELECT user_id, auto_dm_mode, dm_format, auto_shorten_min_url_length, ignored_domains, fixupx_enabled, created_at, updated_at FROM user_configs WHERE user_id IN (${placeholders})`,
          args: chunkIds,
        });
        const targetMap = new Map(
          targetChunkRes.rows.map((r) => [String(r.user_id), r]),
        );

        for (const sourceRow of chunk) {
          const targetRow = targetMap.get(String(sourceRow.user_id));
          const expectedCreated = toTimestampMs(
            sourceRow.created_at,
            "created_at",
            `user_config:${sourceRow.user_id}`,
          );
          const expectedUpdated = toTimestampMs(
            sourceRow.updated_at,
            "updated_at",
            `user_config:${sourceRow.user_id}`,
          );
          const expectedFixupx = sourceRow.fixupx_enabled ? 1 : 0;
          const expectedDomains = JSON.stringify(
            Array.isArray(sourceRow.ignored_domains)
              ? sourceRow.ignored_domains
              : [],
          );

          if (
            !targetRow ||
            targetRow.auto_dm_mode !== (sourceRow.auto_dm_mode ?? "inherit") ||
            targetRow.dm_format !== (sourceRow.dm_format ?? "replace") ||
            targetRow.auto_shorten_min_url_length !==
              (sourceRow.auto_shorten_min_url_length ?? null) ||
            targetRow.fixupx_enabled !== expectedFixupx ||
            targetRow.ignored_domains !== expectedDomains ||
            targetRow.created_at !== expectedCreated ||
            targetRow.updated_at !== expectedUpdated
          ) {
            console.error(
              `  ❌ Content verification failed for user_configs user_id=${sourceRow.user_id}:`,
              { source: sourceRow, target: targetRow },
            );
            userVerified = false;
            break;
          }
        }
      }

      lastUserId = chunk[chunk.length - 1].user_id;
      processedUserRows += chunk.length;
      process.stdout.write(
        `\r  Progress: ${processedUserRows}/${totalUserSource} rows (${Math.round((processedUserRows / (totalUserSource || 1)) * 100)}%)`,
      );
    }
    console.log();

    const tursoUserAfter = isDryRun
      ? userBeforeCount
      : await getTargetTableCount("user_configs");

    summaries.push({
      tableName: "user_configs",
      sourceCount: totalUserSource,
      targetBeforeCount: userBeforeCount,
      targetAfterCount: tursoUserAfter,
      success: userVerified,
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
