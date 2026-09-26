import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const watchChannels = sqliteTable(
  "watch_channels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("watch_channels_guild_id_channel_id_unique").on(
      table.guildId,
      table.channelId,
    ),
  ],
);

export const guildConfigs = sqliteTable(
  "guild_configs",
  {
    guildId: text("guild_id").primaryKey(),
    autoShortenEnabled: integer("auto_shorten_enabled", { mode: "boolean" })
      .default(true)
      .notNull(),
    autoShortenMinUrlLength: integer("auto_shorten_min_url_length"),
    ignoredDomains: text("ignored_domains", { mode: "json" })
      .$type<string[]>()
      .default([])
      .notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .$onUpdateFn(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "guild_configs_min_url_len_check",
      sql`${table.autoShortenMinUrlLength} >= 0 AND ${table.autoShortenMinUrlLength} <= 2048`,
    ),
  ],
);

export const userConfigs = sqliteTable(
  "user_configs",
  {
    userId: text("user_id").primaryKey(),
    autoDmMode: text("auto_dm_mode").default("inherit").notNull(),
    dmFormat: text("dm_format").default("replace").notNull(),
    autoShortenMinUrlLength: integer("auto_shorten_min_url_length"),
    ignoredDomains: text("ignored_domains", { mode: "json" })
      .$type<string[]>()
      .default([])
      .notNull(),
    fixupxEnabled: integer("fixupx_enabled", { mode: "boolean" })
      .default(true)
      .notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .$onUpdateFn(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "user_configs_min_url_len_check",
      sql`${table.autoShortenMinUrlLength} >= 0 AND ${table.autoShortenMinUrlLength} <= 2048`,
    ),
  ],
);

export type WatchChannel = typeof watchChannels.$inferSelect;
export type NewWatchChannel = typeof watchChannels.$inferInsert;
export type GuildConfig = typeof guildConfigs.$inferSelect;
export type NewGuildConfig = typeof guildConfigs.$inferInsert;
export type UserConfig = typeof userConfigs.$inferSelect;
export type NewUserConfig = typeof userConfigs.$inferInsert;
