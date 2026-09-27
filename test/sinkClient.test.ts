import { describe, expect, it, mock } from "bun:test";
import { SinkClient, sinkClient } from "@/services/sinkClient";
import { fetchUserDashboardStats } from "@/commands/link";
import { getUserHash } from "@/services/slugManager";

const TEST_TOKEN = process.env.SINK_TOKEN ?? "";

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
      // Sink never returns a click count on the link record; it lives in the
      // analytics dataset and is attached separately by attachClickCounts.
      expect(res.link?.clicks).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should ignore a clicks field that Sink does not actually send", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            slug: "phantom-clicks",
            url: "https://example.com",
            clicks: 42,
            views: 7,
          }),
          { status: 200 },
        ),
    });

    const res = await client.queryLink({ slug: "phantom-clicks" });
    expect(res.success).toBe(true);
    expect(res.link?.clicks).toBeUndefined();
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

  it("should retrieve a link with getLink using queryLink as primary without calling legacy endpoints", async () => {
    const originalFetch = globalThis.fetch;
    let directCalled = false;
    let queryCalled = false;

    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/link/primary-slug")) {
        directCalled = true;
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          statusText: "Not Found",
        });
      }
      if (urlStr.includes("/api/link/query?slug=primary-slug")) {
        queryCalled = true;
        return new Response(
          JSON.stringify({
            slug: "primary-slug",
            url: "https://primary.com",
            clicks: 5,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const res = await sinkClient.getLink("primary-slug");
      expect(queryCalled).toBe(true);
      expect(directCalled).toBe(false);
      expect(res.success).toBe(true);
      expect(res.link?.slug).toBe("primary-slug");
      expect(res.link?.url).toBe("https://primary.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should fall back to legacy direct endpoint when query and search fail", async () => {
    const originalFetch = globalThis.fetch;
    let directCalled = false;
    let queryCalled = false;
    let searchCalled = false;

    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/link/query?slug=legacy-slug")) {
        queryCalled = true;
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
        });
      }
      if (urlStr.includes("/api/link/search")) {
        searchCalled = true;
        return new Response(JSON.stringify({ list: [], total: 0 }), {
          status: 200,
        });
      }
      if (urlStr.includes("/api/link/legacy-slug")) {
        directCalled = true;
        return new Response(
          JSON.stringify({
            slug: "legacy-slug",
            url: "https://legacy.com",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const res = await sinkClient.getLink("legacy-slug");
      expect(queryCalled).toBe(true);
      expect(searchCalled).toBe(true);
      expect(directCalled).toBe(true);
      expect(res.success).toBe(true);
      expect(res.link?.slug).toBe("legacy-slug");
      expect(res.link?.url).toBe("https://legacy.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should gracefully handle HTML SPA responses on legacy direct endpoint without 502 contract abort", async () => {
    const originalFetch = globalThis.fetch;
    let queryCalled = false;
    let legacyCalled = false;

    globalThis.fetch = mock(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/link/query?slug=html-slug")) {
        queryCalled = true;
        return new Response(JSON.stringify({ error: "Link not found" }), {
          status: 404,
        });
      }
      if (urlStr.includes("/api/link/search")) {
        return new Response(JSON.stringify({ list: [], total: 0 }), {
          status: 200,
        });
      }
      if (urlStr.includes("/api/link/html-slug")) {
        legacyCalled = true;
        return new Response(
          "<!DOCTYPE html><html><body>SPA Frontend</body></html>",
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const res = await sinkClient.getLink("html-slug");
      expect(queryCalled).toBe(true);
      expect(legacyCalled).toBe(true);
      expect(res.success).toBe(false);
      expect(res.status).toBe(404);
      expect(res.error).toBe("Link not found");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should reject invalid slugs (empty, whitespace, or too long) before making network requests in getLink and deleteLink", async () => {
    let networkCalled = false;
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () => {
        networkCalled = true;
        return new Response("{}", { status: 200 });
      },
    });

    const invalidSlugs = ["", "   ", "/", "/  ", "a".repeat(101)];
    for (const invalidSlug of invalidSlugs) {
      networkCalled = false;
      const getRes = await client.getLink(invalidSlug);
      expect(getRes.success).toBe(false);
      expect(getRes.status).toBe(400);
      expect(getRes.error).toBe("잘못된 슬러그입니다.");
      expect(networkCalled).toBe(false);

      const delRes = await client.deleteLink(invalidSlug);
      expect(delRes.success).toBe(false);
      expect(delRes.error).toBe("잘못된 슬러그입니다.");
      expect(networkCalled).toBe(false);
    }
  });

  it("should reject 200 OK responses containing HTML content in request()", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () =>
        new Response("<!DOCTYPE html><html><body>Not an API</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    });

    const res = await client.createLink({
      slug: "test",
      url: "https://example.com",
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("unexpected HTML response");
  });

  it("should successfully delete a link when getLink pre-check succeeds via queryLink", async () => {
    const requestedCalls: string[] = [];
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url, init) => {
        const method = init?.method ?? "GET";
        const urlStr = String(url);
        requestedCalls.push(`${method} ${urlStr}`);

        if (
          method === "GET" &&
          urlStr.includes("/api/link/query?slug=to-delete")
        ) {
          return new Response(
            JSON.stringify({
              slug: "to-delete",
              url: "https://example.com/target",
            }),
            { status: 200 },
          );
        }
        if (method === "POST" && urlStr.includes("/api/link/delete")) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          });
        }
        return new Response("{}", { status: 404 });
      },
    });

    const res = await client.deleteLink("to-delete");
    expect(res.success).toBe(true);
    expect(requestedCalls).toEqual([
      "GET https://sink.example/api/link/query?slug=to-delete",
      "POST https://sink.example/api/link/delete",
    ]);
  });

  it("should return not-found error message when deleteLink target does not exist even if legacy endpoint returns HTML", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url, init) => {
        const method = init?.method ?? "GET";
        const urlStr = String(url);

        if (method === "GET") {
          if (urlStr.includes("/api/link/query?slug=ghost-slug")) {
            return new Response(JSON.stringify({ error: "Link not found" }), {
              status: 404,
            });
          }
          if (urlStr.includes("/api/link/search")) {
            return new Response(JSON.stringify({ list: [], total: 0 }), {
              status: 200,
            });
          }
          if (urlStr.includes("/api/link/ghost-slug")) {
            // Nuxt catch-all returning 200 OK HTML
            return new Response(
              "<!DOCTYPE html><html><body>SPA</body></html>",
              {
                status: 200,
                headers: { "Content-Type": "text/html" },
              },
            );
          }
        }
        return new Response("{}", { status: 404 });
      },
    });

    const res = await client.deleteLink("ghost-slug");
    expect(res.success).toBe(false);
    expect(res.error).toContain(
      "단축 링크 '/ghost-slug'을(를) 찾을 수 없습니다.",
    );
  });

  it("should fast-fail getLink on auth errors (401/403) or network failure (0) without running fallbacks", async () => {
    for (const testStatus of [401, 403, 0]) {
      const requestedUrls: string[] = [];
      const client = new SinkClient({
        baseUrl: "https://sink.example",
        token: TEST_TOKEN,
        fetchImpl: async (url) => {
          requestedUrls.push(String(url));
          if (testStatus === 0) {
            throw new Error("Network unreachable");
          }
          return new Response(JSON.stringify({ error: "Auth failure" }), {
            status: testStatus,
          });
        },
      });

      const res = await client.getLink("auth-fail-slug");
      expect(res.success).toBe(false);
      expect(res.status).toBe(testStatus);
      expect(requestedUrls).toEqual([
        "https://sink.example/api/link/query?slug=auth-fail-slug",
      ]);
    }
  });

  it("should sanitize HTML error response on 500 status in request()", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () =>
        new Response(
          "<html><head><title>500 Internal</title></head><body>Crash</body></html>",
          {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "Content-Type": "text/html" },
          },
        ),
    });

    const res = await client.getStats("some-slug");
    expect(res.success).toBe(false);
    expect(res.error).toBe(
      "HTTP 500: Internal Server Error (HTML error response)",
    );
  });

  it("should report fallback error over original 404 in deleteLink when fallback fails", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url, init) => {
        const method = init?.method ?? "GET";
        const urlStr = String(url);
        if (method === "GET") {
          return new Response(
            JSON.stringify({
              slug: "fallback-target",
              url: "https://example.com",
            }),
            { status: 200 },
          );
        }
        if (method === "POST") {
          return new Response(JSON.stringify({ error: "Endpoint Not Found" }), {
            status: 404,
          });
        }
        if (method === "DELETE") {
          return new Response(
            JSON.stringify({ error: "Fallback permission denied" }),
            {
              status: 403,
            },
          );
        }
        return new Response("{}", { status: 404 });
      },
    });

    const res = await client.deleteLink("fallback-target");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Fallback permission denied");
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
      token: TEST_TOKEN,
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
      token: TEST_TOKEN,
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
      token: TEST_TOKEN,
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
      token: TEST_TOKEN,
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
      token: TEST_TOKEN,
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
      token: TEST_TOKEN,
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
      token: TEST_TOKEN,
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
        token: TEST_TOKEN,
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
      token: TEST_TOKEN,
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
      token: TEST_TOKEN,
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
      token: TEST_TOKEN,
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
            id: "link-id-1",
            slug: `test1-${userHash}`,
            url: "https://example1.com",
            createdAt: new Date().toISOString(),
          },
          {
            id: "link-id-2",
            slug: `test2-${userHash}`,
            url: "https://example2.com",
            createdAt: new Date().toISOString(),
          },
          {
            id: "link-id-3",
            slug: "other-user-hash", // not owned by this user
            url: "https://other.com",
          },
        ],
        total: 3,
        listComplete: true,
      };
    });

    const originalCounters = sinkClient.getCountersByIds;
    sinkClient.getCountersByIds = mock(async () => ({
      success: true,
      counters: new Map([
        ["link-id-1", 10],
        ["link-id-2", 25],
        ["link-id-3", 999],
      ]),
    }));

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
      sinkClient.getCountersByIds = originalCounters;
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
      const offset =
        options && typeof options === "object" && options.cursor ? 1_000 : 0;
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

