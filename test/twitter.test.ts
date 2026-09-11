import { describe, expect, it } from "bun:test";
import {
  convertToFixupxUrl,
  isTweetUrl,
  isTwitterDomain,
} from "@/utils/twitter";

describe("twitter utilities", () => {
  describe("isTwitterDomain", () => {
    it("recognizes official Twitter and X domains", () => {
      expect(isTwitterDomain("x.com")).toBe(true);
      expect(isTwitterDomain("X.COM")).toBe(true);
      expect(isTwitterDomain("twitter.com")).toBe(true);
      expect(isTwitterDomain("www.twitter.com")).toBe(true);
      expect(isTwitterDomain("mobile.twitter.com")).toBe(true);
      expect(isTwitterDomain("mobile.x.com")).toBe(true);
    });

    it("rejects non-Twitter domains and proxy domains", () => {
      expect(isTwitterDomain("fixupx.com")).toBe(false);
      expect(isTwitterDomain("fxtwitter.com")).toBe(false);
      expect(isTwitterDomain("vxtwitter.com")).toBe(false);
      expect(isTwitterDomain("google.com")).toBe(false);
      expect(isTwitterDomain("notx.com")).toBe(false);
      expect(isTwitterDomain("")).toBe(false);
    });
  });

  describe("isTweetUrl", () => {
    it("returns true for tweet status URLs", () => {
      expect(isTweetUrl("https://x.com/jack/status/20")).toBe(true);
      expect(
        isTweetUrl("https://twitter.com/user_name/status/1234567890123456789"),
      ).toBe(true);
      expect(isTweetUrl("https://mobile.x.com/foo/status/987654321")).toBe(
        true,
      );
      expect(
        isTweetUrl("https://x.com/user/status/123456789/photo/1?s=20&t=abc"),
      ).toBe(true);
      expect(isTweetUrl("https://twitter.com/i/web/status/123456")).toBe(true);
    });

    it("returns false for non-status Twitter URLs (profiles, search, settings, etc.)", () => {
      expect(isTweetUrl("https://x.com/jack")).toBe(false);
      expect(isTweetUrl("https://twitter.com/elonmusk")).toBe(false);
      expect(isTweetUrl("https://x.com/home")).toBe(false);
      expect(isTweetUrl("https://x.com/search?q=test")).toBe(false);
      expect(isTweetUrl("https://x.com/i/spaces/12345")).toBe(false);
      expect(isTweetUrl("https://x.com/settings")).toBe(false);
    });

    it("returns false for non-Twitter URLs or invalid URLs", () => {
      expect(isTweetUrl("https://example.com/user/status/123")).toBe(false);
      expect(isTweetUrl("not a url")).toBe(false);
    });
  });

  describe("convertToFixupxUrl", () => {
    it("converts x.com tweet status URL to fixupx.com", () => {
      const res = convertToFixupxUrl("https://x.com/jack/status/20");
      expect(res).toBe("https://fixupx.com/jack/status/20");
    });

    it("converts twitter.com tweet status URL to fixupx.com", () => {
      const res = convertToFixupxUrl(
        "https://twitter.com/user/status/1234567890",
      );
      expect(res).toBe("https://fixupx.com/user/status/1234567890");
    });

    it("converts mobile.twitter.com and preserves photo subpaths", () => {
      const res = convertToFixupxUrl(
        "https://mobile.twitter.com/user/status/12345/photo/1",
      );
      expect(res).toBe("https://fixupx.com/user/status/12345/photo/1");
    });

    it("strips tracking query parameters (s, t, ref_src, utm_*) and hash fragment", () => {
      const res = convertToFixupxUrl(
        "https://x.com/user/status/123?s=20&t=abcdef123&ref_src=twsrc%5Etfw&utm_source=share#top",
      );
      expect(res).toBe("https://fixupx.com/user/status/123");
    });

    it("returns null for non-status URLs", () => {
      expect(convertToFixupxUrl("https://x.com/jack")).toBeNull();
      expect(convertToFixupxUrl("https://github.com/foo/bar")).toBeNull();
    });
  });
});
