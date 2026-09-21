import { ActivityType, Client, REST, Routes } from "discord.js";
import { config } from "@/config";
import { linkCommand } from "@/commands/link";
import { watchService } from "@/services/watchService";
import { userConfigService } from "@/services/userConfigService";
import { guildConfigService } from "@/services/guildConfigService";
import { testDbConnection } from "@/db";
import { logger } from "@/utils/logger";
import { getAutomaticProcessingReadiness } from "@/services/cacheReadiness";

/**
 * Handles the Discord client ready event.
 * Initializes presence, warms up database caches, and syncs application slash commands.
 *
 * @param client - Ready Discord client instance
 */
export async function onReady(client: Client<true>): Promise<void> {
  logger.success(`Logged in as ${client.user.tag} (ID: ${client.user.id})`);

  // Set activity
  client.user.setPresence({
    activities: [
      {
        name: "/link dashboard",
        type: ActivityType.Watching,
      },
    ],
    status: "online",
  });

  // Initialize each cache independently so a transient DB failure starts recovery.
  await testDbConnection();
  await Promise.allSettled([
    watchService.startCacheRecovery(),
    userConfigService.startCacheRecovery(),
    guildConfigService.startCacheRecovery(),
  ]);
  const readiness = getAutomaticProcessingReadiness();
  logger.info(
    `Automatic processing cache readiness: ${readiness.state} ` +
      `(watch=${readiness.caches.watch.state}, ` +
      `user=${readiness.caches.userConfig.state}, ` +
      `guild=${readiness.caches.guildConfig.state})`,
  );

  // Register Slash Commands
  try {
    logger.info("Registering slash commands with Discord REST API...");
    const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

    const commands = [linkCommand.data.toJSON()];

    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), {
      body: commands,
    });

    logger.success(
      `Successfully registered ${commands.length} application commands globally.`,
    );
  } catch (error) {
    logger.error("Failed to register application commands:", error);
  }
}
