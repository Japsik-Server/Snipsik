import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  buildEditLinkPayload,
  onInteractionCreate
} from '@/events/interactionCreate'
import {
  clearDashboardLinkSnapshots,
  getDashboardLinkSnapshot,
  storeDashboardLinkSnapshots
} from '@/services/dashboardLinkSnapshot'
import { SinkClient, sinkClient } from '@/services/sinkClient'
import { getUserHash } from '@/services/slugManager'
import type { UserDashboardStats } from '@/types/bot'
import { CustomId } from '@/types/bot'
import type { SinkLink } from '@/types/sink'
import { createEditLinkModal } from '@/utils/modals'
import { safeHttpGet } from '@/utils/safeHttp'
import { parseTagsInput } from '@/utils/tags'
import { MAX_MESSAGE_TEXT_CONTENT } from '@/utils/text'
import { parseExpiration } from '@/utils/time'
import { createIgnoredDomainsContent, sumViewTextLength, ui } from '@/utils/ui'

const TEST_SINK_TOKEN = process.env.SINK_API_TOKEN ?? 'mock-test-sink-token'

afterEach(() => {
  clearDashboardLinkSnapshots()
})

describe('expiration parsing', () => {
  const now = Date.UTC(2026, 8, 21, 0, 0, 0)

  it('distinguishes omitted and valid relative or absolute values', () => {
    expect(parseExpiration('', now)).toEqual({ kind: 'omitted' })
    expect(parseExpiration('1h', now)).toEqual({
      kind: 'valid',
      value: Math.floor(now / 1000) + 3600
    })
    expect(parseExpiration('2026-09-22', now)).toEqual({
      kind: 'valid',
      value: Math.floor(Date.UTC(2026, 8, 22, 23, 59, 59) / 1000)
    })
    expect(parseExpiration('2026-09-21T12:00:00+09:00', now).kind).toBe('valid')
    expect(parseExpiration('1000y', now).kind).toBe('valid')
  })

  it('rejects typos, past dates, invalid calendar dates, and overflow', () => {
    expect(parseExpiration('1hour', now).kind).toBe('invalid')
    expect(parseExpiration('2026-09-20', now).kind).toBe('invalid')
    expect(parseExpiration('2026-02-30', now).kind).toBe('invalid')
    expect(parseExpiration('999999999999999999999999y', now).kind).toBe(
      'invalid'
    )
  })
})

describe('Sink tag and edit contracts', () => {
  it('normalizes comma-separated Discord tag input', () => {
    expect(parseTagsInput('#Docs, Release, docs')).toEqual({
      valid: true,
      value: ['docs', 'release']
    })
    expect(
      parseTagsInput(Array.from({ length: 11 }, (_, i) => `t${i}`).join(','))
        .valid
    ).toBe(false)
  })

  it('serializes deletion semantics while preserving fields outside the modal', () => {
    const payload = buildEditLinkPayload(
      {
        slug: 'slug',
        url: 'https://old.example',
        title: 'old title',
        description: 'old description',
        tags: ['old'],
        expiration: 2_000_000_000,
        unsafe: false,
        cloaking: true,
        redirectWithQuery: false,
        geo: { KR: 'https://kr.example' }
      },
      {
        url: 'https://new.example',
        title: '',
        description: '',
        tags: []
      }
    )

    const serialized = JSON.parse(JSON.stringify(payload))
    expect(serialized).toEqual({
      url: 'https://new.example',
      tags: [],
      title: '',
      description: '',
      expiration: 2_000_000_000,
      cloaking: true,
      redirectWithQuery: false,
      geo: { KR: 'https://kr.example' },
      unsafe: false
    })
    expect(serialized).not.toHaveProperty('password')

    const clearPassword = buildEditLinkPayload(
      { slug: 'slug', url: 'https://old.example' },
      {
        url: 'https://old.example',
        title: 'title',
        description: 'description',
        tags: ['tag'],
        password: ''
      }
    )
    expect(JSON.parse(JSON.stringify(clearPassword)).password).toBe('')
  })

  it('uses official tags and Unix-seconds response fields', async () => {
    const client = new SinkClient({
      baseUrl: 'https://sink.example',
      token: 'token',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            slug: 'official',
            url: 'https://example.com',
            tags: ['docs', 'release'],
            expiration: 2_000_000_000
          }),
          { status: 200 }
        )
    })
    const result = await client.queryLink({ slug: 'official' })
    expect(result.link?.tags).toEqual(['docs', 'release'])
    expect(result.link?.expiration).toBe(2_000_000_000)
  })
})

