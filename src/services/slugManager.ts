import { z } from 'zod'
import { config } from '@/config'

export const discordUserIdSchema = z
  .string()
  .trim()
  .regex(/^\d{17,20}$/, 'Invalid Discord user ID')

const BASE36_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Fixed width of {@link getUserHash}. A 64-bit value needs at most 13 base36
 * digits (36^13 > 2^64), so the padding never truncates and the width is
 * stable for every possible input.
 */
export const USER_HASH_LENGTH = 13

const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV64_PRIME = 0x100000001b3n
const FNV64_MASK = 0xffffffffffffffffn

/**
 * Computes the 64-bit FNV-1a digest of a string.
 *
 * This is the reference FNV-1a/64 algorithm, so it reproduces the published
 * test vectors (`""` -> cbf29ce484222325, `"a"` -> af63dc4c8601ec8c,
 * `"foobar"` -> 85944171f73967e8), which is what makes the digest auditable
 * and regression-testable against an external specification rather than
 * against this codebase alone.
 */
function fnv1a64(input: string): bigint {
  let hash = FNV64_OFFSET_BASIS
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV64_PRIME) & FNV64_MASK
  }
  return hash
}

/**
 * Encodes a non-negative integer to a fixed-width lowercase Base36 string.
 *
 * This is injective over non-negative integers below 36^USER_HASH_LENGTH — the
 * encoding never folds two distinct integers onto the same string. Note the
 * boundary: injectivity of the *encoding* says nothing about injectivity of the
 * *function being encoded*. Hashing user IDs into that encoding is only as
 * injective as the hash, which is why the width below is a security property
 * rather than a formatting detail.
 */
function toBase36Wide(value: bigint): string {
  return value.toString(36).padStart(USER_HASH_LENGTH, '0')
}

/**
 * Generates the ownership hash embedded in every slug this bot creates.
 *
 * Ownership is stored in the slug itself and nowhere else: link management is
 * DB-free by design, so there is no `slug -> user_id` table to fall back on.
 * The hash width is therefore the entire security margin of the authorization
 * boundary — `verifyOwnership` grants delete/edit over any slug whose tail
 * matches `getUserHash(user.id)`.
 *
 * CRC32 was used here before, and its 32-bit space was treated as if it were
 * injective. It is not: the birthday bound is ~77k distinct users, real
 * snowflake-shaped collision pairs were found (both users then pass
 * `verifyOwnership` for each other's slugs), and 10k registered users already
 * carries a ~1.1% chance of at least one. FNV-1a/64 widens that bound to
 * ~4 billion users (~1.4e-11 at 10k), keeping the design DB-free.
 *
 * The digest is unsalted, so a party who knows a victim's user ID can still
 * compute their suffix offline; the random slug prefix keeps that from being
 * usable at a glance. Widening the hash fixes the collision failure mode, not
 * the unkeyed one — an HMAC would be the answer if that property is ever
 * required.
 */
export function getUserHash(userId: string): string {
  const parsed = discordUserIdSchema.safeParse(userId)
  if (!parsed.success) {
    throw new Error('Invalid Discord user ID')
  }
  return toBase36Wide(fnv1a64(parsed.data))
}

/**
 * Generates a secure random lowercase alphanumeric string of the specified length.
 */
export function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let result = ''
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0
    result += BASE36_CHARS[byte % 36]
  }
  return result
}

/**
 * Checks if a user is an admin registered in ADMIN_USER_IDS.
 */
export function isAdmin(userId: string): boolean {
  return config.ADMIN_USER_IDS.includes(userId)
}

/**
 * Generates a full slug formatted as `{random}-{userHash}` in all-lowercase.
 */
export function generateSlug(userId: string): string {
  const userHash = getUserHash(userId)
  const randomPart = generateRandomString(config.RANDOM_SLUG_LENGTH)
  return `${randomPart}-${userHash}`
}

/**
 * The single definition of what a slug body means before storage.
 *
 * Every comparison in the custom-slug path — the rename check, the length cap,
 * the ownership suffix test — must read the slug the same way Sink will store
 * it, or the log, the notice and the stored name drift apart. This exists so
 * that normalisation is derived once and reused rather than re-spelled as
 * `slug.trim().toLowerCase()` at each call site.
 */
export function normalizeSlugBody(slug: string): string {
  return slug.trim().toLowerCase()
}

/**
 * Verifies if the given user owns the slug by checking their userHash suffix.
 * Uses case-insensitive comparison to support both mixed-case user input and lowercase-normalized storage in Sink.
 */
export function verifyOwnership(slug: string, userId: string): boolean {
  if (!discordUserIdSchema.safeParse(userId).success) return false
  const userHash = normalizeSlugBody(getUserHash(userId))
  const cleanSlug = normalizeSlugBody(
    slug.startsWith('/') ? slug.substring(1) : slug
  )

  return cleanSlug.endsWith(`-${userHash}`) || cleanSlug === userHash
}

