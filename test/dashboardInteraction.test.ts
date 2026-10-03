import { describe, expect, it, mock } from 'bun:test'
import { linkCommand } from '@/commands/link'
import { config } from '@/config'
import { onInteractionCreate } from '@/events/interactionCreate'
import {
  clearDashboardLinkSnapshots,
  storeDashboardLinkSnapshots
} from '@/services/dashboardLinkSnapshot'
import { sinkClient } from '@/services/sinkClient'
import {
  buildCustomSlug,
  getUserHash,
  verifyOwnership
} from '@/services/slugManager'
import { CustomId } from '@/types/bot'
import type { SinkLink } from '@/types/sink'
import { logger } from '@/utils/logger'

const ADMIN_ID = '723319776407191633'
const ADMIN_HASH = getUserHash(ADMIN_ID)

/** Renders a name the way the card does, wrapped in Discord inline code. */
function backticked(name: string): string {
  return `\`${name}\``
}

/** Flattens a V2 payload to text so assertions can look for rendered strings. */
function payloadText(payload: unknown): string {
  return JSON.stringify(payload)
}

function baseInteraction(overrides: Record<string, unknown>) {
  return {
    user: { id: ADMIN_ID, tag: 'admin#0001', username: 'admin' },
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    ...overrides
  }
}

/**
 * Minimal `ChatInputCommandInteraction` for `/link custom`. Only the option
 * accessors the handler actually touches are implemented.
 */
function customSlugInteraction(customSlug: string) {
  const options: Record<string, string | boolean> = {
    url: 'https://example.com',
    custom_slug: customSlug,
    expiration: '',
    password: '',
    tag: '',
    title: '',
    description: '',
    unsafe: false
  }

  let replied: unknown
  return {
    get replied() {
      return replied
    },
    interaction: {
      ...baseInteraction({ isChatInputCommand: () => true }),
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => 'custom',
        getString: (name: string) => options[name] as string,
        getBoolean: (name: string) => options[name] as boolean
      },
      deferReply: async () => {},
      editReply: async (payload: unknown) => {
        replied = payload
      }
    } as never
  }
}

/**
 * Runs `/link custom` and returns both the rendered reply and everything the
 * handler logged. The log line is asserted alongside the card because both are
 * required to name the same slug: if normalisation were done twice, they are
 * exactly the two places a drift would show up.
 */
async function runCustomSlug(
  customSlug: string
): Promise<{ text: string; logged: string }> {
  const originalCreate = sinkClient.createLink
  const originalInfo = logger.info
  const originalAdminIds = config.ADMIN_USER_IDS
  config.ADMIN_USER_IDS = [ADMIN_ID]
  const createMock = mock(async (payload: { slug: string }) => ({
    success: true,
    link: { slug: payload.slug, url: 'https://example.com' } as SinkLink
  }))
  sinkClient.createLink = createMock as never

  const logged: string[] = []
  logger.info = ((...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  }) as typeof logger.info

  const harness = customSlugInteraction(customSlug)
  try {
    await linkCommand.execute(harness.interaction)
    return { text: payloadText(harness.replied), logged: logged.join('\n') }
  } finally {
    sinkClient.createLink = originalCreate
    logger.info = originalInfo
    config.ADMIN_USER_IDS = originalAdminIds
  }
}

