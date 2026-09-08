import { eq } from "drizzle-orm";
import { db } from "@/db";
import { guildConfigs } from "@/db/schema";
import { config } from "@/config";
import {
  userConfigService,
  normalizeMinUrlLength,
} from "@/services/userConfigService";
import {
  getAllSystemDefaultDomains,
  isSystemDefaultDomain,
  normalizeDomain,
  MAX_CUSTOM_IGNORED_DOMAINS,
} from "@/utils/domain";
import { logger } from "@/utils/logger";

export interface GuildConfigData {
  guildId?: string;
  autoShortenEnabled: boolean;
  autoShortenMinUrlLength: number | null;
  ignoredDomains: string[];
}

export const DEFAULT_GUILD_CONFIG: Readonly<GuildConfigData> = {
  autoShortenEnabled: true,
  autoShortenMinUrlLength: null,
  ignoredDomains: [],
};

class GuildConfigService {
  // In-memory cache for O(1) sync lookups in messageCreate
  private cache: Map<string, GuildConfigData> = new Map();
  private cacheLoaded: boolean = false;
  private isReloadingCache: boolean = false;
  private nextReloadAllowedAt: number = 0;
  private cacheEpoch: number = 0;
  private static readonly RELOAD_COOLDOWN_MS = 10_000;

  /**
   * Triggers a non-blocking background attempt to reload guild configs cache if currently unloaded.
   * Throttled by a cooldown period to prevent log and database connection storms.
   */
  triggerBackgroundReload(): void {
    const now = Date.now();
    if (
      this.isReloadingCache ||
      this.cacheLoaded ||
      now < this.nextReloadAllowedAt
    ) {
      return;
    }
    this.isReloadingCache = true;
    this.loadCache()
      .then(() => {
        this.nextReloadAllowedAt = 0;
      })
      .catch((err) => {
        this.nextReloadAllowedAt =
          Date.now() + GuildConfigService.RELOAD_COOLDOWN_MS;
        logger.warn(
          `Background retry loading guild configs cache failed (cooldown ${GuildConfigService.RELOAD_COOLDOWN_MS}ms):`,
          err,
        );
      })
      .finally(() => {
        this.isReloadingCache = false;
      });
  }

  /**
   * Sets cache loaded status (used for testing or manual state control).
   *
   * @param loaded - Cache loaded status flag.
   */
  setCacheLoadedForTest(loaded: boolean): void {
    this.cacheLoaded = loaded;
  }

  /**
   * Whether the cache has been successfully loaded from database.
   *
   * @returns True if cache is loaded, false otherwise.
   */
  isCacheLoaded(): boolean {
    return this.cacheLoaded;
  }

  /**
   * Loads all guild configs into memory on bot startup or retry.
   * Synchronizes with concurrent writes using cacheEpoch to avoid clobbering newer rows.
   */
  async loadCache(): Promise<void> {
    const startEpoch = this.cacheEpoch;
    try {
      const records = await db.select().from(guildConfigs);
      if (this.cacheEpoch === startEpoch) {
        this.cache.clear();
        for (const record of records) {
          this.cache.set(record.guildId, {
            guildId: record.guildId,
            autoShortenEnabled: record.autoShortenEnabled,
            autoShortenMinUrlLength: record.autoShortenMinUrlLength ?? null,
            ignoredDomains: record.ignoredDomains ?? [],
          });
        }
      } else {
        // A newer write occurred while query was in-flight; merge without clobbering newly written keys
        for (const record of records) {
          if (!this.cache.has(record.guildId)) {
            this.cache.set(record.guildId, {
              guildId: record.guildId,
              autoShortenEnabled: record.autoShortenEnabled,
              autoShortenMinUrlLength: record.autoShortenMinUrlLength ?? null,
              ignoredDomains: record.ignoredDomains ?? [],
            });
          }
        }
      }
      this.cacheLoaded = true;
      logger.info(
        `Loaded ${records.length} guild config(s) into memory cache.`,
      );
    } catch (error) {
      this.cacheLoaded = false;
      logger.error("Failed to load guild configs cache from DB:", error);
      throw error;
    }
  }

