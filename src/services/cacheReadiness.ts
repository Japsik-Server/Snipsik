import { guildConfigService } from "@/services/guildConfigService";
import { userConfigService } from "@/services/userConfigService";
import { watchService } from "@/services/watchService";
import type { CacheStatus } from "@/services/cacheRecovery";

export interface AutomaticProcessingReadiness {
  ready: boolean;
  state: "ready" | "degraded" | "unavailable";
  caches: {
    watch: CacheStatus;
    userConfig: CacheStatus;
    guildConfig: CacheStatus;
  };
}

/** Returns whether every policy cache has a usable, successfully loaded snapshot. */
export function getAutomaticProcessingReadiness(): AutomaticProcessingReadiness {
  const caches = {
    watch: watchService.getCacheStatus(),
    userConfig: userConfigService.getCacheStatus(),
    guildConfig: guildConfigService.getCacheStatus(),
  };
  const statuses = Object.values(caches);
  const ready = statuses.every((status) => status.usable);

  return {
    ready,
    state: !ready
      ? "unavailable"
      : statuses.some((status) => status.state !== "ready")
        ? "degraded"
        : "ready",
    caches,
  };
}

/** Starts recovery for missing snapshots and fails closed until all are usable. */
export function ensureAutomaticProcessingReadiness(): boolean {
  const readiness = getAutomaticProcessingReadiness();
  if (readiness.ready) return true;

  if (!readiness.caches.watch.usable) watchService.ensureCacheRecovery();
  if (!readiness.caches.userConfig.usable) {
    userConfigService.triggerBackgroundReload();
  }
  if (!readiness.caches.guildConfig.usable) {
    guildConfigService.triggerBackgroundReload();
  }
  return false;
}

export function stopAutomaticProcessingCacheRecovery(): void {
  watchService.stopCacheRecovery();
  userConfigService.stopCacheRecovery();
  guildConfigService.stopCacheRecovery();
}
