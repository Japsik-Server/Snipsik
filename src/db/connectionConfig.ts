export const ALLOWED_DB_PROTOCOLS = [
  "libsql:",
  "file:",
  "https:",
  "http:",
  "wss:",
  "ws:",
] as const;

export function firstConfiguredValue(
  primary: string | undefined,
  fallback: string | undefined,
): string | undefined {
  if (primary?.trim()) return primary;
  if (fallback?.trim()) return fallback;
  return undefined;
}
