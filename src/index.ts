import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { config } from "@/config";
import { onReady } from "@/events/ready";
import { onInteractionCreate } from "@/events/interactionCreate";
import { onMessageCreate } from "@/events/messageCreate";
import { logger } from "@/utils/logger";

logger.info("Starting Snipsik Discord Bot...");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// Event Listeners
client.once(Events.ClientReady, async (readyClient) => {
  await onReady(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  await onInteractionCreate(interaction);
});

client.on(Events.MessageCreate, async (message) => {
  await onMessageCreate(message);
});

// Global Error Handlers
client.on("error", (error) => {
  logger.error("Discord Client Error:", error);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
});

// Login
client.login(config.DISCORD_TOKEN).catch((err) => {
  logger.error("Failed to login to Discord:", err);
  process.exit(1);
});
