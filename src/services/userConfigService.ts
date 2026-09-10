import { db } from "@/db";
import { userConfigs } from "@/db/schema";
import { normalizeDomain, MAX_CUSTOM_IGNORED_DOMAINS } from "@/utils/domain";
import { logger } from "@/utils/logger";

export type AutoDmMode = "inherit" | "on" | "off";
export type DmFormat = "replace" | "list";

export interface UserConfigData {
  userId?: string;
  autoDmMode: AutoDmMode;
  dmFormat: DmFormat;
  autoShortenMinUrlLength: number | null;
  ignoredDomains: string[];
  fixupxEnabled: boolean;
}

export const DEFAULT_USER_CONFIG: Readonly<UserConfigData> = {
  autoDmMode: "inherit",
  dmFormat: "replace",
  autoShortenMinUrlLength: null,
  ignoredDomains: [],
  fixupxEnabled: true,
};

/**
 * Normalizes input value for custom ignored domains.
 * Accepts comma-separated string or array of strings.
 * - "reset", "clear", "inherit", "default", "", null, undefined, []: returns { valid: true, value: [] }
 * - Otherwise parses and normalizes each domain via normalizeDomain().
 * - Rejects if any domain is invalid or if unique count exceeds MAX_CUSTOM_IGNORED_DOMAINS.
 *
 * @param value - The raw input value to normalize.
 * @returns An object indicating validity, normalized string array, and optional error message.
 */
export function normalizeIgnoredDomains(value: unknown): {
  valid: boolean;
  value: string[];
  error?: string;
} {
  if (value === null || value === undefined) {
    return { valid: true, value: [] };
  }

  let candidates: string[] = [];

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      !trimmed ||
      trimmed.toLowerCase() === "reset" ||
      trimmed.toLowerCase() === "clear" ||
      trimmed.toLowerCase() === "inherit" ||
      trimmed.toLowerCase() === "default"
    ) {
      return { valid: true, value: [] };
    }
    candidates = trimmed.split(/[\s,]+/);
  } else if (Array.isArray(value)) {
    candidates = value.map((v) => String(v));
  } else {
    return {
      valid: false,
      value: [],
      error: "도메인 목록은 쉼표로 구분된 문자열 또는 배열이어야 합니다.",
    };
  }

  const result = new Set<string>();
  for (const raw of candidates) {
    const item = raw.trim();
    if (!item) continue;
    const normalized = normalizeDomain(item);
    if (!normalized) {
      return {
        valid: false,
        value: [],
        error: `유효하지 않은 도메인 형식입니다: '${item}'`,
      };
    }
    result.add(normalized);
  }

  if (result.size > MAX_CUSTOM_IGNORED_DOMAINS) {
    return {
      valid: false,
      value: [],
      error: `제외 도메인은 최대 ${MAX_CUSTOM_IGNORED_DOMAINS}개까지 등록할 수 있습니다. (입력: ${result.size}개)`,
    };
  }

  return { valid: true, value: Array.from(result) };
}

/**
 * Normalizes input value for minimum URL length threshold.
 * - null, undefined, -1, "inherit", "default", "reset": returns { valid: true, value: null } (inherit)
 * - 0, "0", "all": returns { valid: true, value: 0 } (all URLs)
 * - 1..2048 (or numeric string): returns { valid: true, value: N }
 * - anything else: returns { valid: false, value: null }
 *
 * @param value - The raw input value to normalize.
 * @returns An object indicating validity and the normalized number or null.
 */
export function normalizeMinUrlLength(value: unknown): {
  valid: boolean;
  value: number | null;
} {
  if (value === null || value === undefined) {
    return { valid: true, value: null };
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value)) return { valid: false, value: null };
    if (value === -1) return { valid: true, value: null };
    if (value === 0) return { valid: true, value: 0 };
    if (value >= 1 && value <= 2048) return { valid: true, value };
    return { valid: false, value: null };
  }

  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (
      lower === "inherit" ||
      lower === "default" ||
      lower === "reset" ||
      lower === "-1"
    ) {
      return { valid: true, value: null };
    }
    if (lower === "all" || lower === "0") {
      return { valid: true, value: 0 };
    }
    const parsed = parseInt(lower, 10);
    if (String(parsed) === lower) {
      if (parsed === -1) return { valid: true, value: null };
      if (parsed === 0) return { valid: true, value: 0 };
      if (parsed >= 1 && parsed <= 2048) return { valid: true, value: parsed };
    }
  }

  return { valid: false, value: null };
}