describe("Sink Analytics Tests", () => {
  it("fetches click counters for many links in a single request", async () => {
    const requestedCalls: string[] = [];
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url, init) => {
        requestedCalls.push(`${init?.method ?? "GET"} ${String(url)}`);
        return new Response(
          JSON.stringify({
            data: [
              { id: "id-a", visits: 12, visitors: 8, referers: 3 },
              { id: "id-b", visits: 0, visitors: 0, referers: 0 },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const res = await client.getCountersByIds(["id-a", "id-b", "id-a"]);
    expect(res.success).toBe(true);
    expect(res.counters.get("id-a")).toBe(12);
    expect(res.counters.get("id-b")).toBe(0);
    expect(requestedCalls).toEqual([
      "GET https://sink.example/api/stats/counters?id=id-a%2Cid-b",
    ]);
  });

  it("treats an empty analytics payload as a valid empty result", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      // Sink answers { data: [] } when the instance has no Cloudflare credentials.
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
    });

    const res = await client.getCountersByIds(["id-a"]);
    expect(res.success).toBe(true);
    expect(res.counters.size).toBe(0);
  });

  it("skips the request entirely when no ids are given", async () => {
    let calls = 0;
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () => {
        calls++;
        return new Response("{}", { status: 200 });
      },
    });

    const res = await client.getCountersByIds([]);
    expect(res.success).toBe(true);
    expect(res.counters.size).toBe(0);
    expect(calls).toBe(0);
  });

  it("splits large id sets into batched requests", async () => {
    const requestedIds: string[] = [];
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url) => {
        const idParam = new URL(String(url)).searchParams.get("id") ?? "";
        requestedIds.push(idParam);
        return new Response(
          JSON.stringify({
            data: idParam.split(",").map((id) => ({ id, visits: 1 })),
          }),
          { status: 200 },
        );
      },
    });

    // Use maximum-length ids so the byte budget, not the item count, is what
    // forces the split.
    const ids = Array.from(
      { length: 401 },
      (_, i) => `l${String(i).padStart(3, "0")}abcdefghijklmnopqrstu`,
    );
    const res = await client.getCountersByIds(ids);
    expect(res.success).toBe(true);
    expect(res.counters.size).toBe(401);
    expect(requestedIds.length).toBeGreaterThan(1);
    // Every id must be requested exactly once, across however many batches it took.
    expect(requestedIds.join(",").split(",").sort()).toEqual([...ids].sort());
    // Each request must stay within the encoded id-parameter budget.
    for (const param of requestedIds) {
      expect(param.length).toBeLessThanOrEqual(4_000);
    }
  });

  it("keeps successful batches when one batch fails", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      requestTimeoutMs: 5_000,
      fetchImpl: async (url) => {
        const idParam = new URL(String(url)).searchParams.get("id") ?? "";
        const ids = idParam.split(",");
        if (ids.includes("lfailabcdefghijklmnopqrstu")) {
          return new Response(JSON.stringify({ message: "boom" }), {
            status: 500,
            statusText: "Internal Server Error",
          });
        }
        return new Response(
          JSON.stringify({ data: ids.map((id) => ({ id, visits: 7 })) }),
          { status: 200 },
        );
      },
    });

    // Two batches' worth of maximum-length ids, so one can fail while the other
    // succeeds and the split is driven by the byte budget.
    const ids = Array.from(
      { length: 400 },
      (_, i) => `l${String(i).padStart(3, "0")}abcdefghijklmnopqrstu`,
    );
    ids.push("lfailabcdefghijklmnopqrstu");
    const res = await client.getCountersByIds(ids);
    expect(res.success).toBe(false);
    // The good batch's real counts must survive the failure.
    expect(res.counters.size).toBeGreaterThan(0);
    expect(res.counters.has("lfailabcdefghijklmnopqrstu")).toBe(false);
  });

  it("caps how many counter requests run at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      requestTimeoutMs: 5_000,
      fetchImpl: async (url) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        const idParam = new URL(String(url)).searchParams.get("id") ?? "";
        return new Response(
          JSON.stringify({
            data: idParam.split(",").map((id) => ({ id, visits: 1 })),
          }),
          { status: 200 },
        );
      },
    });

    // Enough ids to need many batches.
    const ids = Array.from({ length: 600 }, (_, i) => `id-${i}`);
    const res = await client.getCountersByIds(ids);
    expect(res.success).toBe(true);
    expect(res.counters.size).toBe(600);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("maps analytics metric rows into a record", async () => {
    let requestedUrl = "";
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            data: [
              { name: "KR", count: 5 },
              { name: "US", count: 2 },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const res = await client.getMetrics("my-slug", "country");
    expect(requestedUrl).toContain("/api/stats/metrics?");
    expect(requestedUrl).toContain("slug=my-slug");
    expect(requestedUrl).toContain("type=country");
    expect(res.success).toBe(true);
    expect(res.metrics).toEqual({ KR: 5, US: 2 });
  });

  it("builds stats from analytics endpoints instead of the removed link stats route", async () => {
    const requestedCalls: string[] = [];
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url) => {
        const urlStr = String(url);
        requestedCalls.push(urlStr);
        if (urlStr.includes("/api/link/query"))
          return new Response(
            JSON.stringify({ slug: "my-slug", url: "https://example.com" }),
            { status: 200 },
          );
        if (urlStr.includes("/api/stats/counters"))
          return new Response(
            JSON.stringify({
              data: [{ visits: 42, visitors: 30, referers: 9 }],
            }),
            { status: 200 },
          );
        if (urlStr.includes("type=country"))
          return new Response(
            JSON.stringify({ data: [{ name: "KR", count: 40 }] }),
            { status: 200 },
          );
        if (urlStr.includes("type=referer"))
          return new Response(
            JSON.stringify({ data: [{ name: "https://x.com", count: 12 }] }),
            { status: 200 },
          );
        if (urlStr.includes("type=device"))
          return new Response(
            JSON.stringify({ data: [{ name: "desktop", count: 33 }] }),
            { status: 200 },
          );
        if (urlStr.includes("/api/logs/events"))
          return new Response(
            JSON.stringify([{ timestamp: "2026-09-20T10:00:00Z" }]),
            { status: 200 },
          );
        return new Response("{}", { status: 404 });
      },
    });

    const res = await client.getStats("my-slug");
    expect(res.success).toBe(true);
    expect(res.stats?.clicks).toBe(42);
    expect(res.stats?.slug).toBe("my-slug");
    expect(res.stats?.url).toBe("https://example.com");
    expect(res.stats?.countries).toEqual({ KR: 40 });
    expect(res.stats?.referrers).toEqual({ "https://x.com": 12 });
    expect(res.stats?.devices).toEqual({ desktop: 33 });
    expect(res.stats?.lastClickedAt).toBe(1789898400);
    // The endpoint that never existed must not be called.
    expect(requestedCalls.some((c) => c.includes("/api/link/stats/"))).toBe(
      false,
    );
  });

  it("leaves clicks unknown when the analytics result is empty", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/link/query"))
          return new Response(
            JSON.stringify({ slug: "quiet", url: "https://example.com" }),
            { status: 200 },
          );
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });

    const res = await client.getStats("quiet");
    expect(res.success).toBe(true);
    // An empty analytics result is ambiguous: the link may simply have no
    // clicks, or the instance may have no analytics dataset at all. Reporting a
    // measured 0 here would fabricate a figure, so it stays unknown.
    expect(res.stats?.clicks).toBeUndefined();
    expect(res.stats?.lastClickedAt).toBeUndefined();
  });

  it("distinguishes a real zero from missing analytics", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/link/query"))
          return new Response(
            JSON.stringify({ slug: "zeroed", url: "https://example.com" }),
            { status: 200 },
          );
        if (urlStr.includes("/api/stats/counters"))
          return new Response(
            JSON.stringify({ data: [{ visits: 0, visitors: 0, referers: 0 }] }),
            { status: 200 },
          );
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });

    const res = await client.getStats("zeroed");
    expect(res.success).toBe(true);
    expect(res.stats?.clicks).toBe(0);
  });

  it("rejects a blank slug before querying analytics", async () => {
    let calls = 0;
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () => {
        calls++;
        return new Response("{}", { status: 200 });
      },
    });

    const counters = await client.getCountersBySlug("   ");
    expect(counters.success).toBe(false);
    expect(counters.error).toContain("non-empty slug");
    expect(calls).toBe(0);
  });

  it("rejects an invalid metrics limit", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    const res = await client.getMetrics("valid-slug", "country", Number.NaN);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Invalid metrics limit");
  });

  it("fails stats lookup when the link does not exist", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/link/query"))
          return new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
            statusText: "Not Found",
          });
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });

    const res = await client.getStats("missing");
    expect(res.success).toBe(false);
  });
});

