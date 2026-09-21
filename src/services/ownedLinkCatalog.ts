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
    }
  | {
      success: false;
      links: [];
      complete: false;
      scannedPages: number;
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
  const linksBySlug = new Map<string, SinkLink>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let scannedPages = 0;

  while (linksBySlug.size < maxLinks) {
    const page = await fetchPage({
      cursor,
      tag: options.tag,
      status: "all",
      sort: "newest",
      limit: OWNED_LINK_PAGE_SIZE,
    });
    scannedPages += 1;

    if (!page.success) {
      return {
        success: false,
        links: [],
        complete: false,
        scannedPages,
        error: page.error || "Sink 링크 페이지 조회에 실패했습니다.",
      };
    }

    for (const link of page.list) {
      if (!isOwnedSlug(link.slug, userHash)) continue;
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
      };
    }

    if (reachedLimit) {
      return {
        success: true,
        links: [...linksBySlug.values()].slice(0, maxLinks),
        complete: false,
        scannedPages,
      };
    }

    if (scannedPages >= maxPages) {
      return {
        success: true,
        links: [...linksBySlug.values()],
        complete: false,
        scannedPages,
      };
    }

    const nextCursor = page.cursor ?? undefined;
    if (!nextCursor) {
      return {
        success: false,
        links: [],
        complete: false,
        scannedPages,
        error: "Sink가 미완료 페이지에 다음 커서를 제공하지 않았습니다.",
      };
    }
    if (seenCursors.has(nextCursor)) {
      return {
        success: false,
        links: [],
        complete: false,
        scannedPages,
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
  };
}