describe('/link custom reports the ownership-suffix rename', () => {
  it('names both the requested and the stored slug when the name was suffixed', async () => {
    const requested = 'summer-sale'
    const stored = buildCustomSlug(requested, ADMIN_ID)

    // Premise: the request really was renamed, so this is not a no-op case.
    expect(stored).not.toBe(requested)
    expect(stored.startsWith(`${requested}-`)).toBe(true)

    const { text } = await runCustomSlug(requested)

    // Both names must be visible, or the admin manages the wrong link. The
    // bare name is only rendered as a prefix of the stored one, so require a
    // delimited mention of each on its own.
    expect(text).toContain(backticked(requested))
    expect(text).toContain(backticked(stored))
    // The notice must still give the admin the form that actually works.
    expect(text).toContain(backticked(`/link delete ${stored}`))
  })

  it('does not claim the requested slug is an existing link', async () => {
    const requested = 'summer-sale'
    const stored = buildCustomSlug(requested, ADMIN_ID)
    expect(stored).not.toBe(requested)

    const { text } = await runCustomSlug(requested)

    // Nothing in this code path looks `summer-sale` up, so the card has no
    // basis for saying it exists. Telling the admin it does would send them to
    // share or delete a URL that is probably not there.
    expect(text).not.toContain('이미 존재')
    expect(text).not.toContain('별도로')
    expect(text).not.toContain('다른 링크')
    // What it must positively state is the stored name that manages the link.
    expect(text).toContain(backticked(stored))
    expect(text).toContain(backticked(`/link delete ${stored}`))
  })

  it('normalises a mixed-case, padded request to one consistent slug', async () => {
    // Same request in a different spelling must produce the same stored slug
    // and the same notice, not a name that drifted from what was created.
    const messy = '  Summer-SALE  '
    const stored = buildCustomSlug(messy, ADMIN_ID)
    expect(stored).toBe(`summer-sale-${ADMIN_HASH}`)

    const { text, logged } = await runCustomSlug(messy)

    // The notice and the log both read the single normalised value, so they
    // cannot disagree about which name was requested.
    expect(text).toContain(backticked('summer-sale'))
    expect(text).toContain(backticked(stored))
    expect(text).toContain(`/link delete ${stored}`)
    expect(logged).toContain('summer-sale')
    expect(logged).toContain(stored)
    // The raw, untrimmed/unlowered spelling must never reach the user or log.
    expect(text).not.toContain('Summer-SALE')
    expect(logged).not.toContain('Summer-SALE')
  })

  it('stays silent when the request already ends in the caller own hash', async () => {
    const alreadySuffixed = `summer-sale-${ADMIN_HASH}`
    expect(buildCustomSlug(alreadySuffixed, ADMIN_ID)).toBe(alreadySuffixed)

    // The padded/mixed-case spelling of an already-owned name is the same
    // idempotent case: normalisation must not make it look like a rename.
    for (const input of [
      alreadySuffixed,
      `  ${alreadySuffixed.toUpperCase()} `
    ]) {
      const { text, logged } = await runCustomSlug(input)
      expect(text).not.toContain('변경되어 저장되었습니다')
      expect(logged).not.toContain('ownership-suffix rule')
    }
  })
})

describe('dashboard select menu rejects a malformed slug value', () => {
  const MALFORMED_VALUES = [
    'slug:../../etc:1',
    'slug:foo bar:1',
    'slug:foo:1:2',
    'slug::1',
    'slug:foo/bar:1',
    '../../etc',
    'foo bar',
    'foo/bar',
    // A well-formed slug is not enough: the page is parsed with the same
    // zod schema, so a non-numeric, zero, negative, fractional, or absurd
    // page must be refused rather than coerced by `parseInt(...) || 1`.
    'slug:my-link:abc',
    'slug:my-link:',
    'slug:my-link:0',
    'slug:my-link:-3',
    'slug:my-link:1.5',
    'slug:my-link:1e9',
    'slug:my-link:999999999'
  ]

  it.each(MALFORMED_VALUES)(
    'replies and never reaches the snapshot path for %p',
    async value => {
      clearDashboardLinkSnapshots()
      const originalCount = sinkClient.countLinks
      const originalList = sinkClient.listLinks
      const countMock = mock(async () => ({
        success: true,
        count: 0,
        status: 200
      }))
      const listMock = mock(async () => ({
        success: true,
        list: [],
        total: 0,
        listComplete: true
      }))
      sinkClient.countLinks = countMock as never
      sinkClient.listLinks = listMock as never

      let replyText = ''
      let deferred = false
      const interaction = baseInteraction({
        customId: CustomId.DASHBOARD_SELECT_LINK,
        isStringSelectMenu: () => true,
        values: [value],
        deferUpdate: async () => {
          deferred = true
        },
        editReply: async (payload: unknown) => {
          replyText = payloadText(payload)
        }
      })

      try {
        await onInteractionCreate(interaction as never)

        // The user must get a clear answer rather than a silently
        // unselected dashboard.
        expect(deferred).toBe(true)
        expect(replyText).toContain('잘못된 링크 식별자')
        // The unvalidated value must not reach the dashboard/snapshot path.
        expect(countMock).not.toHaveBeenCalled()
        expect(listMock).not.toHaveBeenCalled()
      } finally {
        sinkClient.countLinks = originalCount
        sinkClient.listLinks = originalList
        clearDashboardLinkSnapshots()
      }
    }
  )
})

describe('dashboard select menu still accepts a well-formed slug and page', () => {
  // The page schema must not over-reject. A `promo.v2-<hash>` slug is exactly
  // the out-of-charset-but-owned case the deny-list exists to allow, and it
  // has to keep rendering on the page the user actually chose.
  it.each(['slug:promo.v2-abc123:3', 'slug:my-link:1', 'slug:日本語-hash:2'])(
    'reaches the dashboard path for %p',
    async value => {
      clearDashboardLinkSnapshots()
      const originalCount = sinkClient.countLinks
      const originalList = sinkClient.listLinks
      const countMock = mock(async () => ({
        success: true,
        count: 1,
        status: 200
      }))
      const listMock = mock(async () => ({
        success: true,
        list: [{ slug: 'my-link', url: 'https://example.com' } as SinkLink],
        total: 1,
        listComplete: true
      }))
      sinkClient.countLinks = countMock as never
      sinkClient.listLinks = listMock as never

      let replyText = ''
      const interaction = baseInteraction({
        customId: CustomId.DASHBOARD_SELECT_LINK,
        isStringSelectMenu: () => true,
        values: [value],
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          replyText = payloadText(payload)
        }
      })

      try {
        await onInteractionCreate(interaction as never)

        // No rejection, and the value actually reached the lookup path.
        expect(replyText).not.toContain('잘못된 링크 식별자')
        expect(countMock).toHaveBeenCalled()
        expect(listMock).toHaveBeenCalled()
      } finally {
        sinkClient.countLinks = originalCount
        sinkClient.listLinks = originalList
        clearDashboardLinkSnapshots()
      }
    }
  )
})

