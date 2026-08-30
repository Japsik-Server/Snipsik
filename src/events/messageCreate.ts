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

  // Process the first detected long URL
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

      logger.info(
        `Watched channel URL detected from user ${message.author.tag} in #${(message.channel as { name?: string }).name || message.channelId}: ${rawUrl}`
      );

      // Generate slug with user hash
      const slug = generateSlug(message.author.id);

      // Create link in Sink
      const res = await sinkClient.createLink({
        url: rawUrl,
        slug,
      });

      if (!res.success || !res.link) {
        logger.warn(`Failed to auto-shorten URL for ${message.author.tag}: ${res.error}`);
        continue;
      }

      const shortenedUrl = sinkClient.getFullShortUrl(slug);
      const guildName = message.guild.name;
      const channelName = (message.channel as { name?: string }).name || "채널";

      // 1. Send DM Card (Components v2 UI)
      const dmEmbed = ui.createWatchDmCard(
        rawUrl,
        shortenedUrl,
        guildName,
        channelName
      );

      const dmChannel = await message.author.createDM();
      await dmChannel.send({ embeds: [dmEmbed] });

      // 2. Send Pure Plain Text URL (Mobile Long-press copy optimization)
      await dmChannel.send(shortenedUrl);

      logger.success(`Successfully sent auto-shortened DM to ${message.author.tag}`);
      break; // Only shorten first URL per message to avoid spam
    } catch (err) {
      logger.error(`Error processing auto-shorten for message:`, err);
    }
  }
}
