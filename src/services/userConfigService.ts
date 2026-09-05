import { db } from "@/db";
import { userConfigs } from "@/db/schema";
import { logger } from "@/utils/logger";

export type AutoDmMode = "inherit" | "on" | "off";
export type DmFormat = "replace" | "list";

export interface UserConfigData {
  userId?: string;
  autoDmMode: AutoDmMode;
  dmFormat: DmFormat;
}

export const DEFAULT_USER_CONFIG: Readonly<UserConfigData> = {
  autoDmMode: "inherit",
  dmFormat: "replace",
};

export function normalizeAutoDmMode(value: unknown): AutoDmMode | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (lower === "inherit" || lower === "default") return "inherit";
  if (
    lower === "on" ||
    lower === "true" ||
    lower === "enable" ||
    lower === "enabled"
  )
    return "on";
  if (
    lower === "off" ||
    lower === "false" ||
    lower === "disable" ||
    lower === "disabled"
  )
    return "off";
  return null;
}

export function normalizeDmFormat(value: unknown): DmFormat | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (lower === "replace" || lower === "message") return "replace";
  if (lower === "list" || lower === "urls") return "list";
  return null;
}

class UserConfigService {
  // In-memory cache for O(1) sync lookups in messageCreate
  private cache: Map<string, UserConfigData> = new Map();

  /**
   * Loads all user configs into memory on bot startup.
   */
  async loadCache(): Promise<void> {
    try {
      const records = await db.select().from(userConfigs);
      this.cache.clear();
      for (const record of records) {
        const autoDmMode = normalizeAutoDmMode(record.autoDmMode) ?? "inherit";
        const dmFormat = normalizeDmFormat(record.dmFormat) ?? "replace";
        this.cache.set(record.userId, {
          userId: record.userId,
          autoDmMode,
          dmFormat,
        });
      }
      logger.info(`Loaded ${records.length} user config(s) into memory cache.`);
    } catch (error) {
      logger.error("Failed to load user configs cache from DB:", error);
    }
  }

  /**
   * Returns the current config for a user (from memory cache or default).
   */
  getUserConfig(userId: string): UserConfigData {
    const cached = this.cache.get(userId);
    if (cached) {
      return { ...cached };
    }
    return {
      userId,
      ...DEFAULT_USER_CONFIG,
    };
  }

  /**
   * Updates or creates a user config in both DB and memory cache.
   */
  async setUserConfig(
    userId: string,
    updates: Partial<Pick<UserConfigData, "autoDmMode" | "dmFormat">>,
  ): Promise<{ success: boolean; error?: string; config: UserConfigData }> {
    const current = this.getUserConfig(userId);

    const nextAutoDmMode =
      updates.autoDmMode !== undefined
        ? (normalizeAutoDmMode(updates.autoDmMode) ?? current.autoDmMode)
        : current.autoDmMode;

    const nextDmFormat =
      updates.dmFormat !== undefined
        ? (normalizeDmFormat(updates.dmFormat) ?? current.dmFormat)
        : current.dmFormat;

    const nextConfig: UserConfigData = {
      userId,
      autoDmMode: nextAutoDmMode,
      dmFormat: nextDmFormat,
    };

    try {
      await db
        .insert(userConfigs)
        .values({
          userId,
          autoDmMode: nextAutoDmMode,
          dmFormat: nextDmFormat,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userConfigs.userId,
          set: {
            autoDmMode: nextAutoDmMode,
            dmFormat: nextDmFormat,
            updatedAt: new Date(),
          },
        });

      this.cache.set(userId, nextConfig);
      logger.info(
        `Updated user config for ${userId}: autoDmMode=${nextAutoDmMode}, dmFormat=${nextDmFormat}`,
      );
      return { success: true, config: nextConfig };
    } catch (error) {
      logger.error(`Failed to update user config for ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Database error",
        config: current,
      };
    }
  }

  /**
   * Determines whether the bot should auto-shorten URLs and send DM to the user.
   */
  shouldProcessUser(userId: string, isChannelWatched: boolean): boolean {
    const cfg = this.getUserConfig(userId);
    if (cfg.autoDmMode === "off") return false;
    if (cfg.autoDmMode === "on") return true;
    return isChannelWatched;
  }

  /**
   * Replaces original URLs with shortened URLs in the original message content.
   * Sorts URLs by descending length (longest first) to prevent substring collision.
   */
  replaceUrlsInText(
    content: string,
    replacements: Array<{ originalUrl: string; shortenedUrl: string }>,
  ): string {
    if (!content || replacements.length === 0) return content;

    // Deduplicate replacements by originalUrl
    const map = new Map<string, string>();
    for (const r of replacements) {
      if (!map.has(r.originalUrl)) {
        map.set(r.originalUrl, r.shortenedUrl);
      }
    }

    // Sort by descending URL length
    const sorted = Array.from(map.entries()).sort(
      ([urlA], [urlB]) => urlB.length - urlA.length,
    );

    let result = content;
    for (const [origUrl, shortUrl] of sorted) {
      result = result.split(origUrl).join(shortUrl);
    }

    return result;
  }

  /**
   * Splits text into safe chunks under Discord's 2,000 character limit.
   */
  chunkText(text: string, maxLength = 2000): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to break at a newline or space
      let splitIndex = remaining.lastIndexOf("\n", maxLength);
      if (splitIndex <= 0) {
        splitIndex = remaining.lastIndexOf(" ", maxLength);
      }
      if (splitIndex <= 0) {
        splitIndex = maxLength;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).replace(/^\n+/, "");
    }

    return chunks;
  }
}

export const userConfigService = new UserConfigService();
