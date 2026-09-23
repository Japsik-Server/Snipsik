import { writeFile, unlink } from "node:fs/promises";
import { rmSync } from "node:fs";
import type { Client } from "discord.js";
import { client as dbClient } from "@/db";
import { getAutomaticProcessingReadiness } from "@/services/cacheReadiness";
import { logger } from "@/utils/logger";
import { isDeploymentReady } from "@/services/readinessPolicy";

export const READINESS_FILE = "/tmp/snipsik-ready";
const INTERVAL_MS = 5_000;

export function startDeploymentReadiness(client: Client): () => void {
  let stopped = false;
  let inFlight = false;
  let lastReady = false;

  const refresh = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      let dbAvailable = false;
      try {
        await dbClient.execute("SELECT 1");
        dbAvailable = true;
      } catch (error) {
        logger.warn("Deployment readiness DB probe failed:", error);
      }
      const caches = getAutomaticProcessingReadiness().caches;
      const ready = isDeploymentReady(client.isReady(), dbAvailable, [
        caches.watch.state, caches.userConfig.state, caches.guildConfig.state,
      ]);
      if (ready && !stopped) {
        await writeFile(READINESS_FILE, String(Date.now()), { mode: 0o600 });
      } else {
        await unlink(READINESS_FILE).catch(() => {});
      }
      if (ready !== lastReady) {
        logger.info(`Deployment readiness: ${ready ? "ready" : "unavailable"}`);
        lastReady = ready;
      }
    } catch (error) {
      logger.error("Deployment readiness probe failed:", error);
      await unlink(READINESS_FILE).catch(() => {});
    } finally {
      inFlight = false;
    }
  };

  rmSync(READINESS_FILE, { force: true });
  const timer = setInterval(() => void refresh(), INTERVAL_MS);
  void refresh();
  return () => {
    stopped = true;
    clearInterval(timer);
    void unlink(READINESS_FILE).catch(() => {});
  };
}
