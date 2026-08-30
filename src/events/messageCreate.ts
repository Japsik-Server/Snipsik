import { Message } from "discord.js";
import { config } from "@/config";
import { watchService } from "@/services/watchService";
import { generateSlug } from "@/services/slugManager";
import { sinkClient } from "@/services/sinkClient";
import { ui } from "@/utils/ui";
import { logger } from "@/utils/logger";

// URL extraction regex
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

export async function onMessageCreate(message: Message): Promise<void> {
  // Ignore bot messages and webhooks
  if (message.author.bot || message.webhookId) return;

  // Only check guild messages
  if (!message.guildId || !message.guild) return;

  // Fast O(1) in-memory check if the channel is watched
  if (!watchService.isWatched(message.guildId, message.channelId)) {
    return;
  }

  const content = message.content;
  if (!content) return;

  const matches = content.match(URL_REGEX);
  if (!matches || matches.length === 0) return;

  const sinkHostname = new URL(config.SINK_BASE_URL).hostname.toLowerCase();

  // 1. Extract valid URLs in order of appearance (deduplicating identical URLs while preserving order)
  const seenUrls = new Set<string>();
  const validUrls: string[] = [];

  for (const rawUrl of matches) {
    try {
      const parsedUrl = new URL(rawUrl);

      // Skip if URL is already pointing to our Sink instance (prevent loop)
      if (parsedUrl.hostname.toLowerCase() === sinkHostname) {
        continue;
      }

      // Skip very short URLs (e.g. less than 15 chars) to avoid unnecessary shortening
      if (rawUrl.length < 15) {
        continue;
      }

      if (!seenUrls.has(rawUrl)) {
        seenUrls.add(rawUrl);
        validUrls.push(rawUrl);
      }
    } catch {
      // Ignore malformed URLs
    }
  }

  if (validUrls.length === 0) return;

  logger.info(
    `Watched channel detected ${validUrls.length} URL(s) from user ${message.author.tag} in #${(message.channel as { name?: string }).name || message.channelId}`,
  );

  // 2. Shorten URLs sequentially to strictly guarantee order
  const shortenedItems: Array<{
    originalUrl: string;
    shortenedUrl: string;
    slug: string;
  }> = [];

  for (const originalUrl of validUrls) {
    try {
      const slug = generateSlug(message.author.id);
      const res = await sinkClient.createLink({
        url: originalUrl,
        slug,
      });

      if (res.success && res.link) {
        const shortenedUrl = sinkClient.getFullShortUrl(slug);
        shortenedItems.push({
          originalUrl,
          shortenedUrl,
          slug,
        });
      } else {
        logger.warn(
          `Failed to auto-shorten URL for ${message.author.tag}: ${res.error}`,
        );
      }
    } catch (err) {
      logger.error(`Error auto-shortening URL ${originalUrl}:`, err);
    }
  }

  if (shortenedItems.length === 0) return;

  try {
    const messageUrl = message.url;

    // 1. Send DM Card (Components v2 UI)
    const dmEmbed = ui.createWatchDmCard(shortenedItems, messageUrl);

    const dmChannel = await message.author.createDM();
    await dmChannel.send({ embeds: [dmEmbed] });

    // 2. Send Pure Plain Text URLs sequentially (Mobile Long-press copy optimization)
    for (const item of shortenedItems) {
      await dmChannel.send(item.shortenedUrl);
    }

    logger.success(
      `Successfully sent ${shortenedItems.length} auto-shortened link(s) DM to ${message.author.tag}`,
    );
  } catch (err) {
    logger.error(
      `Failed to send auto-shorten DM to ${message.author.tag}:`,
      err,
    );
  }
}
