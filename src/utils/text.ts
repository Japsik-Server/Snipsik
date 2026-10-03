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

/** Matches `@everyone`, `@here`, role mentions `<@&id>`, user mentions `<@id>`, and channel mentions `<#id>`. */
const MENTION_PATTERN = /@(everyone|here)|<@&(\d+)>|<@(!?\d+)>|(<#\d+>)/gi

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
 * Drops a trailing lone high surrogate from a slice that was cut mid-pair.
 *
 * `substring` counts UTF-16 code units, so cutting an emoji in half leaves a
 * high surrogate with no following low surrogate. Discord renders that as a
 * replacement character, and the edit modal saves the truncated value back, so
 * the corruption would become permanent.
 */
function dropLoneHighSurrogate(value: string): string {
  if (value.length === 0) return value
  const last = value.charCodeAt(value.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? value.slice(0, -1) : value
}

/**
 * Drops a leading lone low surrogate from a slice that was cut mid-pair.
 */
function dropLoneLowSurrogate(value: string): string {
  if (value.length === 0) return value
  const first = value.charCodeAt(0)
  return first >= 0xdc00 && first <= 0xdfff ? value.slice(1) : value
}

/**
 * Shortens a string to `maxLength`, keeping both ends so an identifier stays
 * recognisable (`https://example.com/.../path` -> `https://ex...path`).
 *
 * Cuts on code-point boundaries so an emoji is never split in half.
 */
export function truncateMiddle(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  if (maxLength <= 0) return ''
  if (maxLength < 3) {
    const chars = Array.from(str)
    let out = ''
    for (const c of chars) {
      if ((out + c).length > maxLength) break
      out += c
    }
    return out
  }
  const keep = Math.max(0, maxLength - 3)
  const front = Math.ceil(keep / 2)
  const back = Math.floor(keep / 2)
  const head = dropLoneHighSurrogate(str.substring(0, front))
  const tail = dropLoneLowSurrogate(str.substring(str.length - back))
  return `${head}...${tail}`
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
    (
      match,
      keyword?: string,
      roleId?: string,
      userId?: string,
      channelMention?: string
    ) => {
      if (keyword) return `@${keyword[0]}${ZWSP}${keyword.slice(1)}`
      if (roleId) return `<@&${ZWSP}${roleId}>`
      if (userId) return `<@${ZWSP}${userId}>`
      if (channelMention) return channelMention
      return match
    }
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