describe('owned slugs outside the bot charset stay manageable', () => {
  // A link created outside the bot can carry `.`, `~`, or non-ASCII in its
  // body. `verifyOwnership` only inspects the slug TAIL, so such a link is
  // owned and is listed by `/link list` and the dashboard. A strict
  // `[A-Za-z0-9_-]` parse then made edit/delete answer
  // "잘못된 링크 식별자입니다" — the link exists but the owner cannot manage it, which is the
  // exact state the ownership suffix exists to prevent.
  const OUTSIDE_CHARSET = ['promo.v2', 'a.b-c', 'promo~x', '日本語', 'promo+v2']

  it.each(OUTSIDE_CHARSET)(
    'opens the confirm dialog for owned slug %p',
    async body => {
      const slug = `${body}-${ADMIN_HASH}`
      // Premise: ownership accepts it, so it really does show up as owned.
      expect(verifyOwnership(slug, ADMIN_ID)).toBe(true)

      let updated = false
      const interaction = baseInteraction({
        customId: `${CustomId.DASHBOARD_DELETE_BTN}:${slug}`,
        isButton: () => true,
        reply: async () => {},
        update: async () => {
          updated = true
        }
      })

      await onInteractionCreate(interaction as never)
      expect(updated).toBe(true)
    }
  )

  it.each(OUTSIDE_CHARSET)(
    'opens the edit modal for owned slug %p',
    async body => {
      const slug = `${body}-${ADMIN_HASH}`
      expect(verifyOwnership(slug, ADMIN_ID)).toBe(true)
      clearDashboardLinkSnapshots()
      storeDashboardLinkSnapshots(
        ADMIN_ID,
        [{ slug, url: 'https://example.com' } as SinkLink],
        Date.now()
      )

      let shownModal: unknown
      let replied = false
      const interaction = baseInteraction({
        customId: `${CustomId.DASHBOARD_EDIT_BTN}:${slug}`,
        isButton: () => true,
        reply: async () => {
          replied = true
        },
        showModal: async (modal: unknown) => {
          shownModal = modal
        }
      })

      try {
        await onInteractionCreate(interaction as never)
        expect(shownModal).toBeDefined()
        expect(replied).toBe(false)
      } finally {
        clearDashboardLinkSnapshots()
      }
    }
  )

  // The original vulnerability must stay closed: a forged customId must never
  // reach sinkClient.deleteLink, even though it passes ownership.
  const FORGED = [
    '../../etc',
    'foo/bar',
    'foo bar',
    'foo\nbar',
    'foo:bar',
    'foo?x=1',
    'foo#frag',
    'foo\\bar'
  ]

  it.each(FORGED)(
    'still refuses to call Sink for forged slug %p',
    async body => {
      const slug = `${body}-${ADMIN_HASH}`
      expect(verifyOwnership(slug, ADMIN_ID)).toBe(true)

      const originalDelete = sinkClient.deleteLink
      const deleteMock = mock(async () => ({ success: true }))
      sinkClient.deleteLink = deleteMock as never

      let replied = false
      const interaction = baseInteraction({
        customId: `${CustomId.DASHBOARD_CONFIRM_DELETE_BTN}:${slug}`,
        isButton: () => true,
        reply: async () => {
          replied = true
        }
      })

      try {
        await onInteractionCreate(interaction as never)
        expect(deleteMock).not.toHaveBeenCalled()
        expect(replied).toBe(true)
      } finally {
        sinkClient.deleteLink = originalDelete
      }
    }
  )

  it('still refuses a bare traversal id with no ownership tail', async () => {
    const originalDelete = sinkClient.deleteLink
    const deleteMock = mock(async () => ({ success: true }))
    sinkClient.deleteLink = deleteMock as never

    let replied = false
    const interaction = baseInteraction({
      customId: `${CustomId.DASHBOARD_CONFIRM_DELETE_BTN}:../../etc`,
      isButton: () => true,
      reply: async () => {
        replied = true
      }
    })

    try {
      await onInteractionCreate(interaction as never)
      expect(deleteMock).not.toHaveBeenCalled()
      expect(replied).toBe(true)
    } finally {
      sinkClient.deleteLink = originalDelete
    }
  })
})