/**
 * Normalizes an unknown value to a valid AutoDmMode or null.
 *
 * @param value - Input string or unknown value to normalize.
 * @returns Normalized AutoDmMode or null if invalid.
 */
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

/**
 * Normalizes an unknown value to a valid DmFormat or null.
 *
 * @param value - Input string or unknown value to normalize.
 * @returns Normalized DmFormat or null if invalid.
 */
export function normalizeDmFormat(value: unknown): DmFormat | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (lower === "replace" || lower === "message") return "replace";
  if (lower === "list" || lower === "urls") return "list";
  return null;
}

/**
 * Normalizes an unknown value to a boolean flag for fixupx conversion.
 *
 * @param value - Input string, boolean, or unknown value to normalize.
 * @returns Boolean value or null if invalid.
 */
export function normalizeFixupxEnabled(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (
    lower === "on" ||
    lower === "true" ||
    lower === "enable" ||
    lower === "enabled" ||
    lower === "1"
  ) {
    return true;
  }
  if (
    lower === "off" ||
    lower === "false" ||
    lower === "disable" ||
    lower === "disabled" ||
    lower === "0"
  ) {
    return false;
  }
  return null;
}

class UserConfigService {
  // In-memory cache for O(1) sync lookups in messageCreate
  private cache: Map<string, UserConfigData> = new Map();
  private cacheLoaded: boolean = false;
  private isReloadingCache: boolean = false;
  private nextReloadAllowedAt: number = 0;
  private cacheEpoch: number = 0;
  private static readonly RELOAD_COOLDOWN_MS = 10_000;

  /**
   * Triggers a non-blocking background attempt to reload user configs cache if currently unloaded.
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
          Date.now() + UserConfigService.RELOAD_COOLDOWN_MS;
        logger.warn(
          `Background retry loading user configs cache failed (cooldown ${UserConfigService.RELOAD_COOLDOWN_MS}ms):`,
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
   * Loads all user configs into memory on bot startup or retry.
   * Synchronizes with concurrent writes using cacheEpoch to avoid clobbering newer rows.
   */
  async loadCache(): Promise<void> {
    const startEpoch = this.cacheEpoch;
    try {
      const records = await db.select().from(userConfigs);
      if (this.cacheEpoch === startEpoch) {
        this.cache.clear();
        for (const record of records) {
          const autoDmMode =
            normalizeAutoDmMode(record.autoDmMode) ?? "inherit";
          const dmFormat = normalizeDmFormat(record.dmFormat) ?? "replace";
          this.cache.set(record.userId, {
            userId: record.userId,
            autoDmMode,
            dmFormat,
            autoShortenMinUrlLength: record.autoShortenMinUrlLength ?? null,
            ignoredDomains: record.ignoredDomains ?? [],
            fixupxEnabled: record.fixupxEnabled ?? true,
          });
        }
      } else {
        // A newer write occurred while query was in-flight; merge without clobbering newly written keys
        for (const record of records) {
          if (!this.cache.has(record.userId)) {
            const autoDmMode =
              normalizeAutoDmMode(record.autoDmMode) ?? "inherit";
            const dmFormat = normalizeDmFormat(record.dmFormat) ?? "replace";
            this.cache.set(record.userId, {
              userId: record.userId,
              autoDmMode,
              dmFormat,
              autoShortenMinUrlLength: record.autoShortenMinUrlLength ?? null,
              ignoredDomains: record.ignoredDomains ?? [],
              fixupxEnabled: record.fixupxEnabled ?? true,
            });
          }
        }
      }
      this.cacheLoaded = true;
      logger.info(`Loaded ${records.length} user config(s) into memory cache.`);
    } catch (error) {
      this.cacheLoaded = false;
      logger.error("Failed to load user configs cache from DB:", error);
      throw error;
    }
  }

