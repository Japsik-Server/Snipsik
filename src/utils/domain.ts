import { config } from "@/config";

/**
 * Built-in default media and GIF service domains that should be excluded from auto-shortening.
 * Covers Discord's native GIF picker partners (Tenor, Giphy), Discord CDN/media proxies, and common image hosts (Imgur).
 */
export const DEFAULT_SYSTEM_IGNORED_DOMAINS: readonly string[] = Object.freeze([
  "tenor.com",
  "giphy.com",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "imgur.com",
]);

/**
 * Maximum number of custom ignored domains allowed per guild or user to prevent memory/DB bloat.
 */
export const MAX_CUSTOM_IGNORED_DOMAINS = 50;

/**
 * Normalizes a user or system input into a valid lowercase FQDN domain string.
 * Strips protocols (http/https), leading wildcards (*.), ports (:8080), paths (/...),
 * query parameters, and leading/trailing dots.
 *
 * @param input - The raw domain or URL string to normalize.
 * @returns The normalized domain string (e.g. "tenor.com"), or null if invalid.
 */
export function normalizeDomain(input: string): string | null {
  if (!input || typeof input !== "string") return null;

  let cleaned = input.trim().toLowerCase();

  // Strip wildcard prefixes like *.
  cleaned = cleaned.replace(/^\*\./, "");

  // If input contains protocol or protocol-relative slashes, parse via URL
  if (/^https?:\/\//i.test(cleaned) || cleaned.startsWith("//")) {
    try {
      const parsed = new URL(
        cleaned.startsWith("//") ? `http:${cleaned}` : cleaned,
      );
      cleaned = parsed.hostname;
    } catch {
      return null;
    }
  }

  // Strip port, path, query, or hash if entered without protocol (e.g., "example.com:8080/path?q=1")
  const slashPart = cleaned.split("/")[0] ?? "";
  const queryPart = slashPart.split("?")[0] ?? "";
  const hashPart = queryPart.split("#")[0] ?? "";
  cleaned = (hashPart.split(":")[0] ?? "").trim();

  // Strip leading and trailing dots
  cleaned = cleaned.replace(/^\.+|\.+$/g, "");

  if (!cleaned) return null;

  // RFC domain validation: length <= 253, at least one dot
  if (cleaned.length > 253 || !cleaned.includes(".")) return null;

  const labels = cleaned.split(".");
  const labelRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const label of labels) {
    if (!labelRegex.test(label)) {
      return null;
    }
  }

  // Top-level domain must not be purely numeric (RFC 1123)
  const tld = labels[labels.length - 1];
  if (!tld || /^\d+$/.test(tld)) {
    return null;
  }

  return cleaned;
}

/**
 * Returns all system-level default ignored domains (hardcoded defaults + ENV config.IGNORED_DOMAINS).
 *
 * @returns Array of normalized system-level ignored domain strings.
 */
export function getAllSystemDefaultDomains(): string[] {
  const result = new Set<string>(DEFAULT_SYSTEM_IGNORED_DOMAINS);

  if (config && Array.isArray(config.IGNORED_DOMAINS)) {
    for (const d of config.IGNORED_DOMAINS) {
      const norm = normalizeDomain(d);
      if (norm) {
        result.add(norm);
      }
    }
  }

  return Array.from(result);
}

/**
 * Checks whether a given domain is already covered by system defaults or ENV.
 *
 * @param domain - The candidate domain string to check.
 * @returns True if already covered by system defaults.
 */
export function isSystemDefaultDomain(domain: string): boolean {
  const norm = normalizeDomain(domain);
  if (!norm) return false;

  const systemDomains = getAllSystemDefaultDomains();
  return isDomainIgnored(norm, systemDomains);
}

/**
 * Determines whether a URL or hostname matches any of the ignored domains,
 * supporting exact matches and automatic subdomain matches (e.g., "c.tenor.com" matches "tenor.com").
 *
 * @param urlOrHostname - The URL string or hostname to evaluate.
 * @param ignoredDomains - An iterable collection of ignored domain strings.
 * @returns True if the target URL/hostname should be ignored, false otherwise.
 */
export function isDomainIgnored(
  urlOrHostname: string,
  ignoredDomains: Iterable<string>,
): boolean {
  if (!urlOrHostname) return false;

  let hostname = urlOrHostname.trim().toLowerCase();

  if (hostname.includes("://") || hostname.startsWith("//")) {
    try {
      const parsed = new URL(
        hostname.startsWith("//") ? `http:${hostname}` : hostname,
      );
      hostname = parsed.hostname.toLowerCase();
    } catch {
      return false;
    }
  } else {
    const slashPart = hostname.split("/")[0] ?? "";
    const queryPart = slashPart.split("?")[0] ?? "";
    const hashPart = queryPart.split("#")[0] ?? "";
    hostname = (hashPart.split(":")[0] ?? "").trim().toLowerCase();
  }

  if (!hostname) return false;

  for (const domain of ignoredDomains) {
    const normDomain = domain.trim().toLowerCase();
    if (!normDomain) continue;

    // Exact match or subdomain match (.domain)
    if (hostname === normDomain || hostname.endsWith(`.${normDomain}`)) {
      return true;
    }
  }

  return false;
}
