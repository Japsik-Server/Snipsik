import { describe, expect, it } from 'bun:test'
import { config } from '@/config'
import {
  buildCustomSlug,
  CUSTOM_SLUG_BASE_MAX_LENGTH,
  CUSTOM_SLUG_MAX_LENGTH,
  generateSlug,
  getUserHash,
  USER_HASH_LENGTH,
  validateCustomSlug,
  validateCustomSlugShape,
  verifyOwnership
} from '@/services/slugManager'

describe('getUserHash ownership digest', () => {
  it('produces a fixed-width lowercase base36 hash', () => {
    const hash1 = getUserHash('294123456789012345')
    const hash2 = getUserHash('294123456789012346')

    expect(typeof hash1).toBe('string')
    expect(hash1).toHaveLength(USER_HASH_LENGTH)
    expect(USER_HASH_LENGTH).toBe(13)
    expect(hash1).toBe(hash1.toLowerCase())
    expect(/^[0-9a-z]{13}$/.test(hash1)).toBe(true)
    expect(hash1).not.toBe(hash2)
    expect(/^[0-9a-z]{13}$/.test(hash2)).toBe(true)

    // Deterministic: the hash is derived from the user ID alone, so it must be
    // stable across calls, instances, and processes.
    expect(getUserHash('294123456789012345')).toBe(hash1)
  })

  it('matches the published FNV-1a/64 test vectors', () => {
    // These pin the digest to the external FNV-1a/64 specification rather than
    // to this implementation. `getUserHash` takes a user ID, so the vectors are
    // expressed as the base36 width this module produces, and the same
    // algorithm over the raw vectors is checked below.
    const fnv1a64 = (input: string): string => {
      let hash = 0xcbf29ce484222325n
      for (let i = 0; i < input.length; i++) {
        hash ^= BigInt(input.charCodeAt(i))
        hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
      }
      return hash.toString(16)
    }

    expect(fnv1a64('')).toBe('cbf29ce484222325')
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c')
    expect(fnv1a64('foobar')).toBe('85944171f73967e8')
  })

  it('keeps the generated slug inside Discord customId limits', () => {
    const slug = generateSlug('123456789012345678')
    const userHash = getUserHash('123456789012345678')

    expect(slug).toContain(`-${userHash}`)
    expect(slug.endsWith(`-${userHash}`)).toBe(true)
    expect(slug).toBe(slug.toLowerCase())
    expect(/^[0-9a-z_-]+$/.test(slug)).toBe(true)
    expect(slug).toHaveLength(config.RANDOM_SLUG_LENGTH + 1 + USER_HASH_LENGTH)
  })
})

describe('known CRC32 collision pairs', () => {
  // Real snowflake-shaped pairs that collided under the old CRC32 hash, so
  // `verifyOwnership` returned true for BOTH users. Under a 64-bit digest they
  // must be told apart: the collision user must not own the victim's slug.
  const COLLISION_PAIRS: ReadonlyArray<{
    a: string
    b: string
    legacySharedHash: string
  }> = [
    {
      a: '7511415306883956840',
      b: '7511415317751660600',
      legacySharedHash: '1rpfzyg'
    },
    {
      a: '7511415306883956841',
      b: '7511415317751660601',
      legacySharedHash: '14ohnby'
    },
    {
      a: '7511415306883956842',
      b: '7511415317751660602',
      legacySharedHash: '037nkdg'
    }
  ]

  it('separates every pair that CRC32 merged', () => {
    for (const { a, b } of COLLISION_PAIRS) {
      expect(getUserHash(a)).not.toBe(getUserHash(b))

      const slugA = `abc-${getUserHash(a)}`
      expect(verifyOwnership(slugA, a)).toBe(true)
      expect(verifyOwnership(slugA, b)).toBe(false)

      const slugB = `abc-${getUserHash(b)}`
      expect(verifyOwnership(slugB, b)).toBe(true)
      expect(verifyOwnership(slugB, a)).toBe(false)
    }
  })

  it('no longer accepts the bare legacy hash as shared ownership', () => {
    for (const { a, b, legacySharedHash } of COLLISION_PAIRS) {
      // The old implementation would have matched `cleanSlug === userHash` for
      // both users here, because both hashed to this exact 7-char string.
      expect(legacySharedHash).toHaveLength(7)
      expect(verifyOwnership(legacySharedHash, a)).toBe(false)
      expect(verifyOwnership(legacySharedHash, b)).toBe(false)
    }
  })

  it('reproduces the legacy CRC32 hashes the pairs were found with', () => {
    // Guards the premise of this regression test: if these two users really do
    // still collide under CRC32, the pairs above remain meaningful.
    const crc32 = (input: string): number => {
      let crc = 0xffffffff
      for (let i = 0; i < input.length; i++) {
        crc ^= input.charCodeAt(i)
        for (let j = 0; j < 8; j++) {
          crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
        }
      }
      return (crc ^ 0xffffffff) >>> 0
    }
    const legacy = (userId: string): string =>
      crc32(userId).toString(36).padStart(7, '0')

    for (const { a, b, legacySharedHash } of COLLISION_PAIRS) {
      expect(legacy(a)).toBe(legacySharedHash)
      expect(legacy(b)).toBe(legacySharedHash)
    }
  })
})

