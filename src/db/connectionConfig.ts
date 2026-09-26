export const ALLOWED_DB_PROTOCOLS = [
  "libsql:",
  "file:",
  "https:",
  "http:",
  "wss:",
  "ws:",
] as const;

export function assertValidDatabaseUrl(url: string): string {
  const normalizedUrl = url.trim();
  const lower = normalizedUrl.toLowerCase();
  if (lower.startsWith("postgres:") || lower.startsWith("postgresql:")) {
    throw new Error(
      `Invalid database URL: must start with one of ${ALLOWED_DB_PROTOCOLS.join(", ")}`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new Error("Invalid database URL: must be a valid absolute URL");
  }

  const protocol = parsed.protocol.toLowerCase();
  if (
    (protocol !== "file:" && parsed.host.length === 0) ||
    (protocol === "file:" && parsed.pathname.length <= 1)
  ) {
    throw new Error("Invalid database URL: must be a valid absolute URL");
  }

  if (
    !ALLOWED_DB_PROTOCOLS.includes(
      protocol as (typeof ALLOWED_DB_PROTOCOLS)[number],
    )
  ) {
    throw new Error(
      `Invalid database URL: must start with one of ${ALLOWED_DB_PROTOCOLS.join(", ")}`,
    );
  }

  return normalizedUrl;
}

export function firstConfiguredValue(
  primary: string | undefined,
  fallback: string | undefined,
): string | undefined {
  if (primary?.trim()) return primary;
  if (fallback?.trim()) return fallback;
  return undefined;
}
