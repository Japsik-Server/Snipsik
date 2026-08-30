import { describe, expect, it, mock, spyOn } from "bun:test";
import { sinkClient } from "@/services/sinkClient";
import { fetchUserDashboardStats } from "@/commands/link";
import { getUserHash } from "@/services/slugManager";

describe("SinkClient New API Tests", () => {
  it("should query a link using /api/link/query", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      expect(urlStr).toContain("/api/link/query?slug=my-test-slug");
      return new Response(
        JSON.stringify({
          data: {
            slug: "my-test-slug",
            url: "https://example.com",
            clicks: 42,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const res = await sinkClient.queryLink({ slug: "my-test-slug" });
      expect(res.success).toBe(true);
      expect(res.link?.slug).toBe("my-test-slug");
      expect(res.link?.url).toBe("https://example.com");
      expect(res.link?.clicks).toBe(42);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should search links using /api/link/search", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      expect(urlStr).toContain("/api/link/search");
      expect(urlStr).toContain("q=testUser");
      expect(urlStr).toContain("status=all");
      return new Response(
        JSON.stringify({
          list: [
            { slug: "link1-testUser", url: "https://example1.com", clicks: 10 },
            { slug: "link2-testUser", url: "https://example2.com", clicks: 20 },
          ],
          total: 2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const res = await sinkClient.searchLinks({
        q: "testUser",
        status: "all",
        limit: 100,
      });
      expect(res.success).toBe(true);
      expect(res.list.length).toBe(2);
      expect(res.total).toBe(2);
      expect(res.list[0]?.slug).toBe("link1-testUser");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should count links using /api/link/count", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      expect(urlStr).toContain("/api/link/count");
      expect(urlStr).toContain("status=active");
      return new Response(
        JSON.stringify({
          count: 15,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const res = await sinkClient.countLinks({
        q: "testUser",
        status: "active",
      });
      expect(res.success).toBe(true);
      expect(res.count).toBe(15);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should retrieve a link with getLink via fallback without listAllLinks full-scan", async () => {
    const originalFetch = globalThis.fetch;
    let directCalled = false;
    let queryCalled = false;

    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/link/fallback-slug")) {
        directCalled = true;
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          statusText: "Not Found",
        });
      }
      if (urlStr.includes("/api/link/query?slug=fallback-slug")) {
        queryCalled = true;
        return new Response(
          JSON.stringify({
            slug: "fallback-slug",
            url: "https://fallback.com",
            clicks: 5,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const res = await sinkClient.getLink("fallback-slug");
      expect(directCalled).toBe(true);
      expect(queryCalled).toBe(true);
      expect(res.success).toBe(true);
      expect(res.link?.slug).toBe("fallback-slug");
      expect(res.link?.url).toBe("https://fallback.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should cap listAllLinks pagination with maxPages", async () => {
    const originalFetch = globalThis.fetch;
    let pageRequests = 0;

    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      pageRequests++;
      return new Response(
        JSON.stringify({
          list: [{ slug: `link-${pageRequests}`, url: "https://example.com" }],
          total: 100000, // 100 pages of 1000
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    try {
      const res = await sinkClient.listAllLinks(undefined, 3);
      expect(res.success).toBe(true);
      expect(pageRequests).toBe(3); // should not exceed maxPages (3)
      expect(res.truncated).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Dashboard Stats Optimization Tests", () => {
  it("should calculate user dashboard statistics using count and search endpoints", async () => {
    const userId = "381920391829381920";
    const userHash = getUserHash(userId);

    const originalCount = sinkClient.countLinks;
    const originalSearch = sinkClient.searchLinks;

    sinkClient.countLinks = mock(async (params) => {
      if (params.status === "all")
        return { success: true, count: 5, status: 200 };
      if (params.status === "active")
        return { success: true, count: 4, status: 200 };
      if (params.status === "expired")
        return { success: true, count: 1, status: 200 };
      return { success: true, count: 0, status: 200 };
    });

    sinkClient.searchLinks = mock(async () => {
      return {
        success: true,
        list: [
          {
            slug: `test1-${userHash}`,
            url: "https://example1.com",
            clicks: 10,
            createdAt: new Date().toISOString(),
          },
          {
            slug: `test2-${userHash}`,
            url: "https://example2.com",
            clicks: 25,
            createdAt: new Date().toISOString(),
          },
          {
            slug: "other-user-hash", // not owned by this user
            url: "https://other.com",
            clicks: 999,
          },
        ],
        total: 2,
        status: 200,
      };
    });

    try {
      const stats = await fetchUserDashboardStats(userId);
      expect(stats.totalLinks).toBe(5);
      expect(stats.activeLinks).toBe(4);
      expect(stats.expiredLinks).toBe(1);
      expect(stats.totalClicks).toBe(35); // 10 + 25
      expect(stats.links.length).toBe(2);
      expect(stats.links.every((l) => l.slug.endsWith(`-${userHash}`))).toBe(
        true,
      );
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.searchLinks = originalSearch;
    }
  });
});