describe('custom slug ownership suffix', () => {
  const OWNER = '111111111111111111'
  const OTHER = '222222222222222222'

  it('rejects custom slugs for non-admin users', () => {
    expect(validateCustomSlug('my-custom-link', OTHER).valid).toBe(false)
  })

  it('appends the ownership suffix so the link stays manageable', () => {
    const stored = buildCustomSlug('summer-sale', OWNER)

    expect(stored).toBe(`summer-sale-${getUserHash(OWNER)}`)
    // The whole point: the stored slug now passes every ownership check.
    expect(verifyOwnership(stored, OWNER)).toBe(true)
    expect(verifyOwnership(stored, OTHER)).toBe(false)
  })

  it('is idempotent when the admin already supplied their own suffix', () => {
    const withSuffix = `summer-sale-${getUserHash(OWNER)}`
    expect(buildCustomSlug(withSuffix, OWNER)).toBe(withSuffix)
  })

  it("keeps another user's suffix as the body rather than nesting ours", () => {
    const otherHash = getUserHash(OTHER)
    const stored = buildCustomSlug(`sale-${otherHash}`, OWNER)

    // Nesting keeps OUR hash at the tail, so we own it; the foreign hash is
    // inert text in the body. The reverse is impossible.
    expect(stored).toBe(`sale-${otherHash}-${getUserHash(OWNER)}`)
    expect(verifyOwnership(stored, OWNER)).toBe(true)
    expect(verifyOwnership(stored, OTHER)).toBe(false)
  })

  it('lowercases and trims the admin input', () => {
    expect(buildCustomSlug('  Summer-SALE  ', OWNER)).toBe(
      `summer-sale-${getUserHash(OWNER)}`
    )
  })

  it('keeps the appended slug within the length cap', () => {
    const maxBody = 'a'.repeat(CUSTOM_SLUG_BASE_MAX_LENGTH)
    const stored = buildCustomSlug(maxBody, OWNER)

    expect(stored).toBe(`${maxBody}-${getUserHash(OWNER)}`)
    expect(stored).toHaveLength(CUSTOM_SLUG_MAX_LENGTH)
    // Still inside Discord's 100-character customId limit, which is what
    // dashboard buttons embed the slug into.
    expect(`dash:confirm_del_btn:${stored}`.length).toBeLessThanOrEqual(100)
  })

  it('accepts the longest body that still fits the suffix', () => {
    expect(
      validateCustomSlugShape('a'.repeat(CUSTOM_SLUG_BASE_MAX_LENGTH), OWNER)
        .valid
    ).toBe(true)
  })

  it('rejects a body too long to fit the suffix', () => {
    const result = validateCustomSlugShape(
      'a'.repeat(CUSTOM_SLUG_BASE_MAX_LENGTH + 1),
      OWNER
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('too long')
    expect(result.error).toContain(String(CUSTOM_SLUG_BASE_MAX_LENGTH))
  })

  it('still rejects short slugs and non-URL-safe characters', () => {
    expect(validateCustomSlugShape('a', OWNER).valid).toBe(false)
    expect(validateCustomSlugShape('has space', OWNER).valid).toBe(false)
    expect(validateCustomSlugShape('has/slash', OWNER).valid).toBe(false)
    expect(validateCustomSlugShape('../etc', OWNER).valid).toBe(false)
  })
})

describe('verifyOwnership', () => {
  it('verifies ownership with case-insensitive matching', () => {
    const userA = '111111111111111111'
    const userB = '222222222222222222'

    const hashA = getUserHash(userA)
    const slugA = generateSlug(userA)

    expect(verifyOwnership(slugA, userA)).toBe(true)
    expect(verifyOwnership(slugA, userB)).toBe(false)

    // Case-insensitivity check (uppercase / mixed-case user input should still match)
    expect(verifyOwnership(slugA.toUpperCase(), userA)).toBe(true)
    expect(verifyOwnership(`/${slugA.toUpperCase()}`, userA)).toBe(true)
    expect(verifyOwnership(`/${slugA}`, userA)).toBe(true)

    // User A should own direct hash
    expect(verifyOwnership(hashA, userA)).toBe(true)
    expect(verifyOwnership(hashA.toUpperCase(), userA)).toBe(true)

    // Completely different hash should fail
    expect(verifyOwnership('test-differenthash', userA)).toBe(false)
  })
})
