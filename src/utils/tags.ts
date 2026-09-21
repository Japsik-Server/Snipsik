export const MAX_LINK_TAGS = 10;
export const MAX_LINK_TAG_LENGTH = 32;

export type TagsParseResult =
  | { valid: true; value: string[] }
  | { valid: false; error: string };

/** Maps the compact Discord text input to Sink's normalized tags array. */
export function parseTagsInput(input?: string | null): TagsParseResult {
  if (!input || !input.trim()) return { valid: true, value: [] };

  const tags = [
    ...new Set(
      input
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean),
    ),
  ];

  if (tags.length > MAX_LINK_TAGS) {
    return {
      valid: false,
      error: `태그는 최대 ${MAX_LINK_TAGS}개까지 입력할 수 있습니다.`,
    };
  }
  const tooLong = tags.find((tag) => tag.length > MAX_LINK_TAG_LENGTH);
  if (tooLong) {
    return {
      valid: false,
      error: `각 태그는 ${MAX_LINK_TAG_LENGTH}자 이하여야 합니다: ${tooLong}`,
    };
  }

  return { valid: true, value: tags };
}

export function formatTags(tags?: readonly string[]): string {
  return tags?.length ? tags.join(", ") : "";
}
