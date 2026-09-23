import { sinkClient } from "@/services/sinkClient";
import type { SinkLink, SinkListParams } from "@/types/sink";

export const OWNED_LINK_LIMIT = 2_000;
export const OWNED_LINK_PAGE_SIZE = 1_000;
export const OWNED_LINK_MAX_PAGES = 20;

interface LinkPage {
  success: boolean;
  list: SinkLink[];
  cursor?: string | null;
  listComplete?: boolean;
  error?: string;
}

export type OwnedLinkPageFetcher = (
  options: SinkListParams,
) => Promise<LinkPage>;

export type OwnedLinkCatalogResult =
  | {
      success: true;
      links: SinkLink[];
      complete: boolean;
      scannedPages: number;
      scannedRecords: number;
    }
  | {
      success: false;
      links: [];
      complete: false;
      scannedPages: number;
      scannedRecords: number;
      error: string;
    };

export type OwnedLinkLookupResult =
  | {
      success: true;
      link: SinkLink | null;
      complete: boolean;
      scannedPages: number;
      scannedRecords: number;
    }
  | {
      success: false;
      link: null;
      complete: false;
      scannedPages: number;
      scannedRecords: number;
      error: string;
    };

function isOwnedSlug(slug: string, userHash: string): boolean {
  const normalizedSlug = slug.toLowerCase();
  const normalizedHash = userHash.toLowerCase();
  return (
    normalizedSlug === normalizedHash ||
    normalizedSlug.endsWith(`-${normalizedHash}`)
  );
}

/**
 * Collects full Sink link records for one user with bounded cursor pagination.
 * The 2,000-link cap matches the reviewed dashboard snapshot capacity.
 */
export async function collectOwnedLinks(
  userHash: string,
  options: {
    tag?: string;
    maxLinks?: number;
    maxPages?: number;
    fetchPage?: OwnedLinkPageFetcher;
  } = {},
): Promise<OwnedLinkCatalogResult> {
  const maxLinks = options.maxLinks ?? OWNED_LINK_LIMIT;
  const maxPages = options.maxPages ?? OWNED_LINK_MAX_PAGES;
  const fetchPage =
    options.fetchPage ??
    ((params: SinkListParams) => sinkClient.listLinks(params));
  const requestedTag = options.tag?.trim().toLowerCase();
  const linksBySlug = new Map<string, SinkLink>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let scannedPages = 0;
  let scannedRecords = 0;

  while (linksBySlug.size < maxLinks) {
    const page = await fetchPage({
      cursor,
      tag: options.tag,
      status: "all",
      sort: "newest",
      limit: OWNED_LINK_PAGE_SIZE,
    });
    scannedPages += 1;
    scannedRecords += page.list.length;

    if (!page.success) {
      return {
        success: false,
        links: [],
        complete: false,
        scannedPages,
        scannedRecords,
        error: page.error ?? "Sink 링크 페이지 조회에 실패했습니다.",
      };
    }

    for (const link of page.list) {
      if (!isOwnedSlug(link.slug, userHash)) continue;
      if (
        requestedTag &&
        !(link.tags ?? []).some((tag) =>
          tag.toLowerCase().includes(requestedTag),
        )
      ) {
        continue;
      }
      const slugKey = link.slug.toLowerCase();
      if (!linksBySlug.has(slugKey)) linksBySlug.set(slugKey, link);
    }

    const reachedLimit = linksBySlug.size >= maxLinks;
    const pageComplete =
      page.listComplete === true ||
      (page.listComplete === undefined &&
        !page.cursor &&
        page.list.length < OWNED_LINK_PAGE_SIZE);

    if (pageComplete) {
      return {
        success: true,
        links: [...linksBySlug.values()].slice(0, maxLinks),
        complete: linksBySlug.size <= maxLinks,
        scannedPages,
        scannedRecords,
      };
    }

    if (reachedLimit) {
      return {
        success: true,
        links: [...linksBySlug.values()].slice(0, maxLinks),
        complete: false,
        scannedPages,
        scannedRecords,
      };
    }

    if (scannedPages >= maxPages) {
      return {
        success: true,
        links: [...linksBySlug.values()],
        complete: false,
        scannedPages,
        scannedRecords,
      };
    }

    const nextCursor = page.cursor;
    if (!nextCursor) {
      return {
        success: false,
        links: [],
        complete: false,
        scannedPages,
        scannedRecords,
        error: "Sink가 미완료 페이지에 다음 커서를 제공하지 않았습니다.",
      };
    }
    if (seenCursors.has(nextCursor)) {
      return {
        success: false,
        links: [],
        complete: false,
        scannedPages,
        scannedRecords,
        error: "Sink가 동일한 페이지 커서를 반복했습니다.",
      };
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    success: true,
    links: [...linksBySlug.values()].slice(0, maxLinks),
    complete: false,
    scannedPages,
    scannedRecords,
  };
}

/**
 * Finds the newest owned link matching a predicate with bounded cursor pagination.
 * This is used as a correctness fallback when Sink search results are capped.
 */
export async function findOwnedLink(
  userHash: string,
  matches: (link: SinkLink) => boolean,
  options: {
    status?: "active" | "expired" | "all";
    maxPages?: number;
    fetchPage?: OwnedLinkPageFetcher;
  } = {},
): Promise<OwnedLinkLookupResult> {
  const maxPages = options.maxPages ?? OWNED_LINK_MAX_PAGES;
  const fetchPage =
    options.fetchPage ??
    ((params: SinkListParams) => sinkClient.listLinks(params));
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let scannedPages = 0;
  let scannedRecords = 0;

  while (scannedPages < maxPages) {
    const page = await fetchPage({
      cursor,
      status: options.status ?? "active",
      sort: "newest",
      limit: OWNED_LINK_PAGE_SIZE,
    });
    scannedPages += 1;
    scannedRecords += page.list.length;

    if (!page.success) {
      return {
        success: false,
        link: null,
        complete: false,
        scannedPages,
        scannedRecords,
        error: page.error ?? "Sink 링크 페이지 조회에 실패했습니다.",
      };
    }

    const link = page.list.find(
      (candidate) => isOwnedSlug(candidate.slug, userHash) && matches(candidate),
    );
    if (link) {
      return {
        success: true,
        link,
        complete: false,
        scannedPages,
        scannedRecords,
      };
    }

    const pageComplete =
      page.listComplete === true ||
      (page.listComplete === undefined &&
        !page.cursor &&
        page.list.length < OWNED_LINK_PAGE_SIZE);
    if (pageComplete) {
      return {
        success: true,
        link: null,
        complete: true,
        scannedPages,
        scannedRecords,
      };
    }

    if (scannedPages >= maxPages) {
      return {
        success: true,
        link: null,
        complete: false,
        scannedPages,
        scannedRecords,
      };
    }

    const nextCursor = page.cursor;
    if (!nextCursor) {
      return {
        success: false,
        link: null,
        complete: false,
        scannedPages,
        scannedRecords,
        error: "Sink가 미완료 페이지에 다음 커서를 제공하지 않았습니다.",
      };
    }
    if (seenCursors.has(nextCursor)) {
      return {
        success: false,
        link: null,
        complete: false,
        scannedPages,
        scannedRecords,
        error: "Sink가 동일한 페이지 커서를 반복했습니다.",
      };
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    success: true,
    link: null,
    complete: false,
    scannedPages,
    scannedRecords,
  };
}
