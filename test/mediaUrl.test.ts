import { describe, expect, it } from "bun:test";
import { isAutoShortenExcludedMediaUrl } from "@/utils/mediaUrl";

describe("isAutoShortenExcludedMediaUrl", () => {
  it("excludes supported media hosts and their subdomains", () => {
    for (const host of [
      "tenor.com",
      "foo.tenor.com.",
      "giphy.com",
      "images.giphy.com",
      "gph.is",
      "cdn.discordapp.com",
      "media.discordapp.com",
      "images.discordapp.net.",
    ]) {
      expect(
        isAutoShortenExcludedMediaUrl(new URL(`https://${host}/image`)),
      ).toBe(true);
    }
  });

  it("matches GIF extensions case-insensitively regardless of query or hash", () => {
    expect(
      isAutoShortenExcludedMediaUrl(
        new URL("https://example.com/path/animation.GiF?size=large#preview"),
      ),
    ).toBe(true);
    expect(
      isAutoShortenExcludedMediaUrl(
        new URL("https://example.com/path/animation.gif/extra"),
      ),
    ).toBe(false);
  });

  it("does not match lookalike hosts or ordinary media formats", () => {
    for (const url of [
      "https://nottenor.com/image.gifx",
      "https://tenor.com.evil.example/image",
      "https://example.com/photo.png",
      "https://example.com/video.mp4",
      "https://discord.com/channels/1/2/3",
      "https://example.com/search?format=.gif",
    ]) {
      expect(isAutoShortenExcludedMediaUrl(new URL(url))).toBe(false);
    }
  });
});
