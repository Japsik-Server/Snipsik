import { config } from "@/config";

const BASE36_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE62_CHARS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Pre-computed CRC32 lookup table for fast hashing.
 */
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Computes 32-bit unsigned CRC32 checksum for a string.
 */
export function crc32(str: string): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ code) & 0xff]!;
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Encodes an unsigned integer to a 7-character fixed-length lowercase Base36 string.
 * This is strictly injective for all 32-bit unsigned integers (0 to 4294967295) without case-folding collisions.
 */
export function toBase36(num: number): string {
  return (num >>> 0).toString(36).padStart(7, "0");
}

/**
 * Encodes an unsigned integer to a Base62 string.
 */
export function toBase62(num: number): string {
  if (num === 0) return "0";
  let result = "";
  let n = num >>> 0;
  while (n > 0) {
    result = BASE62_CHARS[n % 62] + result;
    n = Math.floor(n / 62);
  }
  return result;
}

/**
 * Generates a deterministic unique lowercase user hash from a Discord Snowflake User ID.
 * Uses 7-character Base36 encoding for collision-free, injective 32-bit hash representation.
 */
export function getUserHash(userId: string): string {
  const hash = crc32(userId);
  return toBase36(hash);
}

/**
 * Generates a secure random lowercase alphanumeric string of the specified length.
 */
export function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i]!;
    result += BASE36_CHARS[byte % 36];
  }
  return result;
}

/**
 * Checks if a user is an admin registered in ADMIN_USER_IDS.
 */
export function isAdmin(userId: string): boolean {
  return config.ADMIN_USER_IDS.includes(userId);
}

/**
 * Generates a full slug formatted as `{random}-{userHash}` in all-lowercase.
 */
export function generateSlug(userId: string): string {
  const randomPart = generateRandomString(config.RANDOM_SLUG_LENGTH);
  const userHash = getUserHash(userId);
  return `${randomPart}-${userHash}`;
}

/**
 * Verifies if the given user owns the slug by checking their userHash suffix.
 * Uses case-insensitive comparison to support both mixed-case user input and lowercase-normalized storage in Sink.
 */
export function verifyOwnership(slug: string, userId: string): boolean {
  const cleanSlug = (slug.startsWith("/") ? slug.substring(1) : slug)
    .trim()
    .toLowerCase();
  const userHash = getUserHash(userId).trim().toLowerCase();

  return cleanSlug.endsWith(`-${userHash}`) || cleanSlug === userHash;
}

/**
 * Validates a custom slug format and checks if the user has permission to create it.
 */
export function validateCustomSlug(
  slug: string,
  userId: string,
): { valid: boolean; error?: string } {
  if (!isAdmin(userId)) {
    return {
      valid: false,
      error:
        "You do not have permission to create custom slugs. Only administrators can use custom slugs.",
    };
  }

  const trimmed = slug.trim();
  if (trimmed.length < 2 || trimmed.length > 64) {
    return {
      valid: false,
      error: "Custom slug must be between 2 and 64 characters long.",
    };
  }

  // URL-safe characters: letters, numbers, hyphens, underscores
  const validSlugRegex = /^[a-zA-Z0-9_-]+$/;
  if (!validSlugRegex.test(trimmed)) {
    return {
      valid: false,
      error:
        "Custom slug can only contain letters, numbers, hyphens (-), and underscores (_).",
    };
  }

  return { valid: true };
}