describe("Click Count Partial Resolution Tests", () => {
  const userId = "581920391829381920";
  const userHash = getUserHash(userId);

  it("reports partial when some links cannot be resolved", async () => {
    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;
    const originalCounters = sinkClient.getCountersByIds;

    sinkClient.countLinks = mock(async (params) => ({
      success: true,
      count: params.status === "all" ? 2 : 2,
      status: 200,
    }));
    sinkClient.listLinks = mock(async () => ({
      success: true,
      list: [
        { id: "id-1", slug: `a-${userHash}`, url: "https://a.com" },
        // No id, so this one can never be correlated with analytics.
        { slug: `b-${userHash}`, url: "https://b.com" },
      ],
      total: 2,
      listComplete: true,
    }));
    sinkClient.getCountersByIds = mock(async () => ({
      success: true,
      analyticsAvailable: true,
      counters: new Map([["id-1", 12]]),
    }));

    try {
      const stats = await fetchUserDashboardStats(userId);
      expect(stats.clicksComplete).toBe(false);
      // Only the resolved link contributes; the figure is a floor, not a total.
      expect(stats.totalClicks).toBe(12);
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
      sinkClient.getCountersByIds = originalCounters;
    }
  });

  it("reports a complete lookup when every link resolves", async () => {
    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;
    const originalCounters = sinkClient.getCountersByIds;

    sinkClient.countLinks = mock(async () => ({
      success: true,
      count: 2,
      status: 200,
    }));
    sinkClient.listLinks = mock(async () => ({
      success: true,
      list: [
        { id: "id-1", slug: `a-${userHash}`, url: "https://a.com" },
        { id: "id-2", slug: `b-${userHash}`, url: "https://b.com" },
      ],
      total: 2,
      listComplete: true,
    }));
    sinkClient.getCountersByIds = mock(async () => ({
      success: true,
      analyticsAvailable: true,
      counters: new Map([
        ["id-1", 3],
        ["id-2", 4],
      ]),
    }));

    try {
      const stats = await fetchUserDashboardStats(userId);
      expect(stats.clicksComplete).toBe(true);
      expect(stats.totalClicks).toBe(7);
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
      sinkClient.getCountersByIds = originalCounters;
    }
  });

  it("rejects malformed ids before any request", async () => {
    let calls = 0;
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () => {
        calls++;
        return new Response("{}", { status: 200 });
      },
    });

    const res = await client.getCountersByIds(["ok-id", "   "]);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Invalid link ids");
    expect(calls).toBe(0);
  });

  it("rejects an absurdly large id set", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    const res = await client.getCountersByIds(
      Array.from({ length: 5_001 }, (_, i) => `id-${i}`),
    );
    expect(res.success).toBe(false);
    expect(res.analyticsAvailable).toBe(false);
  });
});

