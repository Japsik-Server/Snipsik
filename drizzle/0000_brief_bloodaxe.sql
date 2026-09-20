CREATE TABLE `guild_configs` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`auto_shorten_enabled` integer DEFAULT true NOT NULL,
	`auto_shorten_min_url_length` integer,
	`ignored_domains` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "guild_configs_min_url_len_check" CHECK("guild_configs"."auto_shorten_min_url_length" >= 0 AND "guild_configs"."auto_shorten_min_url_length" <= 2048)
);
--> statement-breakpoint
CREATE TABLE `user_configs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`auto_dm_mode` text DEFAULT 'inherit' NOT NULL,
	`dm_format` text DEFAULT 'replace' NOT NULL,
	`auto_shorten_min_url_length` integer,
	`ignored_domains` text DEFAULT '[]' NOT NULL,
	`fixupx_enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "user_configs_min_url_len_check" CHECK("user_configs"."auto_shorten_min_url_length" >= 0 AND "user_configs"."auto_shorten_min_url_length" <= 2048)
);
--> statement-breakpoint
CREATE TABLE `watch_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
