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
 * Converts a date value to Unix timestamp in seconds matching Drizzle's mode: 'timestamp'
 * and SQLite's unixepoch() convention.
 * Note: Sub-second precision is intentionally truncated to match the SQLite schema design,
 * as bot audit timestamps do not require microsecond resolution.
 */
function toUnixTimestamp(
  dateValue: unknown,
  columnName: string,
  rowIdentifier: string,
): number {
  if (dateValue instanceof Date) {
    const time = dateValue.getTime();
    if (!Number.isNaN(time)) {
      return Math.floor(time / 1000);
    }
  } else if (typeof dateValue === "string" || typeof dateValue === "number") {
    const parsed = new Date(dateValue).getTime();
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  throw new Error(
    `Invalid or unparseable timestamp value '${String(dateValue)}' for column '${columnName}' in row [${rowIdentifier}]`,
  );
}

/**
 * Executes a set of statements in batches inside a single atomic write transaction.
 * If any batch or extra statement fails, rolls back the entire transaction to prevent partial state.
 */
async function executeTableInTransaction(
  client: ReturnType<typeof createClient>,
  tableName: string,
  statements: InStatement[],
  extraStatements: InStatement[] = [],
): Promise<void> {
  if (statements.length === 0 && extraStatements.length === 0) {
    return;
  }
  console.log(
    `  Executing atomic transaction for [${tableName}] (${statements.length} row statements)...`,
  );
  const tx = await client.transaction("write");
  try {
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      const chunk = statements.slice(i, i + BATCH_SIZE);
      await tx.batch(chunk);
    }
    for (const stmt of extraStatements) {
      await tx.execute(stmt);
    }
    await tx.commit();
    console.log(`  ✓ Successfully committed transaction for [${tableName}].`);
  } catch (error) {
    console.error(
      `  ❌ Transaction failed for [${tableName}], rolling back...`,
      error,
    );
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

    let watchVerified = isDryRun;

    if (isDryRun) {
      console.log(
        `  [DRY-RUN] Would upsert ${pgWatchRows.length} rows into watch_channels.`,
      );
      if (pgWatchRows.length > 0) {
        console.log("  Sample row:", JSON.stringify(pgWatchRows[0]));
      }
    } else {
      const watchStatements: InStatement[] = pgWatchRows.map((row) => ({
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
          toUnixTimestamp(
            row.created_at,
            "created_at",
            `watch_channel:id=${row.id}`,
          ),
        ],
      }));

      // Extra statements: synchronize SQLite AUTOINCREMENT sequence counter atomically with rows
      const sequenceStatements: InStatement[] = [
        {
          sql: `DELETE FROM sqlite_sequence WHERE name = ?`,
          args: ["watch_channels"],
        },
        {
          sql: `
            INSERT INTO sqlite_sequence (name, seq)
            VALUES (?, (SELECT COALESCE(MAX(id), 0) FROM watch_channels))
          `,
          args: ["watch_channels"],
        },
      ];

      await executeTableInTransaction(
        turso,
        "watch_channels",
        watchStatements,
        sequenceStatements,
      );
      console.log("  ✓ Synchronized sqlite_sequence for watch_channels.");

      // Verify that sqlite_sequence was actually updated and equals MAX(id)
      if (pgWatchRows.length > 0) {
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
            `  ✓ Verified sqlite_sequence for watch_channels: seq=${targetSeq} (MAX(id)=${maxId}).`,
          );
        }
      }

      // Strict per-row verification: verify every source ID is present in Turso
      if (pgWatchRows.length > 0) {
        const targetIdsRes = await turso.execute(
          "SELECT id FROM watch_channels",
        );
        const targetIdSet = new Set(targetIdsRes.rows.map((r) => Number(r.id)));
        const missing = pgWatchRows.filter(
          (r) => !targetIdSet.has(Number(r.id)),
        );
        if (missing.length > 0) {
          console.error(
            `  ❌ Verification failed: ${missing.length} watch_channels row(s) missing in Turso! IDs:`,
            missing.map((r) => r.id).slice(0, 10),
          );
          watchVerified = false;
        } else {
          console.log(
            `  ✓ All ${pgWatchRows.length} source watch_channels verified present in Turso.`,
          );
          watchVerified = true;
        }

        // Deep content verification: sample rows and verify field-by-field equality
        if (watchVerified) {
          const sampleRows = pgWatchRows.slice(0, 20);
          const sampleIds = sampleRows.map((r) => r.id);
          const placeholders = sampleIds.map(() => "?").join(",");
          const tursoRowsRes = await turso.execute({
            sql: `SELECT id, guild_id, channel_id, created_by, created_at FROM watch_channels WHERE id IN (${placeholders})`,
            args: sampleIds,
          });
          const tursoRowMap = new Map(
            tursoRowsRes.rows.map((r) => [Number(r.id), r]),
          );

          for (const pgRow of sampleRows) {
            const tursoRow = tursoRowMap.get(Number(pgRow.id));
            const expectedCreatedAt = toUnixTimestamp(
              pgRow.created_at,
              "created_at",
              `watch_channel:id=${pgRow.id}`,
            );
            if (
              !tursoRow ||
              tursoRow.guild_id !== pgRow.guild_id ||
              tursoRow.channel_id !== pgRow.channel_id ||
              tursoRow.created_by !== pgRow.created_by ||
              tursoRow.created_at !== expectedCreatedAt
            ) {
              console.error(
                `  ❌ Content mismatch for watch_channels row id=${pgRow.id}!`,
                { pg: pgRow, turso: tursoRow },
              );
              watchVerified = false;
              break;
            }
          }
          if (watchVerified) {
            console.log(
              `  ✓ Content verification passed (${sampleRows.length} sample rows verified identical).`,
            );
          }
        }
      } else {
        watchVerified = true;
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
      success: watchVerified,
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

    let guildVerified = isDryRun;

    if (isDryRun) {
      console.log(
        `  [DRY-RUN] Would upsert ${pgGuildRows.length} rows into guild_configs.`,
      );
      if (pgGuildRows.length > 0) {
        console.log("  Sample row:", JSON.stringify(pgGuildRows[0]));
      }
    } else {
      const guildStatements: InStatement[] = pgGuildRows.map((row) => {
        const ignoredDomainsJson = JSON.stringify(
          Array.isArray(row.ignored_domains) ? row.ignored_domains : [],
        );
        return {
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
            toUnixTimestamp(
              row.created_at,
              "created_at",
              `guild_config:guild_id=${row.guild_id}`,
            ),
            toUnixTimestamp(
              row.updated_at,
              "updated_at",
              `guild_config:guild_id=${row.guild_id}`,
            ),
          ],
        };
      });

      await executeTableInTransaction(turso, "guild_configs", guildStatements);

      // Strict per-row verification: verify every source guild_id is present in Turso
      if (pgGuildRows.length > 0) {
        const targetKeysRes = await turso.execute(
          "SELECT guild_id FROM guild_configs",
        );
        const targetKeySet = new Set(
          targetKeysRes.rows.map((r) => String(r.guild_id)),
        );
        const missing = pgGuildRows.filter(
          (r) => !targetKeySet.has(String(r.guild_id)),
        );
        if (missing.length > 0) {
          console.error(
            `  ❌ Verification failed: ${missing.length} guild_configs row(s) missing in Turso! IDs:`,
            missing.map((r) => r.guild_id).slice(0, 10),
          );
          guildVerified = false;
        } else {
          console.log(
            `  ✓ All ${pgGuildRows.length} source guild_configs verified present in Turso.`,
          );
          guildVerified = true;
        }

        // Deep content verification: sample rows and verify field-by-field equality
        if (guildVerified) {
          const sampleRows = pgGuildRows.slice(0, 20);
          const sampleIds = sampleRows.map((r) => r.guild_id);
          const placeholders = sampleIds.map(() => "?").join(",");
          const tursoGuildRes = await turso.execute({
            sql: `SELECT guild_id, auto_shorten_enabled, auto_shorten_min_url_length, ignored_domains, created_at, updated_at FROM guild_configs WHERE guild_id IN (${placeholders})`,
            args: sampleIds,
          });
          const tursoGuildMap = new Map(
            tursoGuildRes.rows.map((r) => [String(r.guild_id), r]),
          );

          for (const pgRow of sampleRows) {
            const tursoRow = tursoGuildMap.get(String(pgRow.guild_id));
            const expectedCreatedAt = toUnixTimestamp(
              pgRow.created_at,
              "created_at",
              `guild_config:${pgRow.guild_id}`,
            );
            const expectedUpdatedAt = toUnixTimestamp(
              pgRow.updated_at,
              "updated_at",
              `guild_config:${pgRow.guild_id}`,
            );
            const expectedAutoShorten = pgRow.auto_shorten_enabled ? 1 : 0;
            const expectedIgnored = JSON.stringify(
              Array.isArray(pgRow.ignored_domains) ? pgRow.ignored_domains : [],
            );
            if (
              !tursoRow ||
              tursoRow.auto_shorten_enabled !== expectedAutoShorten ||
              tursoRow.auto_shorten_min_url_length !==
                (pgRow.auto_shorten_min_url_length ?? null) ||
              tursoRow.ignored_domains !== expectedIgnored ||
              tursoRow.created_at !== expectedCreatedAt ||
              tursoRow.updated_at !== expectedUpdatedAt
            ) {
              console.error(
                `  ❌ Content mismatch for guild_configs guild_id=${pgRow.guild_id}!`,
                { pg: pgRow, turso: tursoRow },
              );
              guildVerified = false;
              break;
            }
          }
          if (guildVerified) {
            console.log(
              `  ✓ Content verification passed (${sampleRows.length} sample rows verified identical).`,
            );
          }
        }
      } else {
        guildVerified = true;
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
      success: guildVerified,
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

    let userVerified = isDryRun;

    if (isDryRun) {
      console.log(
        `  [DRY-RUN] Would upsert ${pgUserRows.length} rows into user_configs.`,
      );
      if (pgUserRows.length > 0) {
        console.log("  Sample row:", JSON.stringify(pgUserRows[0]));
      }
    } else {
      const userStatements: InStatement[] = pgUserRows.map((row) => {
        const ignoredDomainsJson = JSON.stringify(
          Array.isArray(row.ignored_domains) ? row.ignored_domains : [],
        );
        return {
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
            row.auto_dm_mode ?? "inherit",
            row.dm_format ?? "replace",
            row.auto_shorten_min_url_length ?? null,
            ignoredDomainsJson,
            row.fixupx_enabled ? 1 : 0,
            toUnixTimestamp(
              row.created_at,
              "created_at",
              `user_config:user_id=${row.user_id}`,
            ),
            toUnixTimestamp(
              row.updated_at,
              "updated_at",
              `user_config:user_id=${row.user_id}`,
            ),
          ],
        };
      });

      await executeTableInTransaction(turso, "user_configs", userStatements);

      // Strict per-row verification: verify every source user_id is present in Turso
      if (pgUserRows.length > 0) {
        const targetKeysRes = await turso.execute(
          "SELECT user_id FROM user_configs",
        );
        const targetKeySet = new Set(
          targetKeysRes.rows.map((r) => String(r.user_id)),
        );
        const missing = pgUserRows.filter(
          (r) => !targetKeySet.has(String(r.user_id)),
        );
        if (missing.length > 0) {
          console.error(
            `  ❌ Verification failed: ${missing.length} user_configs row(s) missing in Turso! IDs:`,
            missing.map((r) => r.user_id).slice(0, 10),
          );
          userVerified = false;
        } else {
          console.log(
            `  ✓ All ${pgUserRows.length} source user_configs verified present in Turso.`,
          );
          userVerified = true;
        }

        // Deep content verification: sample rows and verify field-by-field equality
        if (userVerified) {
          const sampleRows = pgUserRows.slice(0, 20);
          const sampleIds = sampleRows.map((r) => r.user_id);
          const placeholders = sampleIds.map(() => "?").join(",");
          const tursoUserRes = await turso.execute({
            sql: `SELECT user_id, auto_dm_mode, dm_format, auto_shorten_min_url_length, ignored_domains, fixupx_enabled, created_at, updated_at FROM user_configs WHERE user_id IN (${placeholders})`,
            args: sampleIds,
          });
          const tursoUserMap = new Map(
            tursoUserRes.rows.map((r) => [String(r.user_id), r]),
          );

          for (const pgRow of sampleRows) {
            const tursoRow = tursoUserMap.get(String(pgRow.user_id));
            const expectedCreatedAt = toUnixTimestamp(
              pgRow.created_at,
              "created_at",
              `user_config:${pgRow.user_id}`,
            );
            const expectedUpdatedAt = toUnixTimestamp(
              pgRow.updated_at,
              "updated_at",
              `user_config:${pgRow.user_id}`,
            );
            const expectedFixupx = pgRow.fixupx_enabled ? 1 : 0;
            const expectedIgnored = JSON.stringify(
              Array.isArray(pgRow.ignored_domains) ? pgRow.ignored_domains : [],
            );
            if (
              !tursoRow ||
              tursoRow.auto_dm_mode !== (pgRow.auto_dm_mode ?? "inherit") ||
              tursoRow.dm_format !== (pgRow.dm_format ?? "replace") ||
              tursoRow.auto_shorten_min_url_length !==
                (pgRow.auto_shorten_min_url_length ?? null) ||
              tursoRow.fixupx_enabled !== expectedFixupx ||
              tursoRow.ignored_domains !== expectedIgnored ||
              tursoRow.created_at !== expectedCreatedAt ||
              tursoRow.updated_at !== expectedUpdatedAt
            ) {
              console.error(
                `  ❌ Content mismatch for user_configs user_id=${pgRow.user_id}!`,
                { pg: pgRow, turso: tursoRow },
              );
              userVerified = false;
              break;
            }
          }
          if (userVerified) {
            console.log(
              `  ✓ Content verification passed (${sampleRows.length} sample rows verified identical).`,
            );
          }
        }
      } else {
        userVerified = true;
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