  /**
   * Returns the current config for a guild (from memory cache or default).
   *
   * @param guildId - Discord guild snowflake ID.
   * @returns Guild configuration data.
   */
  getGuildConfig(guildId: string): GuildConfigData {
    const cached = this.cache.get(guildId);
    if (cached) {
      return { ...cached };
    }
    return {
      guildId,
      ...DEFAULT_GUILD_CONFIG,
    };
  }

  /**
   * Updates or creates a guild config in both DB and memory cache.
   * Modifies only supplied fields on conflict and syncs cache from returned merged row.
   *
   * @param guildId - Discord guild snowflake ID.
   * @param updates - Partial configuration updates.
   * @returns Operation success status and updated config.
   */
  async setGuildConfig(
    guildId: string,
    updates: Partial<
      Pick<
        GuildConfigData,
        "autoShortenEnabled" | "autoShortenMinUrlLength" | "ignoredDomains"
      >
    >,
  ): Promise<{ success: boolean; error?: string; config: GuildConfigData }> {
    const current = this.getGuildConfig(guildId);

    const setClause: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    const insertValues: {
      guildId: string;
      autoShortenEnabled?: boolean;
      autoShortenMinUrlLength?: number | null;
      ignoredDomains?: string[];
      updatedAt: Date;
    } = {
      guildId,
      updatedAt: new Date(),
    };

    if (updates.autoShortenEnabled !== undefined) {
      setClause.autoShortenEnabled = updates.autoShortenEnabled;
      insertValues.autoShortenEnabled = updates.autoShortenEnabled;
    }

    if (updates.autoShortenMinUrlLength !== undefined) {
      const normalizedLen = normalizeMinUrlLength(
        updates.autoShortenMinUrlLength,
      );
      if (!normalizedLen.valid) {
        return {
          success: false,
          error:
            "Invalid autoShortenMinUrlLength. Must be -1 (inherit), 0 (all), or an integer between 1 and 2048.",
          config: current,
        };
      }
      setClause.autoShortenMinUrlLength = normalizedLen.value;
      insertValues.autoShortenMinUrlLength = normalizedLen.value;
    }

    if (updates.ignoredDomains !== undefined) {
      const normalizedList: string[] = [];
      const seen = new Set<string>();
      for (const d of updates.ignoredDomains) {
        const norm = normalizeDomain(d);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          normalizedList.push(norm);
        }
      }
      if (normalizedList.length > MAX_CUSTOM_IGNORED_DOMAINS) {
        return {
          success: false,
          error: `제외 도메인은 최대 ${MAX_CUSTOM_IGNORED_DOMAINS}개까지 등록할 수 있습니다.`,
          config: current,
        };
      }
      setClause.ignoredDomains = normalizedList;
      insertValues.ignoredDomains = normalizedList;
    }