describe("Zero-Click Link Resolution Tests", () => {
  const userId = "681920391829381920";
  const userHash = getUserHash(userId);

  it("treats a queried link with no analytics row as a real zero, not a gap", async () => {
    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;
    const originalCounters = sinkClient.getCountersByIds;

    sinkClient.countLinks = mock(async () => ({
      success: true,
      count: 2,
      status: 200,
    }));
    sinkClient.listLinks = mock(async () => ({
      success: true,
      list: [
        { id: "clicked", slug: `a-${userHash}`, url: "https://a.com" },
        { id: "never", slug: `b-${userHash}`, url: "https://b.com" },
      ],
      total: 2,
      listComplete: true,
    }));
    // Sink returns rows only for links that were actually clicked.
    sinkClient.getCountersByIds = mock(async () => ({
      success: true,
      analyticsAvailable: true,
      counters: new Map([["clicked", 9]]),
    }));

    try {
      const stats = await fetchUserDashboardStats(userId);
      // The never-clicked link resolved to a real 0, so the set is complete and
      // the dashboard may present 9 as a genuine total.
      expect(stats.clicksComplete).toBe(true);
      expect(stats.totalClicks).toBe(9);
      const never = stats.links.find((l) => l.id === "never");
      expect(never?.clicks).toBe(0);
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
      sinkClient.getCountersByIds = originalCounters;
    }
  });

  it("still reports partial when a batch fails, even if every id resolved", async () => {
    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;
    const originalCounters = sinkClient.getCountersByIds;

    sinkClient.countLinks = mock(async () => ({
      success: true,
      count: 1,
      status: 200,
    }));
    sinkClient.listLinks = mock(async () => ({
      success: true,
      list: [{ id: "only", slug: `a-${userHash}`, url: "https://a.com" }],
      total: 1,
      listComplete: true,
    }));
    sinkClient.getCountersByIds = mock(async () => ({
      success: false,
      analyticsAvailable: false,
      counters: new Map([["only", 5]]),
      error: "boom",
    }));

    try {
      const stats = await fetchUserDashboardStats(userId);
      // A failed lookup means other batches may be missing, so this is a floor.
      expect(stats.clicksComplete).toBe(false);
      expect(stats.totalClicks).toBe(5);
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
      sinkClient.getCountersByIds = originalCounters;
    }
  });
});

