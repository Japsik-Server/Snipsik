import { writeFile, unlink, rename } from "node:fs/promises";
import { rmSync } from "node:fs";
import type { Client } from "discord.js";
import { client as dbClient } from "@/db";
import { getAutomaticProcessingReadiness } from "@/services/cacheReadiness";
import { logger } from "@/utils/logger";
import { isDeploymentReady } from "@/services/readinessPolicy";

export const READINESS_FILE = "/tmp/snipsik-ready";
const INTERVAL_MS = 5_000;
const DB_PROBE_TIMEOUT_MS = 2_000;
const READINESS_TEMP_FILE = `${READINESS_FILE}.${process.pid}.tmp`;

export async function writeReadinessTimestamp(filePath: string, timestamp: number): Promise<void> {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, String(timestamp), { mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function probeDatabase(execute: () => Promise<unknown>, timeoutMs = DB_PROBE_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      execute(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Database readiness probe timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
        await probeDatabase(() => dbClient.execute("SELECT 1"));
        dbAvailable = true;
      } catch (error) {
        logger.warn("Deployment readiness DB probe failed:", error);
      }
      const caches = getAutomaticProcessingReadiness().caches;
      const ready = isDeploymentReady(client.isReady(), dbAvailable, [
        caches.watch.state, caches.userConfig.state, caches.guildConfig.state,
      ]);
      if (ready && !stopped) {
        await writeReadinessTimestamp(READINESS_FILE, Date.now());
        if (stopped) await unlink(READINESS_FILE).catch(() => {});
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
  rmSync(READINESS_TEMP_FILE, { force: true });
  const timer = setInterval(() => void refresh(), INTERVAL_MS);
  void refresh();
  return () => {
    stopped = true;
    clearInterval(timer);
    void unlink(READINESS_FILE).catch(() => {});
  };
}
