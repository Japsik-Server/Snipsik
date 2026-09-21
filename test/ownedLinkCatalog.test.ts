import { describe, expect, it } from "bun:test";
import {
  collectOwnedLinks,
  OWNED_LINK_PAGE_SIZE,
  type OwnedLinkPageFetcher,
} from "@/services/ownedLinkCatalog";
import type { SinkLink } from "@/types/sink";

const USER_HASH = "owner42";

function links(count: number, offset = 0, owned = true): SinkLink[] {
  return Array.from({ length: count }, (_, index) => ({
    slug: owned
      ? `link-${offset + index}-${USER_HASH}`
      : `link-${offset + index}-someone-else`,
    url: `https://example.com/${offset + index}`,
    clicks: offset + index,
    createdAt: Date.now() - offset - index,
  }));
}

describe("owned link catalog pagination", () => {
  it.each([0, 1, OWNED_LINK_PAGE_SIZE])(
    "returns a complete catalog for %i owned links",
    async (count) => {
      const fetchPage: OwnedLinkPageFetcher = async () => ({
        success: true,
        list: links(count),
        listComplete: true,
      });

      const result = await collectOwnedLinks(USER_HASH, { fetchPage });

      expect(result.success).toBe(true);
      expect(result.links).toHaveLength(count);
      expect(result.complete).toBe(true);
    },
  );

  it("follows the cursor and returns 1,001 owned links", async () => {
    const requestedCursors: Array<string | null | undefined> = [];
    const fetchPage: OwnedLinkPageFetcher = async (options) => {
      requestedCursors.push(options.cursor);
      if (!options.cursor) {
        return {
          success: true,
          list: links(1_000),
          cursor: "page-2",
          listComplete: false,
        };
      }
      return {
        success: true,
        list: links(1, 1_000),
        listComplete: true,
      };
    };

    const result = await collectOwnedLinks(USER_HASH, { fetchPage });

    expect(result.success).toBe(true);
    expect(result.links).toHaveLength(1_001);
    expect(result.complete).toBe(true);
    expect(requestedCursors).toEqual([null, "page-2"]);
  });

  it("caps a 2,001-link catalog at the newest 2,000 links", async () => {
    const fetchPage: OwnedLinkPageFetcher = async (options) => ({
      success: true,
      list: options.cursor ? links(1_000, 1_000) : links(1_000),
      cursor: options.cursor ? "page-3" : "page-2",
      listComplete: false,
    });

    const result = await collectOwnedLinks(USER_HASH, { fetchPage });

    expect(result.success).toBe(true);
    expect(result.links).toHaveLength(2_000);
    expect(result.complete).toBe(false);
    expect(result.scannedPages).toBe(2);
  });

  it("marks exactly 2,000 links complete when the second page is final", async () => {
    const fetchPage: OwnedLinkPageFetcher = async (options) => ({
      success: true,
      list: options.cursor ? links(1_000, 1_000) : links(1_000),
      cursor: options.cursor ? undefined : "page-2",
      listComplete: Boolean(options.cursor),
    });

    const result = await collectOwnedLinks(USER_HASH, { fetchPage });

    expect(result.success).toBe(true);
    expect(result.links).toHaveLength(2_000);
    expect(result.complete).toBe(true);
  });

  it("stops scanning after the configured page budget", async () => {
    const result = await collectOwnedLinks(USER_HASH, {
      maxPages: 2,
      fetchPage: async (options) => ({
        success: true,
        list: links(1, options.cursor ? 1 : 0),
        cursor: options.cursor ? "page-3" : "page-2",
        listComplete: false,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.links).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(result.scannedPages).toBe(2);
  });

  it("filters non-owned links and deduplicates slugs across pages", async () => {
    const duplicate = links(1)[0]!;
    const fetchPage: OwnedLinkPageFetcher = async (options) =>
      options.cursor
        ? {
            success: true,
            list: [duplicate, ...links(1, 1)],
            listComplete: true,
          }
        : {
            success: true,
            list: [duplicate, ...links(3, 100, false)],
            cursor: "page-2",
            listComplete: false,
          };

    const result = await collectOwnedLinks(USER_HASH, { fetchPage });

    expect(result.success).toBe(true);
    expect(result.links.map((link) => link.slug)).toEqual([
      duplicate.slug,
      `link-1-${USER_HASH}`,
    ]);
  });

  it("reapplies a case-insensitive tag filter to fallback page results", async () => {
    const result = await collectOwnedLinks(USER_HASH, {
      tag: "News",
      fetchPage: async () => ({
        success: true,
        list: [
          { ...links(1)[0]!, tags: ["breaking-news"] },
          { ...links(1, 1)[0]!, tags: ["NEWS"] },
          { ...links(1, 2)[0]!, tags: ["sports"] },
          { ...links(1, 3)[0]!, tags: undefined },
        ],
        listComplete: true,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.links.map((link) => link.slug)).toEqual([
      `link-0-${USER_HASH}`,
      `link-1-${USER_HASH}`,
    ]);
  });

  it("rejects an incomplete page without a next cursor", async () => {
    const result = await collectOwnedLinks(USER_HASH, {
      fetchPage: async () => ({
        success: true,
        list: links(10),
        listComplete: false,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("다음 커서");
  });

  it("rejects a repeated cursor", async () => {
    const result = await collectOwnedLinks(USER_HASH, {
      fetchPage: async () => ({
        success: true,
        list: links(1),
        cursor: "same-cursor",
        listComplete: false,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("반복");
    expect(result.scannedPages).toBe(2);
  });

  it("does not return a partial catalog after a later page fails", async () => {
    const result = await collectOwnedLinks(USER_HASH, {
      fetchPage: async (options) =>
        options.cursor
          ? { success: false, list: [], error: "page failed" }
          : {
              success: true,
              list: links(10),
              cursor: "page-2",
              listComplete: false,
            },
    });

    expect(result).toEqual({
      success: false,
      links: [],
      complete: false,
      scannedPages: 2,
      error: "page failed",
    });
  });

  it("preserves an empty error returned by the page fetcher", async () => {
    const result = await collectOwnedLinks(USER_HASH, {
      fetchPage: async () => ({ success: false, list: [], error: "" }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("");
  });
});
