import { describe, expect, it, mock } from "bun:test";
import { SinkClient, sinkClient } from "@/services/sinkClient";
import { fetchUserDashboardStats } from "@/commands/link";
import { getUserHash } from "@/services/slugManager";

describe("SinkClient New API Tests", () => {
  it("should query a link using /api/link/query", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      requestedUrl = String(url);
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
      expect(requestedUrl).toContain("/api/link/query?slug=my-test-slug");
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
    let requestedUrl = "";
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({
          list: [
            { slug: "link1-testUser", url: "https://example1.com", clicks: 10 },
            { slug: "link2-testUser", url: "https://example2.com", clicks: 20 },
          ],
          total: 2,
          cursor: "next-search-page",
          list_complete: false,
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
      expect(requestedUrl).toContain("/api/link/search");
      expect(requestedUrl).toContain("q=testUser");
      expect(requestedUrl).toContain("status=all");
      expect(res.success).toBe(true);
      expect(res.list.length).toBe(2);
      expect(res.total).toBe(2);
      expect(res.cursor).toBe("next-search-page");
      expect(res.listComplete).toBe(false);
      expect(res.list[0]?.slug).toBe("link1-testUser");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should count links using /api/link/count", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      requestedUrl = String(url);
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
      expect(requestedUrl).toContain("/api/link/count");
      expect(requestedUrl).toContain("status=active");
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

  it("should find exact match in search fallback when other search results exist", async () => {
    const originalFetch = globalThis.fetch;
    let searchUrl = "";

    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/link/my-target")) {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
        });
      }
      if (urlStr.includes("/api/link/query?slug=my-target")) {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
        });
      }
      if (urlStr.includes("/api/link/search")) {
        searchUrl = urlStr;
        return new Response(
          JSON.stringify({
            list: [
              { slug: "my-target-other", url: "https://other.com" },
              { slug: "my-target", url: "https://correct.com" },
            ],
            total: 2,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const res = await sinkClient.getLink("my-target");
      expect(searchUrl).toContain("limit=10");
      expect(res.success).toBe(true);
      expect(res.link?.slug).toBe("my-target");
      expect(res.link?.url).toBe("https://correct.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should cap listAllLinks pagination with maxPages", async () => {
    const originalFetch = globalThis.fetch;
    let pageRequests = 0;

    globalThis.fetch = mock(async () => {
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

  it("preserves outer list metadata when links are wrapped in data", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [{ slug: "one", url: "https://example.com/one" }],
            total: 42,
            cursor: "next-page",
          }),
          { status: 200 },
        ),
    });

    const result = await client.listLinks();
    expect(result.success).toBe(true);
    expect(result.list).toHaveLength(1);
    expect(result.total).toBe(42);
    expect(result.cursor).toBe("next-page");
  });

  it("supports the official cursor list contract", async () => {
    const requestedUrls: string[] = [];
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        const secondPage = String(url).includes("cursor=page-2");
        return new Response(
          JSON.stringify({
            links: [
              {
                slug: secondPage ? "two" : "one",
                url: `https://example.com/${secondPage ? "two" : "one"}`,
              },
            ],
            cursor: secondPage ? null : "page-2",
            list_complete: secondPage,
          }),
          { status: 200 },
        );
      },
    });

    const result = await client.listAllLinks(undefined, 3);
    expect(result.success).toBe(true);
    expect(result.list.map((link) => link.slug)).toEqual(["one", "two"]);
    expect(result.truncated).toBe(false);
    expect(requestedUrls[1]).toContain("cursor=page-2");
  });

  it("does not discard cursor and filters through a bare-list fallback", async () => {
    const requestedUrls: string[] = [];
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        return new Response(JSON.stringify({ error: "page failed" }), {
          status: 502,
        });
      },
    });

    const result = await client.listLinks({
      cursor: "page-2",
      tag: "news",
      status: "all",
      sort: "newest",
      limit: 1_000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("page failed");
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("cursor=page-2");
    expect(requestedUrls[0]).toContain("tag=news");
  });

  it("retains the bare-list fallback for an unfiltered first page", async () => {
    const requestedUrls: string[] = [];
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        if (String(url).includes("?limit=")) {
          return new Response(JSON.stringify({ error: "unsupported query" }), {
            status: 400,
          });
        }
        return new Response(
          JSON.stringify({
            links: [{ slug: "fallback", url: "https://example.com/fallback" }],
          }),
          { status: 200 },
        );
      },
    });

    const result = await client.listLinks(undefined, 1, 1_000);

    expect(result.success).toBe(true);
    expect(result.list.map((link) => link.slug)).toEqual(["fallback"]);
    expect(requestedUrls).toEqual([
      "https://sink.example/api/link/list?limit=1000",
      "https://sink.example/api/link/list",
    ]);
  });

  it("rejects incomplete successful link responses", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    const created = await client.createLink({
      slug: "requested-slug",
      url: "https://example.com",
    });
    expect(created.success).toBe(false);
    expect(created.error).toContain("Invalid Sink response contract");

    const queried = await client.queryLink({ slug: "requested-slug" });
    expect(queried.success).toBe(false);
    expect(queried.status).toBe(502);
  });

  it("rejects malformed list metadata on a 2xx response", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            links: [{ slug: "one", url: "https://example.com/one" }],
            cursor: 123,
            list_complete: "no",
          }),
          { status: 200 },
        ),
    });

    const result = await client.listLinks();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid Sink response contract");
  });

  it("accepts a valid fallback DELETE acknowledgment", async () => {
    const requestedMethods: string[] = [];
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      fetchImpl: async (url, init) => {
        requestedMethods.push(`${init?.method} ${String(url)}`);
        if (init?.method === "GET") {
          return new Response(
            JSON.stringify({ slug: "delete-me", url: "https://example.com" }),
            { status: 200 },
          );
        }
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ error: "Not Found" }), {
            status: 404,
          });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      },
    });

    const result = await client.deleteLink("delete-me");
    expect(result.success).toBe(true);
    expect(requestedMethods).toContain(
      "DELETE https://sink.example/api/link/delete-me",
    );
  });

  it("rejects malformed fallback DELETE acknowledgments", async () => {
    for (const malformedBody of [{ success: false }, "deleted"]) {
      const client = new SinkClient({
        baseUrl: "https://sink.example",
        token: "test-token",
        fetchImpl: async (_url, init) => {
          if (init?.method === "GET") {
            return new Response(
              JSON.stringify({ slug: "delete-me", url: "https://example.com" }),
              { status: 200 },
            );
          }
          if (init?.method === "POST") {
            return new Response(JSON.stringify({ error: "Not Found" }), {
              status: 404,
            });
          }
          return new Response(JSON.stringify(malformedBody), { status: 200 });
        },
      });

      const result = await client.deleteLink("delete-me");
      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "Invalid Sink response contract for /api/link/delete-me",
      );
    }
  });

  it("times out while waiting for response headers and allows a later request", async () => {
    let calls = 0;
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      requestTimeoutMs: 20,
      fetchImpl: async (_url, init) => {
        calls++;
        if (calls === 1) {
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        }
        return new Response(
          JSON.stringify({ slug: "later", url: "https://example.com/later" }),
          { status: 200 },
        );
      },
    });

    const timedOut = await client.queryLink({ slug: "first" });
    expect(timedOut.success).toBe(false);
    expect(timedOut.error).toContain("timed out");

    const later = await client.queryLink({ slug: "later" });
    expect(later.success).toBe(true);
    expect(later.link?.slug).toBe("later");
  });

  it("times out while reading a stalled response body", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      requestTimeoutMs: 20,
      fetchImpl: async (_url, init) => {
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          },
        });
        return new Response(body, { status: 200 });
      },
    });

    const result = await client.queryLink({ slug: "slow-body" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("does not retry a timed-out mutation", async () => {
    let calls = 0;
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "test-token",
      requestTimeoutMs: 20,
      fetchImpl: async (_url, init) => {
        calls++;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const result = await client.updateLink("slug", {
      url: "https://example.com/new",
    });
    expect(result.success).toBe(false);
    expect(calls).toBe(1);
  });
});

describe("Dashboard Stats Optimization Tests", () => {
  it("uses complete cursor records as the dashboard aggregation basis", async () => {
    const userId = "381920391829381920";
    const userHash = getUserHash(userId);

    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;

    sinkClient.countLinks = mock(async (params) => {
      if (params.status === "all")
        return { success: true, count: 5, status: 200 };
      if (params.status === "active")
        return { success: true, count: 4, status: 200 };
      if (params.status === "expired")
        return { success: true, count: 1, status: 200 };
      return { success: true, count: 0, status: 200 };
    });

    sinkClient.listLinks = mock(async () => {
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
        total: 3,
        listComplete: true,
      };
    });

    try {
      const stats = await fetchUserDashboardStats(userId);
      expect(stats.totalLinks).toBe(2);
      expect(stats.activeLinks).toBe(2);
      expect(stats.expiredLinks).toBe(0);
      expect(stats.totalClicks).toBe(35);
      expect(stats.displayedLinks).toBe(2);
      expect(stats.linksComplete).toBe(true);
      expect(stats.links.length).toBe(2);
      expect(stats.links.every((l) => l.slug.endsWith(`-${userHash}`))).toBe(
        true,
      );
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
    }
  });

  it("uses count endpoints and labels statistics when the catalog is capped", async () => {
    const userId = "481920391829381920";
    const userHash = getUserHash(userId);

    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;

    sinkClient.countLinks = mock(async (params) => {
      if (params.status === "all")
        return { success: true, count: 2_500, status: 200 };
      if (params.status === "active")
        return { success: true, count: 2_000, status: 200 };
      return { success: true, count: 500, status: 200 };
    });

    sinkClient.listLinks = mock(async (options) => {
      const offset = options && typeof options === "object" && options.cursor
        ? 1_000
        : 0;
      return {
        success: true,
        list: Array.from({ length: 1_000 }, (_, index) => ({
          slug: `link-${offset + index}-${userHash}`,
          url: `https://example.com/${offset + index}`,
          clicks: 1,
        })),
        total: 2_500,
        cursor: offset === 0 ? "page-2" : "page-3",
        listComplete: false,
      };
    });

    try {
      const stats = await fetchUserDashboardStats(userId);
      expect(stats.totalLinks).toBe(2_500);
      expect(stats.activeLinks).toBe(2_000);
      expect(stats.expiredLinks).toBe(500);
      expect(stats.totalClicks).toBe(2_000);
      expect(stats.displayedLinks).toBe(2_000);
      expect(stats.linksComplete).toBe(false);
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
    }
  });

  it("should match user links case-insensitively in fetchUserDashboardStats", async () => {
    const userId = "581920391829381920";
    const userHash = getUserHash(userId);

    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;

    sinkClient.countLinks = mock(async () => ({
      success: true,
      count: 2,
      status: 200,
    }));

    sinkClient.listLinks = mock(async () => ({
      success: true,
      list: [
        {
          slug: `UPPER-${userHash.toUpperCase()}`,
          url: "https://example-upper.com",
          clicks: 5,
        },
        {
          slug: `lower-${userHash.toLowerCase()}`,
          url: "https://example-lower.com",
          clicks: 10,
        },
      ],
      total: 2,
      listComplete: true,
    }));

    try {
      const stats = await fetchUserDashboardStats(userId);
      expect(stats.links.length).toBe(2);
      expect(stats.totalClicks).toBe(15);
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
    }
  });
});