describe('dashboard snapshot and Discord ACK', () => {
  it('expires cloned dashboard snapshots after five minutes', () => {
    const link = {
      slug: 'cached',
      url: 'https://example.com',
      tags: ['one']
    }
    storeDashboardLinkSnapshots('user', [link], 1_000)
    const cached = getDashboardLinkSnapshot('user', 'cached', 2_000)
    expect(cached).toEqual(link)
    cached?.tags?.push('mutated')
    expect(getDashboardLinkSnapshot('user', 'cached', 2_000)?.tags).toEqual([
      'one'
    ])
    expect(
      getDashboardLinkSnapshot('user', 'cached', 1_000 + 5 * 60 * 1000)
    ).toBeUndefined()
  })

  it('opens a cached edit modal without an external lookup', async () => {
    const userId = '723319776407191633'
    const slug = `edit-${getUserHash(userId)}`
    storeDashboardLinkSnapshots(userId, [
      { slug, url: 'https://example.com', title: 'Existing', tags: ['docs'] }
    ])
    const originalGetLink = sinkClient.getLink
    const getLinkMock = mock(async () => ({ success: false }))
    sinkClient.getLink = getLinkMock
    let shownModal: unknown
    const interaction = {
      customId: `${CustomId.DASHBOARD_EDIT_BTN}:${slug}`,
      user: { id: userId },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      showModal: async (modal: unknown) => {
        shownModal = modal
      }
    }

    try {
      await onInteractionCreate(interaction as never)
      expect(shownModal).toBeDefined()
      expect(getLinkMock).not.toHaveBeenCalled()
    } finally {
      sinkClient.getLink = originalGetLink
    }
  })

  it('rejects an invalid edit-button slug before reading the snapshot', async () => {
    const userId = '723319776407191633'
    const invalidSlug = `${'x'.repeat(101)}-${getUserHash(userId)}`
    let replyPayload: unknown
    let shownModal: unknown
    const interaction = {
      customId: `${CustomId.DASHBOARD_EDIT_BTN}:${invalidSlug}`,
      user: { id: userId },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      reply: async (payload: unknown) => {
        replyPayload = payload
      },
      showModal: async (modal: unknown) => {
        shownModal = modal
      }
    }

    await onInteractionCreate(interaction as never)
    expect(replyPayload).toBeDefined()
    expect(shownModal).toBeUndefined()
  })

  it('rejects an invalid edit-modal slug before calling Sink', async () => {
    const userId = '723319776407191633'
    const invalidSlug = `${'x'.repeat(101)}-${getUserHash(userId)}`
    const originalGetLink = sinkClient.getLink
    const getLinkMock = mock(async () => ({ success: false }))
    sinkClient.getLink = getLinkMock
    let followUpPayload: unknown
    const interaction = {
      customId: `${CustomId.MODAL_EDIT_LINK}:${invalidSlug}`,
      user: { id: userId },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      deferUpdate: async () => {},
      followUp: async (payload: unknown) => {
        followUpPayload = payload
      }
    }

    try {
      await onInteractionCreate(interaction as never)
      expect(followUpPayload).toBeDefined()
      expect(getLinkMock).not.toHaveBeenCalled()
    } finally {
      sinkClient.getLink = originalGetLink
    }
  })

  it('acknowledges delete before starting the Sink mutation', async () => {
    const userId = '723319776407191633'
    const slug = `delete-${getUserHash(userId)}`
    const events: string[] = []
    const originalDelete = sinkClient.deleteLink
    sinkClient.deleteLink = mock(async () => {
      events.push('delete')
      return { success: false, error: 'slow failure' }
    })
    const interaction = {
      customId: `${CustomId.DASHBOARD_CONFIRM_DELETE_BTN}:${slug}`,
      user: { id: userId },
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      deferUpdate: async () => {
        events.push('defer')
      },
      editReply: async () => {
        events.push('edit')
      }
    }

    try {
      await onInteractionCreate(interaction as never)
      expect(events).toEqual(['defer', 'delete', 'edit'])
    } finally {
      sinkClient.deleteLink = originalDelete
    }
  })

  it('acknowledges dashboard refresh before external reads', async () => {
    const events: string[] = []
    const originalCount = sinkClient.countLinks
    const originalList = sinkClient.listLinks
    sinkClient.countLinks = mock(async () => {
      events.push('external')
      return { success: true, count: 0 }
    })
    sinkClient.listLinks = mock(async () => {
      events.push('external')
      return { success: true, list: [], total: 0, listComplete: true }
    })
    const interaction = {
      customId: `${CustomId.DASHBOARD_REFRESH_BTN}:1`,
      user: { id: '723319776407191633', username: 'Tester' },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      deferUpdate: async () => {
        events.push('defer')
      },
      editReply: async () => {
        events.push('edit')
      }
    }

    try {
      await onInteractionCreate(interaction as never)
      expect(events[0]).toBe('defer')
      expect(events.filter(event => event === 'external')).toHaveLength(4)
      expect(events.at(-1)).toBe('edit')
    } finally {
      sinkClient.countLinks = originalCount
      sinkClient.listLinks = originalList
    }
  })

  it('rejects invalid modal expiration without calling Sink', async () => {
    const originalCreate = sinkClient.createLink
    const createMock = mock(async () => ({ success: true }))
    sinkClient.createLink = createMock
    const values: Record<string, string> = {
      url: 'https://example.com',
      expiration: '1hour',
      password: '',
      tag: '',
      title: ''
    }
    let followUpPayload: unknown
    const interaction = {
      customId: CustomId.MODAL_CREATE_LINK,
      user: { id: '723319776407191633' },
      fields: { getTextInputValue: (key: string) => values[key] || '' },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      deferUpdate: async () => {},
      followUp: async (payload: unknown) => {
        followUpPayload = payload
      }
    }

    try {
      await onInteractionCreate(interaction as never)
      expect(followUpPayload).toBeDefined()
      expect(createMock).not.toHaveBeenCalled()
    } finally {
      sinkClient.createLink = originalCreate
    }
  })
})

