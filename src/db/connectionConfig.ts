export function firstConfiguredValue(primary: string | undefined, fallback: string | undefined): string | undefined {
  if (primary?.trim()) return primary;
  if (fallback?.trim()) return fallback;
  return undefined;
}
