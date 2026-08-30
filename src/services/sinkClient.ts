import { config } from "@/config";
import type {
  CreateLinkPayload,
  UpdateLinkPayload,
  SinkLink,
  SinkStats,
  UrlCheckResult,
} from "@/types/sink";
import { logger } from "@/utils/logger";

function normalizeSinkLink(
  raw: unknown,
  defaultSlug?: string,
  defaultUrl?: string,
): SinkLink {
  if (!raw || typeof raw !== "object") {
    const rawDefault = defaultSlug
      ? defaultSlug.startsWith("/")
        ? defaultSlug.substring(1)
        : defaultSlug
      : "";
    return {
      slug: rawDefault,
      url: defaultUrl || "",
    };
  }

  // Unwrap potential nested envelopes: { link: {...} } or { data: {...} } or { item: {...} }
  let obj = raw as Record<string, unknown>;
  if (obj.link && typeof obj.link === "object" && !Array.isArray(obj.link)) {
    obj = { ...obj, ...(obj.link as Record<string, unknown>) };
  }
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
    obj = { ...obj, ...(obj.data as Record<string, unknown>) };
  }
  if (obj.item && typeof obj.item === "object" && !Array.isArray(obj.item)) {
    obj = { ...obj, ...(obj.item as Record<string, unknown>) };
  }

  const meta = (
    obj.metadata && typeof obj.metadata === "object" ? obj.metadata : {}
  ) as Record<string, unknown>;

  // Safely extract string properties without risking "[object Object]"
  const extractString = (...keys: unknown[]): string => {
    for (const key of keys) {
      if (
        typeof key === "string" &&
        key.trim().length > 0 &&
        key !== "[object Object]"
      ) {
        return key.trim();
      }
    }
    return "";
  };

  const rawSlugCandidate = extractString(
    obj.slug,
    obj.key,
    obj.alias,
    obj.name,
    obj.id,
    meta.slug,
    meta.key,
    meta.alias,
    meta.id,
    defaultSlug,
  );

  const slug = rawSlugCandidate.startsWith("/")
    ? rawSlugCandidate.substring(1)
    : rawSlugCandidate;

  const url = extractString(
    obj.url,
    typeof obj.link === "string" ? obj.link : undefined,
    obj.target,
    obj.destination,
    obj.originUrl,
    obj.originalUrl,
    meta.url,
    typeof meta.link === "string" ? meta.link : undefined,
    meta.target,
    meta.destination,
    defaultUrl,
  );

  const title =
    typeof obj.title === "string" && obj.title.trim().length > 0
      ? obj.title.trim()
      : typeof meta.title === "string" && meta.title.trim().length > 0
        ? meta.title.trim()
        : typeof obj.name === "string" && obj.name.trim().length > 0
          ? obj.name.trim()
          : null;

  const description =
    typeof obj.description === "string" && obj.description.trim().length > 0
      ? obj.description.trim()
      : typeof meta.description === "string" &&
          meta.description.trim().length > 0
        ? meta.description.trim()
        : typeof obj.desc === "string" && obj.desc.trim().length > 0
          ? obj.desc.trim()
          : null;

  const rawTag =
    obj.tag ??
    meta.tag ??
    obj.category ??
    meta.category ??
    obj.tags ??
    meta.tags ??
    obj.label ??
    meta.label;

  let tag: string | null = null;
  if (typeof rawTag === "string" && rawTag.trim().length > 0) {
    tag = rawTag.trim();
  } else if (Array.isArray(rawTag) && rawTag.length > 0) {
    tag = rawTag
      .map((t) => String(t).trim())
      .filter(Boolean)
      .join(", ");
  }

  const rawPassword =
    typeof obj.password === "string"
      ? obj.password
      : typeof meta.password === "string"
        ? meta.password
        : null;

  const rawClicks =
    obj.clicks ??
    meta.clicks ??
    obj.visit_count ??
    meta.visit_count ??
    obj.views ??
    meta.views ??
    obj.count;
  const clicks =
    typeof rawClicks === "number"
      ? rawClicks
      : typeof rawClicks === "string"
        ? parseInt(rawClicks, 10) || 0
        : 0;

  const expiration =
    typeof obj.expiration === "string" || typeof obj.expiration === "number"
      ? obj.expiration
      : typeof meta.expiration === "string" ||
          typeof meta.expiration === "number"
        ? meta.expiration
        : typeof obj.expires_at === "string" ||
            typeof obj.expires_at === "number"
          ? obj.expires_at
          : typeof meta.expires_at === "string" ||
              typeof meta.expires_at === "number"
            ? meta.expires_at
            : typeof obj.expire === "string" || typeof obj.expire === "number"
              ? obj.expire
              : null;

  const createdAt =
    typeof obj.createdAt === "string"
      ? obj.createdAt
      : typeof meta.createdAt === "string"
        ? meta.createdAt
        : typeof obj.created_at === "string"
          ? obj.created_at
          : typeof meta.created_at === "string"
            ? meta.created_at
            : typeof obj.date === "string"
              ? obj.date
              : undefined;

  const updatedAt =
    typeof obj.updatedAt === "string"
      ? obj.updatedAt
      : typeof meta.updatedAt === "string"
        ? meta.updatedAt
        : typeof obj.updated_at === "string"
          ? obj.updated_at
          : typeof meta.updated_at === "string"
            ? meta.updated_at
            : undefined;

  const unsafe = Boolean(
    obj.unsafe || meta.unsafe || obj.is_unsafe || meta.is_unsafe,
  );

  return {
    slug,
    url,
    title,
    description,
    tag,
    password: rawPassword,
    clicks,
    expiration,
    createdAt,
    updatedAt,
    unsafe,
  };
}

class SinkClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = config.SINK_BASE_URL;
    this.token = config.SINK_API_TOKEN;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<{ success: boolean; data?: T; error?: string; status: number }> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers as Record<string, string> | undefined),
    };

    try {
      logger.debug(`Sink API Request: ${options.method || "GET"} ${url}`);
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const text = await response.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { message: text };
      }

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        if (typeof json === "object" && json !== null) {
          const record = json as Record<string, unknown>;
          if (
            typeof record.message === "string" &&
            record.message.trim().length > 0
          ) {
            errorMsg = record.message;
          } else if (
            typeof record.statusMessage === "string" &&
            record.statusMessage.trim().length > 0
          ) {
            errorMsg = record.statusMessage;
          } else if (
            typeof record.error === "string" &&
            record.error.trim().length > 0
          ) {
            errorMsg = record.error;
          } else if (
            typeof record.data === "string" &&
            record.data.trim().length > 0
          ) {
            errorMsg = record.data;
          } else if (response.status === 401) {
            errorMsg =
              "인증 실패 (401 Unauthorized): SINK_API_TOKEN이 올바르지 않거나 권한이 없습니다.";
          } else if (response.status === 403) {
            errorMsg = "접근 거부 (403 Forbidden): API 접근 권한이 없습니다.";
          } else if (response.status === 404) {
            errorMsg = "리소스를 찾을 수 없습니다 (404 Not Found).";
          }
        }
        logger.warn(`Sink API Error (${response.status}): ${errorMsg}`);
        return { success: false, error: errorMsg, status: response.status };
      }

      // Handle both { data: T } wrapper and direct T response
      const data =
        (json as { data?: T })?.data !== undefined
          ? (json as { data: T }).data
          : (json as T);
      return { success: true, data, status: response.status };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Sink API Network Exception for ${url}:`, err);
      return { success: false, error: errorMsg, status: 0 };
    }
  }

  /**
   * Creates a new shortened link.
   */
  async createLink(
    payload: CreateLinkPayload,
  ): Promise<{ success: boolean; link?: SinkLink; error?: string }> {
    const res = await this.request<unknown>("/api/link/create", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.success || !res.data) {
      return { success: false, error: res.error || "Failed to create link" };
    }

    const link = normalizeSinkLink(res.data, payload.slug, payload.url);
    return { success: true, link };
  }

  /**
   * Fetches details of a link by slug.
   */
  async getLink(slug: string): Promise<{
    success: boolean;
    link?: SinkLink;
    error?: string;
    status?: number;
  }> {
    const cleanSlug = slug.startsWith("/") ? slug.substring(1) : slug;
    const res = await this.request<unknown>(
      `/api/link/${encodeURIComponent(cleanSlug)}`,
      {
        method: "GET",
      },
    );

    if (res.success && res.data) {
      const link = normalizeSinkLink(res.data, cleanSlug);
      if (link.url) {
        return { success: true, link, status: res.status };
      }
    }

    // Fallback: search in listAllLinks
    const listRes = await this.listAllLinks();
    if (listRes.success && listRes.list.length > 0) {
      const found = listRes.list.find(
        (l) => l.slug.toLowerCase() === cleanSlug.toLowerCase(),
      );
      if (found) {
        return { success: true, link: found, status: 200 };
      }
    }

    return {
      success: false,
      error: res.error || "Link not found",
      status: res.status ?? 404,
    };
  }

  /**
   * Updates an existing link.
   */
  async updateLink(
    slug: string,
    payload: UpdateLinkPayload,
  ): Promise<{ success: boolean; link?: SinkLink; error?: string }> {
    const cleanSlug = slug.startsWith("/") ? slug.substring(1) : slug;
    const res = await this.request<unknown>("/api/link/update", {
      method: "POST",
      body: JSON.stringify({ slug: cleanSlug, ...payload }),
    });

    if (!res.success) {
      // Fallback: try PUT /api/link/:slug
      const fallbackRes = await this.request<unknown>(
        `/api/link/${encodeURIComponent(cleanSlug)}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      );

      if (!fallbackRes.success) {
        return {
          success: false,
          error: res.error || fallbackRes.error || "Failed to update link",
        };
      }
      const link = normalizeSinkLink(fallbackRes.data, cleanSlug, payload.url);
      return { success: true, link };
    }

    const link = normalizeSinkLink(res.data, cleanSlug, payload.url);
    return { success: true, link };
  }

  /**
   * Deletes a link by slug.
   */
  async deleteLink(
    slug: string,
  ): Promise<{ success: boolean; error?: string }> {
    const cleanSlug = slug.startsWith("/") ? slug.substring(1) : slug;

    // Check if the link exists before attempting deletion
    const existing = await this.getLink(cleanSlug);
    if (!existing.success || !existing.link) {
      if (
        existing.status === 404 ||
        existing.error === "Link not found" ||
        existing.error?.includes("404")
      ) {
        return {
          success: false,
          error: `단축 링크 '/${cleanSlug}'을(를) 찾을 수 없습니다. (존재하지 않는 링크)`,
        };
      }
      return {
        success: false,
        error: existing.error || "링크 정보를 조회하는 중 오류가 발생했습니다.",
      };
    }

    const res = await this.request<{ success: boolean }>("/api/link/delete", {
      method: "POST",
      body: JSON.stringify({ slug: cleanSlug }),
    });

    if (!res.success) {
      // Fallback: try DELETE /api/link/:slug
      const fallbackRes = await this.request<{ success: boolean }>(
        `/api/link/${encodeURIComponent(cleanSlug)}`,
        {
          method: "DELETE",
        },
      );

      if (!fallbackRes.success) {
        return {
          success: false,
          error: res.error || fallbackRes.error || "Failed to delete link",
        };
      }
    }

    return { success: true };
  }

  /**
   * Fetches statistics and click count for a slug.
   */
  async getStats(
    slug: string,
  ): Promise<{ success: boolean; stats?: SinkStats; error?: string }> {
    const res = await this.request<SinkStats>(
      `/api/link/stats/${encodeURIComponent(slug)}`,
      {
        method: "GET",
      },
    );

    if (!res.success || !res.data) {
      return { success: false, error: res.error || "Failed to fetch stats" };
    }

    return { success: true, stats: res.data };
  }

  /**
   * Lists links with optional tag and pagination.
   */
  async listLinks(
    tag?: string,
    page: number = 1,
    limit: number = 1000,
  ): Promise<{
    success: boolean;
    list: SinkLink[];
    total: number;
    error?: string;
  }> {
    const params = new URLSearchParams();
    if (tag) params.append("tag", tag);
    if (page > 1) params.append("page", page.toString());
    if (limit > 0) params.append("limit", limit.toString());

    const queryString = params.toString();
    const endpoint = `/api/link/list${queryString ? `?${queryString}` : ""}`;

    let res = await this.request<unknown>(endpoint, {
      method: "GET",
    });

    // If query string request failed, fallback to bare /api/link/list
    if (!res.success && queryString) {
      logger.debug(
        `Failed to fetch with queryString (${endpoint}), falling back to bare /api/link/list`,
      );
      res = await this.request<unknown>("/api/link/list", {
        method: "GET",
      });
    }

    if (!res.success || res.data === undefined) {
      return {
        success: false,
        list: [],
        total: 0,
        error: res.error || "Failed to list links",
      };
    }

    let rawList: unknown[] = [];
    let total = 0;

    if (Array.isArray(res.data)) {
      rawList = res.data;
      total = rawList.length;
    } else if (res.data && typeof res.data === "object") {
      const obj = res.data as Record<string, unknown>;
      if (Array.isArray(obj.list)) {
        rawList = obj.list;
        total = typeof obj.total === "number" ? obj.total : rawList.length;
      } else if (Array.isArray(obj.links)) {
        rawList = obj.links;
        total = typeof obj.total === "number" ? obj.total : rawList.length;
      } else if (Array.isArray(obj.data)) {
        rawList = obj.data;
        total = typeof obj.total === "number" ? obj.total : rawList.length;
      } else if (Array.isArray(obj.items)) {
        rawList = obj.items;
        total = typeof obj.total === "number" ? obj.total : rawList.length;
      } else if (Array.isArray(obj.result)) {
        rawList = obj.result;
        total = typeof obj.total === "number" ? obj.total : rawList.length;
      } else if (Array.isArray(obj.keys)) {
        rawList = obj.keys;
        total = typeof obj.total === "number" ? obj.total : rawList.length;
      } else if (obj.data && typeof obj.data === "object") {
        const nested = obj.data as Record<string, unknown>;
        if (Array.isArray(nested.list)) {
          rawList = nested.list;
          total =
            typeof nested.total === "number" ? nested.total : rawList.length;
        } else if (Array.isArray(nested.links)) {
          rawList = nested.links;
          total =
            typeof nested.total === "number" ? nested.total : rawList.length;
        } else if (Array.isArray(nested.data)) {
          rawList = nested.data;
          total =
            typeof nested.total === "number" ? nested.total : rawList.length;
        }
      }
    }

    const list = rawList
      .map((item) => normalizeSinkLink(item))
      .filter((l) => Boolean(l.slug));

    logger.debug(
      `Parsed ${list.length} links from Sink API (raw items: ${rawList.length})`,
    );

    return {
      success: true,
      list,
      total: total || list.length,
    };
  }

  /**
   * Fetches all links across all pages from the Sink instance.
   */
  async listAllLinks(tag?: string): Promise<{
    success: boolean;
    list: SinkLink[];
    total: number;
    error?: string;
  }> {
    const firstPage = await this.listLinks(tag, 1, 1000);
    if (!firstPage.success) {
      return firstPage;
    }

    const allLinks = [...firstPage.list];
    const total = firstPage.total;

    // If total exceeds the first page, fetch subsequent pages sequentially
    if (total > allLinks.length) {
      const pageSize = 1000;
      const totalPages = Math.ceil(total / pageSize);
      for (let page = 2; page <= totalPages; page++) {
        const pageRes = await this.listLinks(tag, page, pageSize);
        if (pageRes.success && pageRes.list.length > 0) {
          allLinks.push(...pageRes.list);
        } else {
          break;
        }
      }
    }

    return {
      success: true,
      list: allLinks,
      total: allLinks.length,
    };
  }

  /**
   * Checks the health and reachability of a target URL.
   */
  async checkUrlHealth(targetUrl: string): Promise<UrlCheckResult> {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(targetUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "Snipsik-HealthChecker/1.0",
        },
      });
      clearTimeout(timeoutId);

      const responseTimeMs = Date.now() - startTime;
      const contentType = response.headers.get("content-type");

      return {
        url: targetUrl,
        status: response.status,
        statusText: response.statusText,
        responseTimeMs,
        isAlive: response.status >= 200 && response.status < 400,
        contentType,
      };
    } catch (err) {
      const responseTimeMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        url: targetUrl,
        status: null,
        statusText: errorMessage.includes("abort")
          ? "Request Timeout (6s)"
          : errorMessage,
        responseTimeMs,
        isAlive: false,
        contentType: null,
      };
    }
  }

  /**
   * Helper to format a full short URL from slug.
   */
  getFullShortUrl(slug: string): string {
    return `${this.baseUrl}/${slug}`;
  }
}

export const sinkClient = new SinkClient();