    try {
      const [saved] = await db
        .insert(guildConfigs)
        .values(insertValues)
        .onConflictDoUpdate({
          target: guildConfigs.guildId,
          set: setClause,
        })
        .returning();

      if (!saved) {
        throw new Error("Failed to persist guild configuration.");
      }

      const savedConfig: GuildConfigData = {
        guildId: saved.guildId,
        autoShortenEnabled: saved.autoShortenEnabled,
        autoShortenMinUrlLength: saved.autoShortenMinUrlLength ?? null,
        ignoredDomains: saved.ignoredDomains ?? [],
      };

      this.cacheEpoch++;
      this.cache.set(guildId, savedConfig);
      if (!this.cacheLoaded) {
        this.triggerBackgroundReload();
      }
      logger.info(
        `Updated guild config for ${guildId}: autoShortenEnabled=${savedConfig.autoShortenEnabled}, autoShortenMinUrlLength=${savedConfig.autoShortenMinUrlLength}, ignoredDomains=${savedConfig.ignoredDomains.length}`,
      );
      return { success: true, config: savedConfig };
    } catch (error) {
      logger.error(`Failed to update guild config for ${guildId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Database error",
        config: current,
      };
    }
  }

  /**
   * Atomically mutates the ignored domains array for a guild using a database transaction with row-level locking (FOR UPDATE).
   * Derives the replacement array from the fresh, locked row to prevent concurrent race conditions.
   *
   * @param guildId - Discord guild snowflake ID.
   * @param mutator - Pure callback that computes next domains or returns an error based on fresh locked domains.
   * @returns Updated config or error status.
   */
  private async mutateIgnoredDomains(
    guildId: string,
    mutator: (
      currentDomains: string[],
    ) => { ok: true; domains: string[] } | { ok: false; error: string },
  ): Promise<{ success: boolean; error?: string; config: GuildConfigData }> {
    const fallbackConfig = this.getGuildConfig(guildId);
    try {
      return await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(guildConfigs)
          .where(eq(guildConfigs.guildId, guildId))
          .for("update");

        const existingRow = rows[0];
        const currentDomains = existingRow?.ignoredDomains ?? [];

        const mutationResult = mutator([...currentDomains]);
        if (!mutationResult.ok) {
          return {
            success: false,
            error: mutationResult.error,
            config: existingRow
              ? {
                  guildId: existingRow.guildId,
                  autoShortenEnabled: existingRow.autoShortenEnabled,
                  autoShortenMinUrlLength:
                    existingRow.autoShortenMinUrlLength ?? null,
                  ignoredDomains: existingRow.ignoredDomains ?? [],
                }
              : fallbackConfig,
          };
        }

        const nextDomains = mutationResult.domains;

        const [saved] = await tx
          .insert(guildConfigs)
          .values({
            guildId,
            autoShortenEnabled: existingRow?.autoShortenEnabled ?? true,
            autoShortenMinUrlLength:
              existingRow?.autoShortenMinUrlLength ?? null,
            ignoredDomains: nextDomains,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: guildConfigs.guildId,
            set: {
              ignoredDomains: nextDomains,
              updatedAt: new Date(),
            },
          })
          .returning();

        if (!saved) {
          throw new Error("Failed to persist updated guild ignored domains.");
        }

        const savedConfig: GuildConfigData = {
          guildId: saved.guildId,
          autoShortenEnabled: saved.autoShortenEnabled,
          autoShortenMinUrlLength: saved.autoShortenMinUrlLength ?? null,
          ignoredDomains: saved.ignoredDomains ?? [],
        };

        this.cacheEpoch++;
        this.cache.set(guildId, savedConfig);
        if (!this.cacheLoaded) {
          this.triggerBackgroundReload();
        }
        logger.info(
          `Atomically updated ignored domains for ${guildId}: count=${savedConfig.ignoredDomains.length}`,
        );
        return { success: true, config: savedConfig };
      });
    } catch (error) {
      logger.error(
        `Failed to atomically mutate guild ignored domains for ${guildId}:`,
        error,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Database error",
        config: fallbackConfig,
      };
    }
  }

  /**
   * Adds an ignored domain to a guild configuration atomically with row-level locking.
   *
   * @param guildId - Discord guild snowflake ID.
   * @param rawDomain - Raw domain string to add.
   * @returns Operation status with reason or updated config.
   */
  async addIgnoredDomain(
    guildId: string,
    rawDomain: string,
  ): Promise<{ success: boolean; error?: string; config: GuildConfigData }> {
    const current = this.getGuildConfig(guildId);
    const normalized = normalizeDomain(rawDomain);
    if (!normalized) {
      return {
        success: false,
        error: `유효하지 않은 도메인 형식입니다: '${rawDomain}'`,
        config: current,
      };
    }

    if (isSystemDefaultDomain(normalized)) {
      return {
        success: false,
        error: "is_system_default",
        config: current,
      };
    }

    return this.mutateIgnoredDomains(guildId, (currentDomains) => {
      if (currentDomains.includes(normalized)) {
        return { ok: false, error: "already_exists" };
      }

      if (currentDomains.length >= MAX_CUSTOM_IGNORED_DOMAINS) {
        return { ok: false, error: "limit_exceeded" };
      }

      return { ok: true, domains: [...currentDomains, normalized] };
    });
  }

  /**
   * Removes an ignored domain from a guild configuration atomically with row-level locking.
   *
   * @param guildId - Discord guild snowflake ID.
   * @param rawDomain - Raw domain string to remove.
   * @returns Operation status with reason or updated config.
   */
  async removeIgnoredDomain(
    guildId: string,
    rawDomain: string,
  ): Promise<{ success: boolean; error?: string; config: GuildConfigData }> {
    const current = this.getGuildConfig(guildId);
    const normalized = normalizeDomain(rawDomain);
    if (!normalized) {
      return {
        success: false,
        error: `유효하지 않은 도메인 형식입니다: '${rawDomain}'`,
        config: current,
      };
    }

    if (isSystemDefaultDomain(normalized)) {
      return {
        success: false,
        error: "is_system_default",
        config: current,
      };
    }

    return this.mutateIgnoredDomains(guildId, (currentDomains) => {
      if (!currentDomains.includes(normalized)) {
        return { ok: false, error: "not_found" };
      }

      return {
        ok: true,
        domains: currentDomains.filter((d) => d !== normalized),
      };
    });
  }

  /**
   * Resets all custom ignored domains for a guild atomically.
   *
   * @param guildId - Discord guild snowflake ID.
   * @returns Operation status and reset config.
   */
  async resetIgnoredDomains(
    guildId: string,
  ): Promise<{ success: boolean; error?: string; config: GuildConfigData }> {
    return this.mutateIgnoredDomains(guildId, () => ({
      ok: true,
      domains: [],
    }));
  }

  /**
   * Resolves the cumulative set of ignored domains for a message:
   * System Defaults (Tenor, Giphy, Discord CDN, Imgur + ENV) + Guild Additions + User Additions.
   *
   * @param guildId - Discord guild snowflake ID (or null/undefined)
   * @param userId - Discord user snowflake ID
   * @returns Combined Set of effective ignored domains
   */
  resolveEffectiveIgnoredDomains(
    guildId: string | null | undefined,
    userId: string,
  ): Set<string> {
    const effective = new Set<string>(getAllSystemDefaultDomains());

    if (guildId) {
      if (!this.cacheLoaded) {
        this.triggerBackgroundReload();
      }
      const guildCfg = this.getGuildConfig(guildId);
      if (Array.isArray(guildCfg.ignoredDomains)) {
        for (const d of guildCfg.ignoredDomains) {
          effective.add(d);
        }
      }
    }

    const userCfg = userConfigService.getUserConfig(userId);
    if (Array.isArray(userCfg.ignoredDomains)) {
      for (const d of userCfg.ignoredDomains) {
        effective.add(d);
      }
    }

    return effective;
  }

  /**
   * Resolves the effective minimum URL length across the 3-tier hierarchy:
   * 1. User config override (if set and not null)
   * 2. Guild config override (if set and not null)
   * 3. Global ENV default (config.AUTO_SHORTEN_MIN_URL_LENGTH, default 70)
   *
   * @param guildId - Discord guild snowflake ID (or null/undefined)
   * @param userId - Discord user snowflake ID
   * @returns Effective minimum URL length threshold
   */
  resolveEffectiveMinUrlLength(
    guildId: string | null | undefined,
    userId: string,
  ): number {
    const userCfg = userConfigService.getUserConfig(userId);
    if (
      userCfg.autoShortenMinUrlLength !== null &&
      userCfg.autoShortenMinUrlLength !== undefined
    ) {
      return userCfg.autoShortenMinUrlLength;
    }

    if (guildId) {
      if (!this.cacheLoaded) {
        this.triggerBackgroundReload();
      }
      const guildCfg = this.getGuildConfig(guildId);
      if (
        guildCfg.autoShortenMinUrlLength !== null &&
        guildCfg.autoShortenMinUrlLength !== undefined
      ) {
        return guildCfg.autoShortenMinUrlLength;
      }
    }

    return config.AUTO_SHORTEN_MIN_URL_LENGTH;
  }
}

export const guildConfigService = new GuildConfigService();