/**
 * Maximum length of a custom slug after the ownership suffix is appended.
 * Leaves room for the `-{userHash}` suffix (`1 + USER_HASH_LENGTH` chars)
 * while staying inside Discord's 100-character `customId` limit, which is
 * what dashboard buttons and select menus embed the slug into.
 */
export const CUSTOM_SLUG_MAX_LENGTH = 64

/**
 * Maximum length of the admin-supplied slug body, i.e. everything before the
 * `-{userHash}` suffix that {@link buildCustomSlug} appends.
 */
export const CUSTOM_SLUG_BASE_MAX_LENGTH =
  CUSTOM_SLUG_MAX_LENGTH - 1 - USER_HASH_LENGTH

/**
 * Returns the slug that should actually be created for a custom-slug request.
 *
 * `verifyOwnership` and `isOwnedSlug` both require a `{something}-{userHash}`
 * tail, so a slug stored verbatim without it is invisible to `/link list` and
 * `/link dashboard` and permanently undeletable via `/link delete`. Rather
 * than reject the admin's chosen name, append the suffix when it is missing so
 * every custom link stays manageable. An input that already ends with the
 * caller's own hash is left alone, so the command is idempotent.
 */
export function buildCustomSlug(slug: string, userId: string): string {
  const userHash = getUserHash(userId)
  const base = normalizeSlugBody(slug)
  if (base.endsWith(`-${userHash}`)) {
    return base
  }
  return `${base}-${userHash}`
}

/**
 * Validates the *shape* of a custom slug, independent of who requested it.
 *
 * The suffix rule is part of the shape: {@link buildCustomSlug} appends
 * `-{userHash}` to anything that lacks it, so a body that leaves no room for
 * the suffix would produce a slug past {@link CUSTOM_SLUG_MAX_LENGTH} — past
 * what this module promises and closer to Discord's 100-character customId
 * limit than intended. Split out from {@link validateCustomSlug} so the rule is
 * testable without an admin-configured environment.
 */
export const customSlugSchema = z
  .string()
  .trim()
  .min(2, 'Custom slug must be between 2 and 64 characters long.')
  .max(
    CUSTOM_SLUG_MAX_LENGTH,
    `Custom slug must be between 2 and ${CUSTOM_SLUG_MAX_LENGTH} characters long.`
  )
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Custom slug can only contain letters, numbers, hyphens (-), and underscores (_).'
  )

export function validateCustomSlugShape(
  slug: string,
  userId: string
): { valid: boolean; reason?: 'shape'; error?: string } {
  const userValidation = discordUserIdSchema.safeParse(userId)
  if (!userValidation.success) {
    return {
      valid: false,
      reason: 'shape',
      error: 'Invalid user ID format.'
    }
  }

  const parsedSlug = customSlugSchema.safeParse(slug)
  if (!parsedSlug.success) {
    return {
      valid: false,
      reason: 'shape',
      error: parsedSlug.error.issues[0]?.message ?? 'Invalid custom slug.'
    }
  }

  // The stored slug gets `-{userHash}` appended so it stays manageable, so the
  // body has to leave room for that suffix inside the length cap. An input
  // that already carries the caller's own suffix is stored as-is. Read the
  // body through the same normalisation `buildCustomSlug` applies, so the cap
  // is measured against exactly the string that gets stored.
  const base = normalizeSlugBody(parsedSlug.data)
  if (
    !base.endsWith(`-${getUserHash(userValidation.data)}`) &&
    base.length > CUSTOM_SLUG_BASE_MAX_LENGTH
  ) {
    return {
      valid: false,
      reason: 'shape',
      error: `Custom slug is too long once the ${1 + USER_HASH_LENGTH}-character ownership suffix is appended. Use ${CUSTOM_SLUG_BASE_MAX_LENGTH} characters or fewer.`
    }
  }

  return { valid: true }
}

/**
 * Validates a custom slug format and checks if the user has permission to create it.
 */
export function validateCustomSlug(
  slug: string,
  userId: string
): { valid: boolean; reason?: 'permission' | 'shape'; error?: string } {
  const userValidation = discordUserIdSchema.safeParse(userId)
  if (!userValidation.success) {
    return {
      valid: false,
      reason: 'shape',
      error: 'Invalid user ID format.'
    }
  }

  const validatedUserId = userValidation.data
  if (!isAdmin(validatedUserId)) {
    return {
      valid: false,
      reason: 'permission',
      error:
        'You do not have permission to create custom slugs. Only administrators can use custom slugs.'
    }
  }

  return validateCustomSlugShape(slug, validatedUserId)
}
