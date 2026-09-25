import { writeFile, unlink, rename } from "node:fs/promises";
import { rmSync } from "node:fs";
import type { Client } from "discord.js";
import { createClient, type Client as DatabaseClient } from "@libsql/client";
import { config } from "@/config";
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

export async function probeDatabase(execute: () => Promise<unknown>, timeoutMs = DB_PROBE_TIMEOUT_MS, cancel?: () => void): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      execute(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try { cancel?.(); } catch (error) { logger.warn("Could not cancel database readiness probe:", error); }
          reject(new Error("Database readiness probe timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createDatabaseProbe(execute: () => Promise<unknown>, timeoutMs = DB_PROBE_TIMEOUT_MS, cancel?: () => void): () => Promise<void> {
  let pending: Promise<unknown> | undefined;
  return async () => {
    if (pending) throw new Error("Previous database readiness probe is still running");
    const execution = Promise.resolve().then(execute);
    pending = execution;
    void execution.then(
      () => { if (pending === execution) pending = undefined; },
      () => { if (pending === execution) pending = undefined; },
    );
    await probeDatabase(() => execution, timeoutMs, cancel);
  };
}

function createReadinessDatabaseProbe(): () => Promise<void> {
  let activeClient: DatabaseClient | undefined;
  let controller: AbortController | undefined;
  const remoteUrl = config.DATABASE_URL.replace(/^libsql:/, "https:").replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const execute = async () => {
    const requestController = new AbortController();
    const client = createClient({
      url: remoteUrl,
      authToken: config.DATABASE_AUTH_TOKEN,
      fetch: (request: Request) => fetch(request, { signal: requestController.signal }),
    });
    activeClient = client;
    controller = requestController;
    try {
      await client.execute("SELECT 1");
    } finally {
      client.close();
      if (activeClient === client) {
        activeClient = undefined;
        controller = undefined;
      }
    }
  };
  return createDatabaseProbe(execute, DB_PROBE_TIMEOUT_MS, () => {
    controller?.abort();
    activeClient?.close();
  });
}

export function startDeploymentReadiness(client: Client): () => void {
  let stopped = false;
  let inFlight = false;
  let lastReady = false;
  const probe = createReadinessDatabaseProbe();

  const refresh = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      let dbAvailable = false;
      try {
        await probe();
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
