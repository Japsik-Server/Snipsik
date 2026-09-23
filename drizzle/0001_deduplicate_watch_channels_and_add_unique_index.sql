DELETE FROM `watch_channels`
WHERE `id` NOT IN (
	SELECT MIN(`id`)
	FROM `watch_channels`
	GROUP BY `guild_id`, `channel_id`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_channels_guild_id_channel_id_unique` ON `watch_channels` (`guild_id`,`channel_id`);
