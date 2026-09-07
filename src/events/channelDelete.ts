import type { DMChannel, NonThreadGuildBasedChannel } from "discord.js";
import { watchService } from "@/services/watchService";
import { logger } from "@/utils/logger";

/**
 * Handles the Discord ChannelDelete event.
 * If the deleted channel or category was in the watch list, cleans it up from the DB and cache.
 *
 * @param channel - The deleted channel instance
 */
export async function onChannelDelete(
  channel: DMChannel | NonThreadGuildBasedChannel,
): Promise<void> {
  // Ignore DMs
  if (!("guild" in channel) || !channel.guild) return;

  const guildId = channel.guild.id;
  const channelId = channel.id;

  if (watchService.isWatched(guildId, channelId)) {
    logger.info(
      `Watched channel ${channelId} was deleted in guild ${guildId}. Automatically removing from watch list...`,
    );
    try {
      await watchService.removeWatchChannel(guildId, channelId);
    } catch (error) {
      logger.error(
        `Failed to remove deleted channel ${channelId} from watch list:`,
        error,
      );
    }
  }
}
