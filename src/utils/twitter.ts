/**
 * Twitter (X) domain and URL manipulation utilities.
 * Handles detection of tweet status URLs and conversion to fixupx.com for enhanced Discord embeds.
 */

const TWITTER_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "x.com",
  "www.x.com",
  "mobile.x.com",
]);

/**
 * Regex matching Twitter/X status URLs:
 * Matches /username/status/123456 or /i/web/status/123456
 * Allows trailing subpaths like /photo/1 or /video/1
 */
const TWEET_STATUS_PATH_REGEX =
  /^\/([a-zA-Z0-9_]{1,50}|i\/web)\/status(?:es)?\/(\d+)(?:\/[a-zA-Z0-9_]+)*\/?$/i;

/**
 * Common tracking query parameters appended by Twitter/X share buttons and external referrers.
 */
const TRACKING_QUERY_PARAMS = new Set([
  "s",
  "t",
  "ref_src",
  "ref_url",
  "mx",
  "fbclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
]);

/**
 * Checks whether a hostname belongs to Twitter/X (excluding embed proxy domains like fixupx.com).
 *
 * @param hostname - Hostname to check (e.g. "x.com", "mobile.twitter.com")
 * @returns True if the hostname is a Twitter/X domain
 */
export function isTwitterDomain(hostname: string): boolean {
  if (!hostname) return false;
  const lower = hostname.trim().toLowerCase();
  return TWITTER_HOSTS.has(lower);
}

/**
 * Parses and checks if a URL is a Twitter/X tweet status post URL.
 * Excludes profiles (e.g. x.com/user), search, spaces, and home URLs.
 *
 * @param urlString - Candidate URL string
 * @returns True if the URL is a tweet status post
 */
export function isTweetUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (!isTwitterDomain(parsed.hostname)) {
      return false;
    }
    return TWEET_STATUS_PATH_REGEX.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Converts a Twitter/X tweet status URL to a fixupx.com URL,
 * stripping common tracking query parameters.
 *
 * @param urlString - Original Twitter/X URL string
 * @returns Clean fixupx.com URL string, or null if not a valid tweet URL
 */
export function convertToFixupxUrl(urlString: string): string | null {
  try {
    const parsed = new URL(urlString);
    if (!isTwitterDomain(parsed.hostname)) {
      return null;
    }

    if (!TWEET_STATUS_PATH_REGEX.test(parsed.pathname)) {
      return null;
    }

    // Rewrite hostname to fixupx.com
    parsed.hostname = "fixupx.com";
    parsed.protocol = "https:";
    parsed.port = "";

    // Clean tracking query parameters
    const paramsToDelete: string[] = [];
    for (const [key] of parsed.searchParams.entries()) {
      if (
        TRACKING_QUERY_PARAMS.has(key.toLowerCase()) ||
        key.toLowerCase().startsWith("utm_")
      ) {
        paramsToDelete.push(key);
      }
    }

    for (const key of paramsToDelete) {
      parsed.searchParams.delete(key);
    }

    // Strip hash fragment
    parsed.hash = "";

    return parsed.toString();
  } catch {
    return null;
  }
}
