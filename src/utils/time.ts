/**
 * Parses user input expiration string (e.g., '10m', '1h', '24h', '7d', '3600') into an ISO date string or timestamp.
 */
export function parseExpiration(input?: string | null): string | number | undefined {
  if (!input || !input.trim()) return undefined;

  const trimmed = input.trim().toLowerCase();

  // If already pure number of seconds
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    const date = new Date(Date.now() + seconds * 1000);
    return date.toISOString();
  }

  const match = trimmed.match(/^(\d+)\s*(s|m|h|d|w|y)?$/);
  if (!match) {
    // Try parsing as ISO date string
    const parsedDate = new Date(trimmed);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
    return undefined;
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2] || "s";

  let multiplier = 1000;
  switch (unit) {
    case "s":
      multiplier = 1000;
      break;
    case "m":
      multiplier = 60 * 1000;
      break;
    case "h":
      multiplier = 60 * 60 * 1000;
      break;
    case "d":
      multiplier = 24 * 60 * 60 * 1000;
      break;
    case "w":
      multiplier = 7 * 24 * 60 * 60 * 1000;
      break;
    case "y":
      multiplier = 365 * 24 * 60 * 60 * 1000;
      break;
  }

  const targetDate = new Date(Date.now() + value * multiplier);
  return targetDate.toISOString();
}
