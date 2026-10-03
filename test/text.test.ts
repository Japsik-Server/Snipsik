import { describe, expect, it } from 'bun:test'
import {
  neutralizeMentions,
  sanitizeExternalText,
  truncateMiddle
} from '@/utils/text'

/** True when the string carries an unpaired UTF-16 surrogate. */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    const isHigh = code >= 0xd800 && code <= 0xdbff
    const isLow = code >= 0xdc00 && code <= 0xdfff
    if (isHigh) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++
    } else if (isLow) {
      return true
    }
  }
  return false
}

describe('truncateMiddle never splits a surrogate pair', () => {
  // `substring` counts UTF-16 code units, so a cut landing on an emoji boundary
  // used to emit a lone surrogate into the Discord message and into the edit
  // modal prefill. Because the modal saves the truncated value back, the
  // corruption became permanent.
  const SAMPLES = [
    '안녕하세요 👋 반갑습니다',
    '제목이 아주 긴 경우입니다 🎉 축하합니다',
    'a🎉b🎊c🎈d',
    '🎉',
    '👨‍👩‍👧‍👦 family emoji sequence',
    '한국어 텍스트 뒤에 이모지가 있습니다 🚀🚀🚀'
  ]

  it.each(SAMPLES)(
    'emits no lone surrogate at any truncation length for %p',
    text => {
      for (let maxLength = 0; maxLength <= text.length + 6; maxLength++) {
        const result = truncateMiddle(text, maxLength)
        expect(hasLoneSurrogate(result)).toBe(false)
      }
    }
  )

  it('emits no lone surrogate through sanitizeExternalText', () => {
    for (const text of SAMPLES) {
      for (let maxLength = 0; maxLength <= text.length + 6; maxLength++) {
        expect(hasLoneSurrogate(sanitizeExternalText(text, maxLength))).toBe(
          false
        )
      }
    }
  })

  it('drops the split emoji rather than leaving a replacement character', () => {
    // maxLength 5 leaves keep=2, so front=1 (half of the first 👋) and
    // back=1. A surrogate-aware cut must produce a clean 3-char result.
    const result = truncateMiddle('안녕하세요 👋 반갑습니다', 5)
    expect(hasLoneSurrogate(result)).toBe(false)
    expect(result).not.toContain('�')
  })

  it('leaves a string that already fits untouched', () => {
    expect(truncateMiddle('짧은 제목', 100)).toBe('짧은 제목')
  })

  it('bounds output length even when maxLength is less than 3', () => {
    expect(truncateMiddle('abcdef', 0)).toBe('')
    expect(truncateMiddle('abcdef', 1)).toBe('a')
    expect(truncateMiddle('abcdef', 2)).toBe('ab')
  })
})

describe('neutralizeMentions', () => {
  it('neutralizes @everyone, @here, role mentions, and user mentions while preserving channel mentions', () => {
    const input =
      'Alert @everyone and @here: ask <@123456789> or <@!987654321> and ping <@&111222> in <#333444>'
    const result = neutralizeMentions(input)
    expect(result).not.toContain('@everyone')
    expect(result).not.toContain('@here')
    expect(result).not.toContain('<@123456789>')
    expect(result).not.toContain('<@!987654321>')
    expect(result).not.toContain('<@&111222>')
    expect(result).toContain('<#333444>')
  })
})
