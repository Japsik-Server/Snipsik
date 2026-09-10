import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { onMessageCreate } from "@/events/messageCreate";
import { watchService } from "@/services/watchService";
import { userConfigService } from "@/services/userConfigService";
import { guildConfigService } from "@/services/guildConfigService";
import { sinkClient } from "@/services/sinkClient";
import { MessageFlags, type Message } from "discord.js";

describe("MessageCreate Twitter fixupx Conversion", () => {
  const originalIsChannelWatched = watchService.isChannelWatched;
  const originalGetUserConfig = userConfigService.getUserConfig;
  const originalShouldProcessUser = userConfigService.shouldProcessUser;
  const originalResolveEffectiveMinUrlLength =
    guildConfigService.resolveEffectiveMinUrlLength;
  const originalResolveEffectiveIgnoredDomains =
    guildConfigService.resolveEffectiveIgnoredDomains;
  const originalSearchLinks = sinkClient.searchLinks;
  const originalCreateLink = sinkClient.createLink;
  const originalGetFullShortUrl = sinkClient.getFullShortUrl;

  const testUserId = "999888777666555444";
  const testGuildId = "guild-twitter-test";
  const testChannelId = "channel-twitter-test";

  let sentDmCalls: any[] = [];
  let suppressEmbedsCalls: any[] = [];

  const createMockDmChannel = () => ({
    send: mock(async (options: any) => {
      sentDmCalls.push(options);
      return {
        flags: new Set<MessageFlags>([MessageFlags.SuppressEmbeds]),
        suppressEmbeds: mock(async (suppress: boolean) => {
          suppressEmbedsCalls.push(suppress);
        }),
      };
    }),
  });

  const createMockMessage = (content: string, dmChannel: any): Message =>
    ({
      author: {
        id: testUserId,
        bot: false,
        tag: "TwitterTester#0001",
        createDM: mock(async () => dmChannel),
      },
      webhookId: null,
      guildId: testGuildId,
      guild: { id: testGuildId },
      channelId: testChannelId,
      channel: { id: testChannelId, name: "general" },
      content,
      url: "https://discord.com/channels/guild/channel/msg123",
    }) as unknown as Message;

  beforeEach(() => {
    sentDmCalls = [];
    suppressEmbedsCalls = [];
    watchService.isChannelWatched = () => true;
    userConfigService.shouldProcessUser = () => true;
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: 70, // Regular links need >= 70
      ignoredDomains: [],
      fixupxEnabled: true,
    });
    guildConfigService.resolveEffectiveMinUrlLength = () => 70;
    guildConfigService.resolveEffectiveIgnoredDomains = () => new Set();
    sinkClient.getFullShortUrl = (slug: string) =>
      `https://s.japsik.com/${slug}`;
    sinkClient.searchLinks = async () => ({
      success: true,
      list: [],
      total: 0,
      status: 200,
    });
    sinkClient.createLink = async () => ({
      success: true,
      link: { slug: "short-slug-123", url: "https://example.com" },
    });
  });

  afterEach(() => {
    watchService.isChannelWatched = originalIsChannelWatched;
    userConfigService.getUserConfig = originalGetUserConfig;
    userConfigService.shouldProcessUser = originalShouldProcessUser;
    guildConfigService.resolveEffectiveMinUrlLength =
      originalResolveEffectiveMinUrlLength;
    guildConfigService.resolveEffectiveIgnoredDomains =
      originalResolveEffectiveIgnoredDomains;
    sinkClient.searchLinks = originalSearchLinks;
    sinkClient.createLink = originalCreateLink;
    sinkClient.getFullShortUrl = originalGetFullShortUrl;
  });

  it("converts tweet status URL to fixupx and skips Sink shorten API", async () => {
    const createLinkMock = mock(async () => ({
      success: true,
      link: {
        slug: "should-not-be-called",
        url: "https://x.com/jack/status/20",
      },
    }));
    sinkClient.createLink = createLinkMock as any;

    const mockDm = createMockDmChannel();
    const msg = createMockMessage(
      "체크해보세요: https://x.com/jack/status/20?s=20&t=xyz 입니다.",
      mockDm,
    );

    await onMessageCreate(msg);

    // Sink API should NOT have been called
    expect(createLinkMock).toHaveBeenCalledTimes(0);

    // DM should have been sent (DM Card + Replaced message)
    expect(sentDmCalls.length).toBe(2);

    // DM Card should have fixupx title and content
    const cardContent = JSON.stringify(sentDmCalls[0]);
    expect(cardContent).toContain("fixupx");
    expect(cardContent).toContain("`https://fixupx.com/jack/status/20`");

    // Replaced message should not contain the tracking query params
    expect(sentDmCalls[1].content).toBe(
      "체크해보세요: https://fixupx.com/jack/status/20 입니다.",
    );
    expect(sentDmCalls[1].content).not.toContain("?s=20");
  });

  it("ignores non-status Twitter URLs like profiles", async () => {
    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: "slug", url: "https://x.com/jack" },
    }));
    sinkClient.createLink = createLinkMock as any;

    const mockDm = createMockDmChannel();
    const msg = createMockMessage("프로필: https://x.com/jack 입니다.", mockDm);

    await onMessageCreate(msg);

    expect(createLinkMock).toHaveBeenCalledTimes(0);
    expect(sentDmCalls.length).toBe(0);
  });

  it("handles mixed messages: shortens regular URL and converts tweet URL", async () => {
    const createLinkMock = mock(async ({ url }: { url: string }) => ({
      success: true,
      link: { slug: "normal-short-slug", url },
    }));
    sinkClient.createLink = createLinkMock as any;

    const mockDm = createMockDmChannel();
    const longUrl =
      "https://example.com/some/very/long/path/that/exceeds/the/seventy/characters/minimum/length/requirement/for/snipsik";
    const tweetUrl = "https://twitter.com/author/status/987654321012345678";

    const msg = createMockMessage(
      `링크 1: ${longUrl}\n링크 2: ${tweetUrl}`,
      mockDm,
    );

    await onMessageCreate(msg);

    // Sink API only called for the regular long URL
    expect(createLinkMock).toHaveBeenCalledTimes(1);

    expect(sentDmCalls.length).toBe(2);
    expect(sentDmCalls[1].content).toContain(
      "https://s.japsik.com/normal-short-slug",
    );
    expect(sentDmCalls[1].content).toContain(
      "https://fixupx.com/author/status/987654321012345678",
    );
  });

  it("falls back to standard shortening when fixupxEnabled is false", async () => {
    guildConfigService.resolveEffectiveMinUrlLength = () => 30;
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: 30, // Short enough to capture this tweet link
      ignoredDomains: [],
      fixupxEnabled: false,
    });

    const createLinkMock = mock(async ({ url }: { url: string }) => ({
      success: true,
      link: { slug: "tweet-shortened-slug", url },
    }));
    sinkClient.createLink = createLinkMock as any;

    const mockDm = createMockDmChannel();
    const tweetUrl = "https://x.com/author/status/987654321012345678";
    const msg = createMockMessage(`트윗: ${tweetUrl}`, mockDm);

    await onMessageCreate(msg);

    // Should call createLink
    expect(createLinkMock).toHaveBeenCalledTimes(1);
    expect(sentDmCalls[1].content).toContain(
      "https://s.japsik.com/tweet-shortened-slug",
    );
  });
});
