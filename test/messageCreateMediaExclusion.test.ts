import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { onMessageCreate } from "@/events/messageCreate";
import { guildConfigService } from "@/services/guildConfigService";
import { sinkClient } from "@/services/sinkClient";
import { userConfigService } from "@/services/userConfigService";
import { watchService } from "@/services/watchService";

describe("messageCreate media URL exclusion", () => {
  const originalIsWatched = watchService.isWatched;
  const originalShouldProcessUser = userConfigService.shouldProcessUser;
  const originalGetUserConfig = userConfigService.getUserConfig;
  const originalResolveMinLength = guildConfigService.resolveEffectiveMinUrlLength;
  const originalSearchLinks = sinkClient.searchLinks;
  const originalCreateLink = sinkClient.createLink;
  const originalGetFullShortUrl = sinkClient.getFullShortUrl;

  beforeEach(() => {
    watchService.isWatched = () => true;
    userConfigService.shouldProcessUser = () => true;
    userConfigService.getUserConfig = () => ({
      autoDmMode: "inherit",
      dmFormat: "replace",
      autoShortenMinUrlLength: 0,
    });
    guildConfigService.resolveEffectiveMinUrlLength = () => 0;
    sinkClient.searchLinks = async () => ({
      success: true,
      list: [],
      total: 0,
      status: 200,
    });
    sinkClient.getFullShortUrl = (slug: string) =>
      `https://s.example.com/${slug}`;
  });

  afterEach(() => {
    watchService.isWatched = originalIsWatched;
    userConfigService.shouldProcessUser = originalShouldProcessUser;
    userConfigService.getUserConfig = originalGetUserConfig;
    guildConfigService.resolveEffectiveMinUrlLength = originalResolveMinLength;
    sinkClient.searchLinks = originalSearchLinks;
    sinkClient.createLink = originalCreateLink;
    sinkClient.getFullShortUrl = originalGetFullShortUrl;
  });

  const message = (content: string, send = mock(async () => ({
    flags: { has: () => true },
    suppressEmbeds: async () => {},
  }))) => ({
    author: {
      id: "123456789012345678",
      bot: false,
      tag: "Tester#0001",
      createDM: mock(async () => ({ send })),
    },
    guildId: "guild-media-test",
    guild: {},
    channelId: "channel-media-test",
    channel: { name: "test-channel" },
    content,
    url: "https://discord.com/channels/1/2/3",
  });

  it.each([
    "https://tenor.com/view/cat-gif-123",
    "https://media.tenor.com/abc123/animation.mp4",
    "https://cdn.discordapp.com/attachments/1/2/file.png?ex=signed&is=abc&hm=hash",
    "https://images-ext-1.discordapp.net/external/hash/https/example.com/image.png?width=640",
    "https://example.com/animation.GIF?size=large",
    "||https://example.com/spoiler.gif?x=1||",
    "(https://example.com/parenthesized.gif)",
  ])("does not search, create, or DM for media-only message: %s", async (url) => {
    const search = mock(async () => ({
      success: true,
      list: [],
      total: 0,
      status: 200,
    }));
    const create = mock(async () => ({
      success: true,
      link: { slug: "unused", url: "" },
    }));
    sinkClient.searchLinks = search;
    sinkClient.createLink = create;
    const msg = message(`Media: ${url}`);

    await onMessageCreate(msg as any);

    expect(search).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(msg.author.createDM).not.toHaveBeenCalled();
  });

  it("shortens only ordinary links and preserves media links in replacement", async () => {
    const search = mock(async () => ({
      success: true,
      list: [],
      total: 0,
      status: 200,
    }));
    sinkClient.searchLinks = search;
    const create = mock(async () => ({
      success: true,
      link: { slug: "ordinary", url: "https://example.com/article" },
    }));
    sinkClient.createLink = create;
    const send = mock(async (payload: any) => ({
      flags: { has: () => true },
      suppressEmbeds: async () => {},
      payload,
    }));
    const gif = "https://cdn.discordapp.com/file.GIF?size=1024";
    const msg = message(`See ${gif} and https://example.com/article`, send);

    await onMessageCreate(msg as any);

    expect(create).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0].url).toBe("https://example.com/article");
    expect(create.mock.calls[0][0].url).toBe("https://example.com/article");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].content).toBe(
      `See ${gif} and https://s.example.com/ordinary`,
    );
  });
});
