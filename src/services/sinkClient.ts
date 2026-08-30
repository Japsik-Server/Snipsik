import { config } from "@/config";
import type {
  CreateLinkPayload,
  UpdateLinkPayload,
  SinkLink,
  SinkStats,
  SinkListResponse,
  UrlCheckResult,
} from "@/types/sink";
import { logger } from "@/utils/logger";

class SinkClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = config.SINK_BASE_URL;
    this.token = config.SINK_API_TOKEN;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
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
        const errorMsg =
          (json as { message?: string; error?: string })?.message ||
          (json as { message?: string; error?: string })?.error ||
          `HTTP ${response.status}: ${response.statusText}`;
        logger.warn(`Sink API Error (${response.status}): ${errorMsg}`);
        return { success: false, error: errorMsg, status: response.status };
      }

      // Handle both { data: T } wrapper and direct T response
      const data = (json as { data?: T })?.data !== undefined ? (json as { data: T }).data : (json as T);
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
    payload: CreateLinkPayload
  ): Promise<{ success: boolean; link?: SinkLink; error?: string }> {
    const res = await this.request<SinkLink>("/api/link/create", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.success || !res.data) {
      return { success: false, error: res.error || "Failed to create link" };
    }

    const link = res.data;
    if (!link.slug && payload.slug) {
      link.slug = payload.slug;
    }
    if (!link.url && payload.url) {
      link.url = payload.url;
    }

    return { success: true, link };
  }

  /**
   * Fetches details of a link by slug.
   */
  async getLink(slug: string): Promise<{ success: boolean; link?: SinkLink; error?: string }> {
    const res = await this.request<SinkLink>(`/api/link/${encodeURIComponent(slug)}`, {
      method: "GET",
    });

    if (!res.success || !res.data) {
      return { success: false, error: res.error || "Link not found" };
    }

    return { success: true, link: res.data };
  }

  /**
   * Updates an existing link.
   */
  async updateLink(
    slug: string,
    payload: UpdateLinkPayload
  ): Promise<{ success: boolean; link?: SinkLink; error?: string }> {
    const res = await this.request<SinkLink>("/api/link/update", {
      method: "POST",
      body: JSON.stringify({ slug, ...payload }),
    });

    if (!res.success) {
      // Fallback: try PUT /api/link/:slug
      const fallbackRes = await this.request<SinkLink>(`/api/link/${encodeURIComponent(slug)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      if (!fallbackRes.success) {
        return { success: false, error: res.error || fallbackRes.error || "Failed to update link" };
      }
      return { success: true, link: fallbackRes.data };
    }

    return { success: true, link: res.data };
  }

  /**
   * Deletes a link by slug.
   */
  async deleteLink(slug: string): Promise<{ success: boolean; error?: string }> {
    const res = await this.request<{ success: boolean }>("/api/link/delete", {
      method: "POST",
      body: JSON.stringify({ slug }),
    });

    if (!res.success) {
      // Fallback: try DELETE /api/link/:slug
      const fallbackRes = await this.request<{ success: boolean }>(
        `/api/link/${encodeURIComponent(slug)}`,
        {
          method: "DELETE",
        }
      );

      if (!fallbackRes.success) {
        return { success: false, error: res.error || fallbackRes.error || "Failed to delete link" };
      }
    }

    return { success: true };
  }

  /**
   * Fetches statistics and click count for a slug.
   */
  async getStats(
    slug: string
  ): Promise<{ success: boolean; stats?: SinkStats; error?: string }> {
    const res = await this.request<SinkStats>(`/api/link/stats/${encodeURIComponent(slug)}`, {
      method: "GET",
    });

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
    page: number = 1
  ): Promise<{ success: boolean; list: SinkLink[]; total: number; error?: string }> {
    const params = new URLSearchParams();
    if (tag) params.append("tag", tag);
    if (page > 1) params.append("page", page.toString());

    const queryString = params.toString();
    const endpoint = `/api/link/list${queryString ? `?${queryString}` : ""}`;

    const res = await this.request<SinkListResponse | SinkLink[]>(endpoint, {
      method: "GET",
    });

    if (!res.success || !res.data) {
      return { success: false, list: [], total: 0, error: res.error || "Failed to list links" };
    }

    if (Array.isArray(res.data)) {
      return { success: true, list: res.data, total: res.data.length };
    }

    const listData = res.data as SinkListResponse;
    return {
      success: true,
      list: listData.list || [],
      total: listData.total ?? (listData.list?.length || 0),
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
        statusText: errorMessage.includes("abort") ? "Request Timeout (6s)" : errorMessage,
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