  /**
   * Returns the current config for a user (from memory cache or default).
   *
   * @param userId - Discord user snowflake ID.
   * @returns User configuration data.
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
   * Modifies only supplied fields on conflict and syncs cache from returned merged row.
   *
   * @param userId - Discord user snowflake ID.
   * @param updates - Partial configuration updates.
   * @returns Operation success status and updated config.
   */
  async setUserConfig(
    userId: string,
    updates: Partial<
      Pick<
        UserConfigData,
        | "autoDmMode"
        | "dmFormat"
        | "autoShortenMinUrlLength"
        | "ignoredDomains"
        | "fixupxEnabled"
      >
    >,
  ): Promise<{ success: boolean; error?: string; config: UserConfigData }> {
    const current = this.getUserConfig(userId);

    const setClause: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    const insertValues: {
      userId: string;
      autoDmMode?: AutoDmMode;
      dmFormat?: DmFormat;
      autoShortenMinUrlLength?: number | null;
      ignoredDomains?: string[];
      fixupxEnabled?: boolean;
      updatedAt: Date;
    } = {
      userId,
      updatedAt: new Date(),
    };

    if (updates.autoDmMode !== undefined) {
      const normalized = normalizeAutoDmMode(updates.autoDmMode);
      if (normalized) {
        setClause.autoDmMode = normalized;
        insertValues.autoDmMode = normalized;
      }
    }

    if (updates.dmFormat !== undefined) {
      const normalized = normalizeDmFormat(updates.dmFormat);
      if (normalized) {
        setClause.dmFormat = normalized;
        insertValues.dmFormat = normalized;
      }
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
      const normalizedDomains = normalizeIgnoredDomains(updates.ignoredDomains);
      if (!normalizedDomains.valid) {
        return {
          success: false,
          error: normalizedDomains.error || "Invalid ignoredDomains.",
          config: current,
        };
      }
      setClause.ignoredDomains = normalizedDomains.value;
      insertValues.ignoredDomains = normalizedDomains.value;
    }

    if (updates.fixupxEnabled !== undefined) {
      const normalizedFixupx = normalizeFixupxEnabled(updates.fixupxEnabled);
      if (normalizedFixupx === null) {
        return {
          success: false,
          error: "Invalid fixupx setting. Must be 'on' or 'off'.",
          config: current,
        };
      }
      setClause.fixupxEnabled = normalizedFixupx;
      insertValues.fixupxEnabled = normalizedFixupx;
    }

    try {
      const [saved] = await db
        .insert(userConfigs)
        .values(insertValues)
        .onConflictDoUpdate({
          target: userConfigs.userId,
          set: setClause,
        })
        .returning();

      if (!saved) {
        throw new Error("Failed to persist user configuration.");
      }

      const savedConfig: UserConfigData = {
        userId: saved.userId,
        autoDmMode: normalizeAutoDmMode(saved.autoDmMode) ?? "inherit",
        dmFormat: normalizeDmFormat(saved.dmFormat) ?? "replace",
        autoShortenMinUrlLength: saved.autoShortenMinUrlLength ?? null,
        ignoredDomains: saved.ignoredDomains ?? [],
        fixupxEnabled: saved.fixupxEnabled ?? true,
      };

      this.cacheEpoch++;
      this.cache.set(userId, savedConfig);
      if (!this.cacheLoaded) {
        this.triggerBackgroundReload();
      }
      logger.info(
        `Updated user config for ${userId}: autoDmMode=${savedConfig.autoDmMode}, dmFormat=${savedConfig.dmFormat}, autoShortenMinUrlLength=${savedConfig.autoShortenMinUrlLength}, ignoredDomains=${savedConfig.ignoredDomains.length}`,
      );
      return { success: true, config: savedConfig };
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
   * Fails closed (returns false) if the cache is not loaded to prevent privacy leaks.
   * Schedules a background cache reload if cache is currently not loaded.
   */
  shouldProcessUser(userId: string, isChannelWatched: boolean): boolean {
    if (!this.cacheLoaded) {
      this.triggerBackgroundReload();
      logger.warn(
        `UserConfig cache not loaded; failing closed for user ${userId} and scheduled background reload`,
      );
      return false;
    }

    const cfg = this.getUserConfig(userId);
    if (cfg.autoDmMode === "off") return false;
    if (cfg.autoDmMode === "on") return true;
    return isChannelWatched;
  }

  /**
   * Replaces original URLs with shortened or transformed URLs in the original message content.
   * Sorts URLs by descending length (longest first) to prevent substring collision.
   */
  replaceUrlsInText(
    content: string,
    replacements: Array<{
      originalUrl: string;
      shortenedUrl?: string;
      targetUrl?: string;
    }>,
  ): string {
    if (!content || replacements.length === 0) return content;

    // Deduplicate replacements by originalUrl
    const map = new Map<string, string>();
    for (const r of replacements) {
      const target = r.targetUrl || r.shortenedUrl;
      if (target && !map.has(r.originalUrl)) {
        map.set(r.originalUrl, target);
      }
    }

    // Sort by descending URL length
    const sorted = Array.from(map.entries()).sort(
      ([urlA], [urlB]) => urlB.length - urlA.length,
    );

    let result = content;
    for (const [origUrl, targetUrl] of sorted) {
      result = result.split(origUrl).join(targetUrl);
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