describe('configuration display budget', () => {
  it('renders near-limit domain settings within the component budget', () => {
    const domains = Array.from(
      { length: 50 },
      (_, index) => `${'segment'.repeat(10)}-${index}.example.com`
    )
    const content = createIgnoredDomainsContent(domains)
    expect(content.length).toBeLessThanOrEqual(3_500)
    expect(content).toContain('전체 50개')
    expect(content).toContain('생략됨')

    const view = ui.createConfigPanelView(
      { id: 'user', username: 'Tester' } as never,
      {
        autoDmMode: 'inherit',
        dmFormat: 'replace',
        fixupxEnabled: true,
        autoShortenMinUrlLength: null,
        ignoredDomains: domains
      }
    )
    expect(() => view.components[0]?.toJSON()).not.toThrow()
  })

  it('keeps the summed text of a fully-populated panel inside the 4000 cap', () => {
    // 50 max-length domains (253 chars each) plus a notice far past any
    // single-block limit. discord.js does not validate the combined length, so
    // asserting only `toJSON()` cannot catch the HTTP 400 the server returns.
    const domains = Array.from({ length: 50 }, (_, index) =>
      `${`sub${index}`.padEnd(250, 'a')}.example.com`.slice(0, 253)
    )
    const view = ui.createConfigPanelView(
      { id: 'user', username: 'Tester' } as never,
      {
        autoDmMode: 'inherit',
        dmFormat: 'replace',
        fixupxEnabled: true,
        autoShortenMinUrlLength: null,
        ignoredDomains: domains
      },
      {
        title: '설정 변경 완료',
        description: 'N'.repeat(20_000),
        type: 'info'
      },
      70
    )

    const total = sumViewTextLength(view)
    expect(total).toBeLessThanOrEqual(MAX_MESSAGE_TEXT_CONTENT)
    expect(total).toBeGreaterThan(1_000)
    expect(() => view.components[0]?.toJSON()).not.toThrow()
  })
})

