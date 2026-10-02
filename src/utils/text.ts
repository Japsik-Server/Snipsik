/**
 * Shared text helpers for bounding and de-forging text that reaches Discord.
 *
 * Kept dependency-free on purpose: `ui.ts`, `services/sinkClient.ts` and
 * `utils/safeHttp.ts` all need these, and importing any of those from each
 * other would create a cycle.
 */

/** Discord rejects a Components v2 message whose combined text content exceeds this. */
export const MAX_MESSAGE_TEXT_CONTENT = 4_000

/** Longest link title accepted from a Sink response or a Discord modal. */
export const MAX_LINK_TITLE_LENGTH = 100

/** Longest third-party text (an upstream error body, a status line) shown to a user. */
export const MAX_EXTERNAL_TEXT_LENGTH = 200

/** Longest HTTP status reason phrase carried through `/link check`. */
export const MAX_STATUS_TEXT_LENGTH = 100

/** Zero-width space, inserted to make a mention sigil unparseable. */
const ZWSP = '​'

/** Matches `@everyone`, `@here` and user/role/channel mention syntax. */
const MENTION_PATTERN = /@(everyone|here)|<([@#])([!&]?\d+)>/gi

/**
 * Strips C0/C1 control characters, which can be used to break out of a
 * `` `code` `` span. Written as a char-code scan because Biome rejects a
 * literal control-character class in a regex.
 */
function stripControlCharacters(text: string): string {
  let result = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    result += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : char
  }
  return result
}

/**
 * Shortens a string to `maxLength`, keeping both ends so an identifier stays
 * recognisable (`https://example.com/.../path` -> `https://ex...path`).
 */
export function truncateMiddle(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  const keep = Math.max(0, maxLength - 3)
  const front = Math.ceil(keep / 2)
  const back = Math.floor(keep / 2)
  return `${str.substring(0, front)}...${str.substring(str.length - back)}`
}

/**
 * Defuses Discord mentions by inserting a zero-width space after the sigil.
 *
 * A hostile or broken upstream can return `@everyone` / `<@&id>` inside an
 * error body; rendering that verbatim would ping a whole server from text we
 * never authored. U+200B keeps the text readable while making it unparseable.
 */
export function neutralizeMentions(text: string): string {
  return text.replace(
    MENTION_PATTERN,
    (_match, keyword: string | undefined, sigil?: string, id?: string) =>
      keyword
        ? `@${keyword[0]}${ZWSP}${keyword.slice(1)}`
        : `<${sigil}${ZWSP}${id}`
  )
}

/**
 * Prepares untrusted third-party text for a user-facing Discord message:
 * defuses mentions, strips control characters, and caps the length.
 */
export function sanitizeExternalText(
  text: unknown,
  maxLength: number = MAX_EXTERNAL_TEXT_LENGTH
): string {
  const str = typeof text === 'string' ? text : String(text ?? '')
  return truncateMiddle(
    neutralizeMentions(stripControlCharacters(str).trim()),
    maxLength
  )
}
