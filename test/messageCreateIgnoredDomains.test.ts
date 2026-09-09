import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { onMessageCreate } from "@/events/messageCreate";
import { watchService } from "@/services/watchService";
import { userConfigService } from "@/services/userConfigService";
import { guildConfigService } from "@/services/guildConfigService";
import { sinkClient } from "@/services/sinkClient";
import { getUserHash } from "@/services/slugManager";

describe("MessageCreate Ignored Domains Filtering (Issue #21)", () => {
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
  const testUserHash = getUserHash(testUserId);
  const testGuildId = "guild-ignore-test";
  const testChannelId = "channel-ignore-test";

  beforeEach(() => {
    watchService.isChannelWatched = () => true;
    userConfigService.shouldProcessUser = () => true;
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: 0, // shorten all lengths
      ignoredDomains: [],
    });
    guildConfigService.resolveEffectiveMinUrlLength = () => 0;
    guildConfigService.resolveEffectiveIgnoredDomains = () =>
      new Set([
        "tenor.com",
        "giphy.com",
        "cdn.discordapp.com",
        "media.discordapp.net",
        "imgur.com",
      ]);
    sinkClient.getFullShortUrl = (slug: string) =>
      `https://s.japsik.com/${slug}`;
    sinkClient.searchLinks = async () => ({
      success: true,
      list: [],
      total: 0,
      status: 200,
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

  it("ignores Tenor GIF links and does not send any DM", async () => {
    const createLinkMock = mock(async () => ({
      success: true,
      link: {
        slug: "slug-tenor",
        url: "https://tenor.com/view/funny-cat-12345",
      },
    }));
    sinkClient.createLink = createLinkMock;

    let dmSent = false;
    const mockDmChannel = {
      send: mock(async () => {
        dmSent = true;
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {},
        };
      }),
    };

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: "general" },
      content: "Here is a gif https://tenor.com/view/funny-cat-gif-12345",
      url: "https://discord.com/channels/1/2/3",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).not.toHaveBeenCalled();
    expect(dmSent).toBe(false);
  });

  it("ignores Discord CDN media links and does not send any DM", async () => {
    const createLinkMock = mock(async () => ({
      success: true,
      link: {
        slug: "slug-discord",
        url: "https://cdn.discordapp.com/attachments/1/2/test.gif",
      },
    }));
    sinkClient.createLink = createLinkMock;

    let dmSent = false;
    const mockDmChannel = {
      send: mock(async () => {
        dmSent = true;
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {},
        };
      }),
    };

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: "general" },
      content:
        "Check attachment https://cdn.discordapp.com/attachments/1/2/test.gif",
      url: "https://discord.com/channels/1/2/3",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).not.toHaveBeenCalled();
    expect(dmSent).toBe(false);
  });

  it("ignores Discord media proxy links and Giphy links", async () => {
    const createLinkMock = mock(async () => ({
      success: true,
      link: {
        slug: "slug-proxy",
        url: "https://media.discordapp.net/attachments/1/2/test.gif",
      },
    }));
    sinkClient.createLink = createLinkMock;

    let dmSent = false;
    const mockDmChannel = {
      send: mock(async () => {
        dmSent = true;
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {},
        };
      }),
    };

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: "general" },
      content:
        "https://media.discordapp.net/attachments/1/2/test.gif and https://giphy.com/gifs/funny-cat",
      url: "https://discord.com/channels/1/2/3",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).not.toHaveBeenCalled();
    expect(dmSent).toBe(false);
  });

  it("shortens valid URL while ignoring GIF link in the same message, keeping GIF intact in replaced text", async () => {
    const normalUrl = "https://example.com/very/important/article";
    const gifUrl = "https://tenor.com/view/celebrate-gif-999";
    const createdSlug = `created-${testUserHash}`;

    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: createdSlug, url: normalUrl },
    }));
    sinkClient.createLink = createLinkMock;

    const sentPayloads: any[] = [];
    const mockDmChannel = {
      send: mock(async (payload: any) => {
        sentPayloads.push(payload);
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {},
        };
      }),
    };

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: "general" },
      content: `Read this: ${normalUrl} and enjoy this: ${gifUrl}`,
      url: "https://discord.com/channels/1/2/3",
    };

    await onMessageCreate(mockMessage as any);

    // Only 1 short link created (for normalUrl)
    expect(createLinkMock).toHaveBeenCalledTimes(1);
    expect(createLinkMock).toHaveBeenCalledWith({
      url: normalUrl,
      slug: expect.stringContaining(testUserHash),
    });

    // 2 DM messages sent: card + replaced text
    expect(sentPayloads.length).toBe(2);
    const replacedTextChunk = sentPayloads[1].content;

    // normalUrl was replaced with short link
    expect(replacedTextChunk).toContain(`https://s.japsik.com/${createdSlug}`);
    // gifUrl remains intact in original form
    expect(replacedTextChunk).toContain(gifUrl);
  });

  it("respects custom guild and user ignored domains", async () => {
    guildConfigService.resolveEffectiveIgnoredDomains = () =>
      new Set(["tenor.com", "custom-stream.tv"]);

    const createLinkMock = mock(async () => ({
      success: true,
      link: { slug: "slug-custom", url: "https://custom-stream.tv/clip/123" },
    }));
    sinkClient.createLink = createLinkMock;

    let dmSent = false;
    const mockDmChannel = {
      send: mock(async () => {
        dmSent = true;
        return {
          flags: { has: () => true },
          suppressEmbeds: async () => {},
        };
      }),
    };

    const mockMessage = {
      author: {
        id: testUserId,
        bot: false,
        tag: "Tester#0001",
        createDM: async () => mockDmChannel,
      },
      guildId: testGuildId,
      guild: {},
      channelId: testChannelId,
      channel: { name: "general" },
      content: "Watch this: https://sub.custom-stream.tv/clip/123",
      url: "https://discord.com/channels/1/2/3",
    };

    await onMessageCreate(mockMessage as any);

    expect(createLinkMock).not.toHaveBeenCalled();
    expect(dmSent).toBe(false);
  });
});
