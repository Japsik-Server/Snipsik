import { describe, expect, it } from "bun:test";
import {
  crc32,
  toBase62,
  getUserHash,
  generateSlug,
  verifyOwnership,
  validateCustomSlug,
} from "@/services/slugManager";

describe("SlugManager Unit Tests", () => {
  it("should calculate deterministic CRC32 and Base62 user hashes", () => {
    const userId1 = "294123456789012345";
    const userId2 = "294123456789012346";

    const hash1 = getUserHash(userId1);
    const hash2 = getUserHash(userId2);

    expect(typeof hash1).toBe("string");
    expect(hash1.length).toBeGreaterThanOrEqual(3);
    expect(hash1).not.toBe(hash2);

    // Deterministic check
    expect(getUserHash(userId1)).toBe(hash1);
  });

  it("should generate proper slug format {random}-{userHash}", () => {
    const userId = "123456789012345678";
    const userHash = getUserHash(userId);
    const slug = generateSlug(userId);

    expect(slug).toContain(`-${userHash}`);
    expect(slug.endsWith(`-${userHash}`)).toBe(true);
  });

  it("should verify ownership accurately and enforce case-sensitivity", () => {
    const userA = "111111111111111111";
    const userB = "222222222222222222";

    const hashA = getUserHash(userA);
    const slugA = generateSlug(userA);

    expect(verifyOwnership(slugA, userA)).toBe(true);
    expect(verifyOwnership(slugA, userB)).toBe(false);

    // Case-altered hash should not match because Base62 is case-sensitive
    const invertedHash = hashA
      .split("")
      .map((c) =>
        c >= "a" && c <= "z"
          ? c.toUpperCase()
          : c >= "A" && c <= "Z"
            ? c.toLowerCase()
            : c,
      )
      .join("");
    if (invertedHash !== hashA) {
      expect(verifyOwnership(`test-${invertedHash}`, userA)).toBe(false);
    }
  });

  it("should validate custom slugs properly", () => {
    // Non-admin user
    const regularUser = "999999999999999999";
    const result = validateCustomSlug("my-custom-link", regularUser);
    expect(result.valid).toBe(false);
  });
});