describe("Failed Lookup Must Not Fabricate Zeroes", () => {
  const userId = "781920391829381920";
  const userHash = getUserHash(userId);

  it("leaves clicks undefined when the counter lookup failed entirely", async () => {
    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;
    const originalCounters = sinkClient.getCountersByIds;

    sinkClient.countLinks = mock(async () => ({
      success: true,
      count: 2,
      status: 200,
    }));
    sinkClient.listLinks = mock(async () => ({
      success: true,
      list: [
        { id: "id-1", slug: `a-${userHash}`, url: "https://a.com" },
        { id: "id-2", slug: `b-${userHash}`, url: "https://b.com" },
      ],
      total: 2,
      listComplete: true,
    }));
    // A failed lookup (network error, or a rejected id) returns an empty map.
    sinkClient.getCountersByIds = mock(async () => ({
      success: false,
      analyticsAvailable: false,
      counters: new Map(),
      error: "network down",
    }));

    try {
      const stats = await fetchUserDashboardStats(userId);
      expect(stats.clicksComplete).toBe(false);
      // No link may be given a fabricated measured 0.
      expect(stats.links.every((l) => l.clicks === undefined)).toBe(true);
      expect(stats.totalClicks).toBeUndefined();
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
      sinkClient.getCountersByIds = originalCounters;
    }
  });

  it("keeps resolved counts but never fabricates zeros on a partial failure", async () => {
    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;
    const originalCounters = sinkClient.getCountersByIds;

    sinkClient.countLinks = mock(async () => ({
      success: true,
      count: 2,
      status: 200,
    }));
    sinkClient.listLinks = mock(async () => ({
      success: true,
      list: [
        { id: "id-1", slug: `a-${userHash}`, url: "https://a.com" },
        { id: "id-2", slug: `b-${userHash}`, url: "https://b.com" },
      ],
      total: 2,
      listComplete: true,
    }));
    sinkClient.getCountersByIds = mock(async () => ({
      success: false,
      analyticsAvailable: false,
      counters: new Map([["id-1", 11]]),
      error: "one batch failed",
    }));

    try {
      const stats = await fetchUserDashboardStats(userId);
      expect(stats.clicksComplete).toBe(false);
      // The resolved link keeps its real value; the unresolved one stays unknown.
      expect(stats.links.find((l) => l.id === "id-1")?.clicks).toBe(11);
      expect(stats.links.find((l) => l.id === "id-2")?.clicks).toBeUndefined();
      expect(stats.totalClicks).toBe(11);
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
      sinkClient.getCountersByIds = originalCounters;
    }
  });

  it("reports unknown clicks on the stats card when analytics are empty", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/link/query"))
          return new Response(
            JSON.stringify({ slug: "s", url: "https://example.com" }),
            { status: 200 },
          );
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });

    const res = await client.getStats("s");
    expect(res.success).toBe(true);
    expect(res.stats?.clicks).toBeUndefined();
  });
});

