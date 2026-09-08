import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SYSTEM_IGNORED_DOMAINS,
  MAX_CUSTOM_IGNORED_DOMAINS,
  getAllSystemDefaultDomains,
  isDomainIgnored,
  isSystemDefaultDomain,
  normalizeDomain,
} from "@/utils/domain";

describe("normalizeDomain", () => {
  it("normalizes basic domains", () => {
    expect(normalizeDomain("tenor.com")).toBe("tenor.com");
    expect(normalizeDomain("  GIPHY.COM  ")).toBe("giphy.com");
    expect(normalizeDomain("*.tenor.com")).toBe("tenor.com");
  });

  it("extracts hostname from full URLs", () => {
    expect(normalizeDomain("https://tenor.com/view/cat-12345")).toBe(
      "tenor.com",
    );
    expect(
      normalizeDomain(
        "http://media.discordapp.net:8080/attachments/1?v=1#hash",
      ),
    ).toBe("media.discordapp.net");
    expect(normalizeDomain("//cdn.discordapp.com/icons/abc.png")).toBe(
      "cdn.discordapp.com",
    );
  });

  it("handles domain with port, path, or query without protocol", () => {
    expect(normalizeDomain("example.com:3000/path?query=1")).toBe(
      "example.com",
    );
    expect(normalizeDomain("sub.domain.org/")).toBe("sub.domain.org");
  });

  it("rejects invalid domains", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
    expect(normalizeDomain("not-a-domain")).toBeNull();
    expect(normalizeDomain("invalid domain.com")).toBeNull();
    expect(normalizeDomain("-invalid.com")).toBeNull();
    expect(normalizeDomain("invalid-.com")).toBeNull();
    expect(normalizeDomain("abc..com")).toBeNull();
    expect(normalizeDomain("123.456")).toBeNull();
  });
});

describe("isDomainIgnored", () => {
  const ignored = ["tenor.com", "giphy.com", "cdn.discordapp.com"];

  it("matches exact domains", () => {
    expect(isDomainIgnored("tenor.com", ignored)).toBe(true);
    expect(isDomainIgnored("https://giphy.com/gifs/123", ignored)).toBe(true);
    expect(
      isDomainIgnored("https://cdn.discordapp.com/attachments/1/2", ignored),
    ).toBe(true);
  });

  it("matches subdomains automatically", () => {
    expect(isDomainIgnored("c.tenor.com", ignored)).toBe(true);
    expect(isDomainIgnored("https://media.tenor.com/view/123", ignored)).toBe(
      true,
    );
    expect(isDomainIgnored("https://i.giphy.com/media/abc", ignored)).toBe(
      true,
    );
  });

  it("does not match unrelated domains with common substring (anti-false positive)", () => {
    expect(isDomainIgnored("nottenor.com", ignored)).toBe(false);
    expect(isDomainIgnored("https://mytenor.com/view", ignored)).toBe(false);
    expect(isDomainIgnored("faketenor.com", ignored)).toBe(false);
    expect(isDomainIgnored("discordapp.com", ignored)).toBe(false); // only cdn.discordapp.com in ignored list
  });
});

describe("isSystemDefaultDomain & getAllSystemDefaultDomains", () => {
  it("includes all default media/GIF domains", () => {
    const all = getAllSystemDefaultDomains();
    for (const d of DEFAULT_SYSTEM_IGNORED_DOMAINS) {
      expect(all).toContain(d);
      expect(isSystemDefaultDomain(d)).toBe(true);
    }
  });

  it("recognizes subdomains of system default domains", () => {
    expect(isSystemDefaultDomain("media.tenor.com")).toBe(true);
    expect(isSystemDefaultDomain("https://c.tenor.com/view/1")).toBe(true);
    expect(isSystemDefaultDomain("i.imgur.com")).toBe(true);
  });

  it("returns false for non-default domains", () => {
    expect(isSystemDefaultDomain("google.com")).toBe(false);
    expect(isSystemDefaultDomain("github.com")).toBe(false);
  });
});
