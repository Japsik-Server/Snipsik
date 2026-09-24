import type { Client } from "@libsql/client";

// Bump this with each migration that introduces a requirement for new code.
export const REQUIRED_SCHEMA_VERSION = 1;

// Version 1 is the original Turso schema. Existing installations used db:push,
// so its applied version is established by inspecting the actual schema.
const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  watch_channels: ["id", "guild_id", "channel_id", "created_by", "created_at"],
  guild_configs: [
    "guild_id", "auto_shorten_enabled", "auto_shorten_min_url_length",
    "ignored_domains", "version", "created_at", "updated_at",
  ],
  user_configs: [
    "user_id", "auto_dm_mode", "dm_format", "auto_shorten_min_url_length",
    "ignored_domains", "fixupx_enabled", "version", "created_at", "updated_at",
  ],
};

export async function assertSchemaCompatible(client: Pick<Client, "execute">): Promise<void> {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const result = await client.execute({ sql: "SELECT name FROM pragma_table_info(?)", args: [table] });
    const actual = new Set(result.rows.map((row) => String(row.name)));
    const missing = columns.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      throw new Error(`Schema v${REQUIRED_SCHEMA_VERSION} missing ${table}: ${missing.join(", ")}`);
    }
  }
}