describe("Empty Analytics Dataset Is Not Zero", () => {
  const userId = "881920391829381920";
  const userHash = getUserHash(userId);

  it("reports analyticsAvailable false when Sink returns an empty dataset", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: TEST_TOKEN,
      fetchImpl: async () =>
        // Sink's useWAE short-circuits to { data: [] } without CF credentials.
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
    });

    const res = await client.getCountersByIds(["a", "b"]);
    expect(res.success).toBe(true);
    // Succeeded, but proves nothing about whether clicks exist.
    expect(res.analyticsAvailable).toBe(false);
    expect(res.counters.size).toBe(0);
  });

  it("does not fabricate zeroes or claim a complete total on an empty dataset", async () => {
    const originalCount = sinkClient.countLinks;
    const originalList = sinkClient.listLinks;
    const originalCounters = sinkClient.getCountersByIds;

    sinkClient.countLinks = mock(async () => ({
      success: true,
      count: 2,
      status: 200,
    }));
    sinkClient.listLinks = mock(async () => ({
      success: true,
      list: [
        { id: "id-1", slug: `a-${userHash}`, url: "https://a.com" },
        { id: "id-2", slug: `b-${userHash}`, url: "https://b.com" },
      ],
      total: 2,
      listComplete: true,
    }));
    // Success with an empty map: exactly what a credentials-less instance returns.
    sinkClient.getCountersByIds = mock(async () => ({
      success: true,
      analyticsAvailable: false,
      counters: new Map(),
    }));

    try {
      const stats = await fetchUserDashboardStats(userId);
      expect(stats.clicksComplete).toBe(false);
      // No link may be stamped with a measured 0, and no total may be claimed.
      expect(stats.links.every((l) => l.clicks === undefined)).toBe(true);
      expect(stats.totalClicks).toBeUndefined();
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.listLinks = originalList;
      sinkClient.getCountersByIds = originalCounters;
    }
  });
});
