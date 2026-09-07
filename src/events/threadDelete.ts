import type { ThreadChannel } from "discord.js";
import { watchService } from "@/services/watchService";
import { logger } from "@/utils/logger";

/**
 * Handles the Discord ThreadDelete event.
 * If the deleted thread was directly registered in the watch list, cleans it up from the DB and cache.
 *
 * @param thread - The deleted thread instance
 */
export async function onThreadDelete(thread: ThreadChannel): Promise<void> {
  if (!thread.guild) return;

  const guildId = thread.guild.id;
  const threadId = thread.id;

  if (watchService.isWatched(guildId, threadId)) {
    logger.info(
      `Watched thread ${threadId} was deleted in guild ${guildId}. Automatically removing from watch list...`,
    );
    try {
      await watchService.removeWatchChannel(guildId, threadId);
    } catch (error) {
      logger.error(
        `Failed to remove deleted thread ${threadId} from watch list:`,
        error,
      );
    }
  }
}