describe('dashboard rendering with hostile link metadata', () => {
  it('renders an over-long title and description without throwing', () => {
    const stats = {
      totalLinks: 1,
      activeLinks: 1,
      expiredLinks: 0,
      totalClicks: 0,
      displayedLinks: 1,
      linksComplete: true,
      links: [
        {
          slug: 'long-title',
          url: `https://example.com/${'p'.repeat(500)}`,
          title: 'T'.repeat(50_000),
          description: 'D'.repeat(50_000),
          tags: ['x'],
          clicks: 0,
          createdAt: new Date().toISOString()
        }
      ]
    } as UserDashboardStats

    const view = ui.createDashboardView(
      { id: '123456789012345678', username: 'Tester' } as never,
      stats,
      'long-title'
    )

    expect(view.components.length).toBe(2)
    const json = view.components[1]?.toJSON()
    expect(() => JSON.stringify(json)).not.toThrow()
    // The edit/delete row that lives in the same container must survive.
    const customIds = JSON.stringify(json)
    expect(customIds).toContain(`${CustomId.DASHBOARD_EDIT_BTN}:long-title`)
    expect(customIds).toContain(`${CustomId.DASHBOARD_DELETE_BTN}:long-title`)
  })

  it('caps a title that Sink returns at length and renders a usable dashboard', async () => {
    const hostileTitle = 'T'.repeat(50_000)
    const client = new SinkClient({
      baseUrl: 'https://sink.example',
      token: TEST_SINK_TOKEN,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            slug: 'hostile',
            url: 'https://example.com',
            title: hostileTitle
          }),
          { status: 200 }
        )
    })

    const result = await client.queryLink({ slug: 'hostile' })
    expect(result.link?.title).toBe(hostileTitle)

    const editModal = createEditLinkModal(result.link as SinkLink)
    expect(editModal).toBeDefined()

    const view = ui.createDashboardView(
      { id: '123456789012345678', username: 'Tester' } as never,
      {
        totalLinks: 1,
        activeLinks: 1,
        expiredLinks: 0,
        totalClicks: 0,
        displayedLinks: 1,
        linksComplete: true,
        links: [result.link as SinkLink]
      },
      'hostile'
    )
    expect(view.components.length).toBe(2)
    expect(() => view.components[1]?.toJSON()).not.toThrow()
  })

  it('neutralizes mentions in the title rendered on dashboard', () => {
    const view = ui.createDashboardView(
      { id: '123456789012345678', username: 'Tester' } as never,
      {
        totalLinks: 1,
        activeLinks: 1,
        expiredLinks: 0,
        totalClicks: 0,
        displayedLinks: 1,
        linksComplete: true,
        links: [
          {
            slug: 'test-slug',
            url: 'https://example.com',
            title: '@everyone title with <@&123456> and <@98765>'
          } as SinkLink
        ]
      },
      'test-slug'
    )
    const rendered = JSON.stringify(view.components[0]?.toJSON())
    expect(rendered).not.toContain('@everyone')
    expect(rendered).not.toContain('<@&123456>')
    expect(rendered).not.toContain('<@98765>')
  })
})

describe('third-party error text reaching Discord', () => {
  const HOSTILE_BODY = `@everyone https://discord.gg/phish <@&123456789> grab it`

  it('does not surface a hostile non-2xx body or its mentions', async () => {
    const client = new SinkClient({
      baseUrl: 'https://sink.example',
      token: TEST_SINK_TOKEN,
      fetchImpl: async () =>
        new Response(HOSTILE_BODY, {
          status: 502,
          statusText: HOSTILE_BODY
        })
    })

    const result = await client.queryLink({ slug: 'anything' })
    expect(result.success).toBe(false)
    expect(result.error).not.toContain('discord.gg')
    expect(result.error).not.toContain('@everyone')
    expect(result.error).not.toContain('<@&123456789>')

    const view = ui.createErrorMessage('링크 조회 실패', result.error ?? '')
    const rendered = JSON.stringify(view.components[0]?.toJSON())
    expect(rendered).not.toContain('@everyone')
    expect(rendered).not.toContain('discord.gg')
    // A fixed, human-readable message still reaches the user.
    expect(rendered).toContain('Sink')
  })

  it('does not surface a hostile JSON error field', async () => {
    const client = new SinkClient({
      baseUrl: 'https://sink.example',
      token: TEST_SINK_TOKEN,
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: HOSTILE_BODY }), {
          status: 400
        })
    })

    const result = await client.queryLink({ slug: 'anything' })
    expect(result.error).not.toContain('@everyone')
    expect(result.error).not.toContain('discord.gg')
  })

  it('defuses a mention that reaches createErrorMessage by another route', () => {
    const view = ui.createErrorMessage('실패', `잔여 시도 <@&42> @here`)
    const rendered = JSON.stringify(view.components[0]?.toJSON())
    expect(rendered).not.toContain('@here')
    expect(rendered).not.toContain('<@&42>')
  })

  it('caps and defuses a network exception message', async () => {
    const client = new SinkClient({
      baseUrl: 'https://sink.example',
      token: TEST_SINK_TOKEN,
      fetchImpl: async () => {
        throw new Error(`@everyone ${'x'.repeat(5_000)}`)
      }
    })

    const result = await client.queryLink({ slug: 'anything' })
    expect(result.error?.length).toBeLessThanOrEqual(300)
    const rendered = JSON.stringify(
      ui.createErrorMessage('실패', result.error ?? '').components[0]?.toJSON()
    )
    expect(rendered).not.toContain('@everyone')
  })

  it('bounds an over-long HTTP reason phrase from safeHttp', async () => {
    const hostile = `Bad Gateway @everyone ${'y'.repeat(2_000)}`
    const response = await safeHttpGet('https://example.com', {
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      transport: async () => ({
        status: 502,
        statusText: hostile,
        headers: {}
      })
    })

    expect(response.statusText.length).toBeLessThanOrEqual(100)
    expect(response.statusText).not.toContain('@everyone')
  })
})
