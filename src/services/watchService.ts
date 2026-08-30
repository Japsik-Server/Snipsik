import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { watchChannels, type WatchChannel } from "@/db/schema";
import { logger } from "@/utils/logger";

class WatchService {
  // In-memory cache formatted as "guildId:channelId"
  private watchedChannelKeys: Set<string> = new Set();

  private getKey(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
  }

  /**
   * Initializes and populates the in-memory cache from database.
   */
  async loadCache(): Promise<void> {
    try {
      const records = await db.select().from(watchChannels);
      this.watchedChannelKeys.clear();
      for (const record of records) {
        this.watchedChannelKeys.add(this.getKey(record.guildId, record.channelId));
      }
      logger.info(`Loaded ${records.length} watched channels into cache.`);
    } catch (error) {
      logger.error("Failed to load watched channels cache from DB:", error);
    }
  }

  /**
   * Checks whether a channel in a guild is being watched.
   */
  isWatched(guildId: string, channelId: string): boolean {
    return this.watchedChannelKeys.has(this.getKey(guildId, channelId));
  }

  /**
   * Adds a channel to the watch list.
   */
  async addWatchChannel(
    guildId: string,
    channelId: string,
    createdBy: string
  ): Promise<{ success: boolean; error?: string; channel?: WatchChannel }> {
    if (this.isWatched(guildId, channelId)) {
      return { success: false, error: "This channel is already being watched." };
    }

    try {
      const [inserted] = await db
        .insert(watchChannels)
        .values({
          guildId,
          channelId,
          createdBy,
        })
        .returning();

      if (inserted) {
        this.watchedChannelKeys.add(this.getKey(guildId, channelId));
        logger.info(`Added watched channel ${channelId} in guild ${guildId}`);
        return { success: true, channel: inserted };
      }

      return { success: false, error: "Failed to insert record into database." };
    } catch (error) {
      logger.error("Database error while adding watch channel:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Database error",
      };
    }
  }

  /**
   * Removes a channel from the watch list.
   */
  async removeWatchChannel(
    guildId: string,
    channelId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.isWatched(guildId, channelId)) {
      return { success: false, error: "This channel is not currently being watched." };
    }

    try {
      await db
        .delete(watchChannels)
        .where(
          and(eq(watchChannels.guildId, guildId), eq(watchChannels.channelId, channelId))
        );

      this.watchedChannelKeys.delete(this.getKey(guildId, channelId));
      logger.info(`Removed watched channel ${channelId} in guild ${guildId}`);
      return { success: true };
    } catch (error) {
      logger.error("Database error while removing watch channel:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Database error",
      };
    }
  }

  /**
   * Lists all watched channels for a specific guild.
   */
  async getWatchedChannels(guildId: string): Promise<WatchChannel[]> {
    try {
      return await db
        .select()
        .from(watchChannels)
        .where(eq(watchChannels.guildId, guildId));
    } catch (error) {
      logger.error(`Failed to get watched channels for guild ${guildId}:`, error);
      return [];
    }
  }
}

export const watchService = new WatchService();
