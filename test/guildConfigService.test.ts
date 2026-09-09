import { describe, expect, it, beforeEach } from "bun:test";
import {
  guildConfigService,
  DEFAULT_GUILD_CONFIG,
} from "@/services/guildConfigService";
import { userConfigService } from "@/services/userConfigService";
import { config } from "@/config";

describe("GuildConfigService Unit Tests", () => {
  const testGuildId = "test-guild-123456";
  const testUserId = "test-user-654321";

  beforeEach(() => {
    // Reset internal caches
    // @ts-expect-error accessing private cache for test setup
    guildConfigService.cache.clear();
    // @ts-expect-error accessing private cache for test setup
    userConfigService.cache.clear();
  });

  describe("getGuildConfig", () => {
    it("returns default guild config when guild is not cached", () => {
      const result = guildConfigService.getGuildConfig("unconfigured-guild");
      expect(result.guildId).toBe("unconfigured-guild");
      expect(result.autoShortenEnabled).toBe(
        DEFAULT_GUILD_CONFIG.autoShortenEnabled,
      );
      expect(result.autoShortenMinUrlLength).toBe(
        DEFAULT_GUILD_CONFIG.autoShortenMinUrlLength,
      );
      expect(result.autoShortenMinUrlLength).toBeNull();
    });

    it("returns cached guild config when present", () => {
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 50,
        ignoredDomains: ["custom.example.com"],
      });

      const result = guildConfigService.getGuildConfig(testGuildId);
      expect(result.guildId).toBe(testGuildId);
      expect(result.autoShortenMinUrlLength).toBe(50);
      expect(result.ignoredDomains).toEqual(["custom.example.com"]);
    });
  });

  describe("resolveEffectiveMinUrlLength (3-Tier Hierarchy)", () => {
    it("falls back to global ENV default when neither user nor guild has override", () => {
      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(config.AUTO_SHORTEN_MIN_URL_LENGTH);
    });

    it("applies guild override when user has no override", () => {
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 45,
      });

      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(45);
    });

    it("applies user override over guild override and global ENV", () => {
      // Guild override: 45
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 45,
      });

      // User override: 30
      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.set(testUserId, {
        userId: testUserId,
        autoDmMode: "inherit",
        dmFormat: "replace",
        autoShortenMinUrlLength: 30,
      });

      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(30);
    });

    it("respects user override of 0 (shorten all URLs) even if guild has higher threshold", () => {
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 100,
      });

      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.set(testUserId, {
        userId: testUserId,
        autoDmMode: "inherit",
        dmFormat: "replace",
        autoShortenMinUrlLength: 0,
      });

      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(0);
    });

    it("respects guild override of 0 (shorten all URLs in guild) when user is inherit (null)", () => {
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: 0,
      });

      // User has config record, but autoShortenMinUrlLength is null (inherit)
      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.set(testUserId, {
        userId: testUserId,
        autoDmMode: "inherit",
        dmFormat: "replace",
        autoShortenMinUrlLength: null,
      });

      const effective = guildConfigService.resolveEffectiveMinUrlLength(
        testGuildId,
        testUserId,
      );
      expect(effective).toBe(0);
    });

    it("handles null/undefined guildId gracefully and checks user then ENV", () => {
      // User override: 80
      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.set(testUserId, {
        userId: testUserId,
        autoDmMode: "inherit",
        dmFormat: "replace",
        autoShortenMinUrlLength: 80,
      });

      expect(
        guildConfigService.resolveEffectiveMinUrlLength(undefined, testUserId),
      ).toBe(80);
      expect(
        guildConfigService.resolveEffectiveMinUrlLength(null, testUserId),
      ).toBe(80);

      // Without user override -> ENV
      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.clear();
      expect(
        guildConfigService.resolveEffectiveMinUrlLength(undefined, testUserId),
      ).toBe(config.AUTO_SHORTEN_MIN_URL_LENGTH);
    });
  });

  describe("resolveEffectiveIgnoredDomains (Cumulative Union)", () => {
    it("includes system defaults when neither guild nor user has additions", () => {
      const effective = guildConfigService.resolveEffectiveIgnoredDomains(
        testGuildId,
        testUserId,
      );
      expect(effective.has("tenor.com")).toBe(true);
      expect(effective.has("giphy.com")).toBe(true);
      expect(effective.has("cdn.discordapp.com")).toBe(true);
      expect(effective.has("media.discordapp.net")).toBe(true);
      expect(effective.has("imgur.com")).toBe(true);
    });

    it("unions system defaults, guild additions, and user additions", () => {
      // @ts-expect-error accessing private cache for test setup
      guildConfigService.cache.set(testGuildId, {
        guildId: testGuildId,
        autoShortenEnabled: true,
        autoShortenMinUrlLength: null,
        ignoredDomains: ["guild-custom.org"],
      });

      // @ts-expect-error accessing private cache for test setup
      userConfigService.cache.set(testUserId, {
        userId: testUserId,
        autoDmMode: "inherit",
        dmFormat: "replace",
        autoShortenMinUrlLength: null,
        ignoredDomains: ["user-custom.net"],
      });

      const effective = guildConfigService.resolveEffectiveIgnoredDomains(
        testGuildId,
        testUserId,
      );
      expect(effective.has("tenor.com")).toBe(true);
      expect(effective.has("guild-custom.org")).toBe(true);
      expect(effective.has("user-custom.net")).toBe(true);
    });
  });

  describe("setGuildConfig validation", () => {
    it("rejects invalid autoShortenMinUrlLength values outside 0..2048", async () => {
      const result = await guildConfigService.setGuildConfig(testGuildId, {
        autoShortenMinUrlLength: 3000,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid autoShortenMinUrlLength");
    });

    it("rejects invalid domain string formats in ignoredDomains", async () => {
      const result = await guildConfigService.setGuildConfig(testGuildId, {
        ignoredDomains: ["valid.com", "not a domain"],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("유효하지 않은 도메인");
    });

    it("rejects when ignoredDomains list exceeds maximum allowed count", async () => {
      const tooMany = Array.from(
        { length: 51 },
        (_, i) => `guild${i}.example.com`,
      );
      const result = await guildConfigService.setGuildConfig(testGuildId, {
        ignoredDomains: tooMany,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("최대");
    });
  });
});
