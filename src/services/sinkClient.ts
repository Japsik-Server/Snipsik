import { config } from '@/config'
import type {
  CreateLinkPayload,
  UpdateLinkPayload,
  SinkLink,
  SinkStats,
  SinkMetricType,
  SinkQueryParams,
  SinkSearchParams,
  SinkSearchResult,
  SinkCountParams,
  SinkListParams,
  UrlCheckResult
} from '@/types/sink'
import { logger } from '@/utils/logger'
import { safeHttpGet } from '@/utils/safeHttp'
import { expirationToUnixSeconds } from '@/utils/time'
import { z } from 'zod'

/**
 * Validates a slug before it is used as an analytics filter.
 *
 * Analytics slugs reach `/api/stats/*` as a query parameter, so a blank or
 * malformed value would silently widen the query to every link on the instance.
 * Fails loudly instead.
 */
function validateAnalyticsSlug(
  slug: string
): { success: true; slug: string } | { success: false; error: string } {
  const trimmed = (slug.startsWith('/') ? slug.substring(1) : slug).trim()
  const parsed = z.string().trim().min(1).max(2048).safeParse(trimmed)
  if (!parsed.success) {
    logger.warn(
      `Sink analytics slug validation failed: a non-empty slug is required`
    )
    return {
      success: false,
      error: 'Invalid slug for Sink analytics: a non-empty slug is required'
    }
  }
  return { success: true, slug: parsed.data }
}

/** Max in-flight `/api/stats/counters` requests. */
const SINK_STATS_CONCURRENCY = 3

/** Upper bound accepted for a `/api/stats/metrics` row limit. */
const SINK_METRICS_MAX_LIMIT = 500

/** Upper bound on how many link ids one `getCountersByIds` call may carry. */
const SINK_STATS_MAX_IDS = 5_000

/**
 * Ceiling on the encoded length of the `id` query parameter for one
 * `/api/stats/counters` request. Sink caps a link id at 26 characters, so a
 * plain count-based batch can push the URL past what proxies accept; this is a
 * byte budget instead of a fixed item count.
 */
const SINK_STATS_ID_PARAM_MAX_BYTES = 4_000

/**
 * Splits link ids into batches whose encoded `id` parameter stays within budget.
 * A single id that alone exceeds the budget still gets its own batch, so an
 * unexpectedly long id can never stall the whole lookup.
 */
function chunkIdsForStatsRequest(ids: readonly string[]): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let currentBytes = 0

  for (const id of ids) {
    // `encodeURIComponent` already gives the escaped length, so budget against
    // that plus the "," separator between ids.
    const cost = encodeURIComponent(id).length + 1
    if (
      current.length > 0 &&
      currentBytes + cost > SINK_STATS_ID_PARAM_MAX_BYTES
    ) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(id)
    currentBytes += cost
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Reads `{ data: [{ id, visits, ... }] }` analytics rows into a flat list.
 * A missing or empty `data` array is a valid "no analytics" answer.
 */
function parseCounterRows(value: unknown): { id: string; visits: number }[] {
  if (!isRecord(value)) return []
  const rows = value.data
  if (!Array.isArray(rows)) return []

  const parsed: { id: string; visits: number }[] = []
  for (const row of rows) {
    if (!isRecord(row)) continue
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!id) continue
    parsed.push({ id, visits: Number(row.visits) || 0 })
  }
  return parsed
}

function normalizeSinkLink(raw: unknown): SinkLink {
  if (!raw || typeof raw !== 'object') {
    return {
      slug: '',
      url: ''
    }
  }

  // Unwrap potential nested envelopes: { link: {...} } or { data: {...} } or { item: {...} }
  let obj = raw as Record<string, unknown>
  if (obj.link && typeof obj.link === 'object' && !Array.isArray(obj.link)) {
    obj = { ...obj, ...(obj.link as Record<string, unknown>) }
  }
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    obj = { ...obj, ...(obj.data as Record<string, unknown>) }
  }
  if (obj.item && typeof obj.item === 'object' && !Array.isArray(obj.item)) {
    obj = { ...obj, ...(obj.item as Record<string, unknown>) }
  }

  const meta = (
    obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {}
  ) as Record<string, unknown>

  // Safely extract string properties without risking "[object Object]"
  const extractString = (...keys: unknown[]): string => {
    for (const key of keys) {
      if (
        typeof key === 'string' &&
        key.trim().length > 0 &&
        key !== '[object Object]'
      ) {
        return key.trim()
      }
    }
    return ''
  }
  const extractOptionalString = (...keys: unknown[]): string | undefined => {
    const value = extractString(...keys)
    return value || undefined
  }
  const extractBoolean = (...values: unknown[]): boolean | undefined => {
    for (const value of values) {
      if (typeof value === 'boolean') return value
    }
    return undefined
  }

  const rawSlugCandidate = extractString(
    obj.slug,
    obj.key,
    obj.alias,
    obj.name,
    obj.id,
    meta.slug,
    meta.key,
    meta.alias,
    meta.id
  )

  const slug = rawSlugCandidate.startsWith('/')
    ? rawSlugCandidate.substring(1)
    : rawSlugCandidate

  const url = extractString(
    obj.url,
    typeof obj.link === 'string' ? obj.link : undefined,
    obj.target,
    obj.destination,
    obj.originUrl,
    obj.originalUrl,
    meta.url,
    typeof meta.link === 'string' ? meta.link : undefined,
    meta.target,
    meta.destination
  )

  const title =
    typeof obj.title === 'string' && obj.title.trim().length > 0
      ? obj.title.trim()
      : typeof meta.title === 'string' && meta.title.trim().length > 0
        ? meta.title.trim()
        : typeof obj.name === 'string' && obj.name.trim().length > 0
          ? obj.name.trim()
          : null

  const description =
    typeof obj.description === 'string' && obj.description.trim().length > 0
      ? obj.description.trim()
      : typeof meta.description === 'string' &&
          meta.description.trim().length > 0
        ? meta.description.trim()
        : typeof obj.desc === 'string' && obj.desc.trim().length > 0
          ? obj.desc.trim()
          : null

  const rawTags =
    obj.tags ??
    meta.tags ??
    obj.tag ??
    meta.tag ??
    obj.category ??
    meta.category ??
    obj.label ??
    meta.label
  const tags = Array.isArray(rawTags)
    ? rawTags
        .filter((tag): tag is string => typeof tag === 'string')
        .map(tag => tag.trim())
        .filter(Boolean)
    : typeof rawTags === 'string' && rawTags.trim()
      ? [rawTags.trim()]
      : []

  const rawPassword =
    typeof obj.password === 'string'
      ? obj.password
      : typeof meta.password === 'string'
        ? meta.password
        : null

  // Sink never returns a click count on the link record itself — clicks live only in
  // the analytics dataset (see `getCountersByIds` / `getStats`). Leaving this undefined
  // keeps "no analytics" distinguishable from a genuine zero.
  const clicks = undefined

  const expiration = expirationToUnixSeconds(
    (obj.expiration ??
      meta.expiration ??
      obj.expires_at ??
      meta.expires_at ??
      obj.expire) as string | number | null | undefined
  )

  const createdAt =
    typeof obj.createdAt === 'string' || typeof obj.createdAt === 'number'
      ? obj.createdAt
      : typeof meta.createdAt === 'string' || typeof meta.createdAt === 'number'
        ? meta.createdAt
        : typeof obj.created_at === 'string' ||
            typeof obj.created_at === 'number'
          ? obj.created_at
          : typeof meta.created_at === 'string' ||
              typeof meta.created_at === 'number'
            ? meta.created_at
            : typeof obj.date === 'string' || typeof obj.date === 'number'
              ? obj.date
              : undefined

  const updatedAt =
    typeof obj.updatedAt === 'string' || typeof obj.updatedAt === 'number'
      ? obj.updatedAt
      : typeof meta.updatedAt === 'string' || typeof meta.updatedAt === 'number'
        ? meta.updatedAt
        : typeof obj.updated_at === 'string' ||
            typeof obj.updated_at === 'number'
          ? obj.updated_at
          : typeof meta.updated_at === 'string' ||
              typeof meta.updated_at === 'number'
            ? meta.updated_at
            : undefined

  const unsafe = extractBoolean(
    obj.unsafe,
    meta.unsafe,
    obj.is_unsafe,
    meta.is_unsafe
  )

  const rawGeo = obj.geo ?? meta.geo
  const geo =
    rawGeo && typeof rawGeo === 'object' && !Array.isArray(rawGeo)
      ? Object.fromEntries(
          Object.entries(rawGeo).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === 'string' && entry[1].trim().length > 0
          )
        )
      : undefined

  return {
    id: extractOptionalString(obj.id, meta.id),
    slug,
    url,
    comment: extractOptionalString(obj.comment, meta.comment),
    title,
    description,
    image: extractOptionalString(obj.image, meta.image),
    apple: extractOptionalString(obj.apple, meta.apple),
    google: extractOptionalString(obj.google, meta.google),
    cloaking: extractBoolean(obj.cloaking, meta.cloaking),
    redirectWithQuery: extractBoolean(
      obj.redirectWithQuery,
      meta.redirectWithQuery
    ),
    geo,
    tags,
    password: rawPassword,
    clicks,
    expiration,
    createdAt,
    updatedAt,
    unsafe
  }
}

const requiredLinkSchema = z.object({
  slug: z.string().trim().min(1),
  url: z.string().trim().url()
})

const statsSchema = z
  .object({
    slug: z.string().trim().min(1),
    url: z.string().trim().url(),
    clicks: z.number().finite().nonnegative().optional(),
    createdAt: z.union([z.string(), z.number()]).optional(),
    lastClickedAt: z.union([z.string(), z.number(), z.null()]).optional(),
    countries: z.record(z.number()).optional(),
    referrers: z.record(z.number()).optional(),
    devices: z.record(z.number()).optional()
  })
  .passthrough()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unwrapObject(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  for (const key of keys) {
    if (isRecord(value[key])) return value[key] as Record<string, unknown>
  }
  return value
}

function parseRequiredLink(
  value: unknown,
  endpoint: string,
  envelopeKeys: readonly string[] = ['link', 'data', 'item']
): { success: true; link: SinkLink } | { success: false; error: string } {
  const candidate = unwrapObject(value, envelopeKeys)
  const link = normalizeSinkLink(candidate)
  const parsed = requiredLinkSchema.safeParse(link)
  if (!parsed.success) {
    logger.warn(
      `Sink contract validation failed for ${endpoint}: a non-empty slug and valid url are required`
    )
    return {
      success: false,
      error: `Invalid Sink response contract for ${endpoint}: a non-empty slug and valid url are required`
    }
  }
  return { success: true, link }
}

function readListMetadata(source: Record<string, unknown>): {
  valid: boolean
  total?: number
  cursor?: string | null
  listComplete?: boolean
} {
  if (
    source.total !== undefined &&
    (typeof source.total !== 'number' ||
      !Number.isFinite(source.total) ||
      source.total < 0)
  ) {
    return { valid: false }
  }
  const total =
    typeof source.total === 'number' &&
    Number.isFinite(source.total) &&
    source.total >= 0
      ? source.total
      : undefined
  const rawCursor = source.cursor ?? source.nextCursor
  if (
    rawCursor !== undefined &&
    rawCursor !== null &&
    typeof rawCursor !== 'string'
  ) {
    return { valid: false }
  }
  const cursor =
    typeof rawCursor === 'string'
      ? rawCursor
      : rawCursor === null
        ? null
        : undefined
  const rawListComplete = source.list_complete ?? source.listComplete
  if (rawListComplete !== undefined && typeof rawListComplete !== 'boolean') {
    return { valid: false }
  }
  const listComplete =
    typeof rawListComplete === 'boolean' ? rawListComplete : undefined
  return { valid: true, total, cursor, listComplete }
}

function parseSinkListPayload(data: unknown): {
  valid: boolean
  rawList: unknown[]
  total?: number
  cursor?: string | null
  listComplete?: boolean
} {
  if (Array.isArray(data)) {
    return { valid: true, rawList: data }
  }
  if (!isRecord(data)) {
    return { valid: false, rawList: [] }
  }

  const LIST_KEYS = [
    'list',
    'links',
    'data',
    'items',
    'result',
    'keys'
  ] as const

  const pickArray = (src: Record<string, unknown>): unknown[] | null => {
    for (const key of LIST_KEYS) {
      if (Array.isArray(src[key])) {
        return src[key] as unknown[]
      }
    }
    return null
  }

  const outerMetadata = readListMetadata(data)
  if (!outerMetadata.valid) return { valid: false, rawList: [] }
  const top = pickArray(data)
  if (top) {
    return {
      valid: true,
      rawList: top,
      total: outerMetadata.total,
      cursor: outerMetadata.cursor,
      listComplete: outerMetadata.listComplete
    }
  }

  if (isRecord(data.data)) {
    const nested = data.data
    const inner = pickArray(nested)
    if (inner) {
      const innerMetadata = readListMetadata(nested)
      if (!innerMetadata.valid) return { valid: false, rawList: [] }
      return {
        valid: true,
        rawList: inner,
        total: outerMetadata.total ?? innerMetadata.total,
        cursor: outerMetadata.cursor ?? innerMetadata.cursor,
        listComplete: outerMetadata.listComplete ?? innerMetadata.listComplete
      }
    }
  }

  return { valid: false, rawList: [] }
}

function parseLinkList(
  value: unknown,
  endpoint: string
):
  | {
      success: true
      list: SinkLink[]
      total: number
      cursor?: string | null
      listComplete?: boolean
    }
  | { success: false; error: string } {
  const parsed = parseSinkListPayload(value)
  if (!parsed.valid) {
    logger.warn(
      `Sink contract validation failed for ${endpoint}: a link array is required`
    )
    return {
      success: false,
      error: `Invalid Sink response contract for ${endpoint}: a link array is required`
    }
  }

  const list: SinkLink[] = []
  for (const item of parsed.rawList) {
    const linkResult = parseRequiredLink(item, endpoint, [])
    if (!linkResult.success) return linkResult
    list.push(linkResult.link)
  }
  return {
    success: true,
    list,
    total: parsed.total ?? list.length,
    cursor: parsed.cursor,
    listComplete: parsed.listComplete
  }
}

function validateDeleteAcknowledgement(
  value: unknown,
  endpoint: string
): { success: true } | { success: false; error: string } {
  if (
    value === undefined ||
    (isRecord(value) &&
      (Object.keys(value).length === 0 || value.success === true))
  ) {
    return { success: true }
  }

  logger.warn(
    `Sink contract validation failed for ${endpoint}: expected an empty acknowledgment or success object`
  )
  return {
    success: false,
    error: `Invalid Sink response contract for ${endpoint}: expected an empty acknowledgment or success object`
  }
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

type SinkClientOptions = {
  baseUrl?: string
  token?: string
  requestTimeoutMs?: number
  fetchImpl?: FetchLike
}

export class SinkClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly requestTimeoutMs: number
  private readonly fetchImpl: FetchLike

  constructor(options: SinkClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? config.SINK_BASE_URL
    this.token = options.token ?? config.SINK_API_TOKEN
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? config.SINK_REQUEST_TIMEOUT_MS
    this.fetchImpl =
      options.fetchImpl ??
      ((input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input, init))
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ success: boolean; body?: T; error?: string; status: number }> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string> | undefined)
    }

    const controller = new AbortController()
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.requestTimeoutMs)
    const externalSignal = options.signal
    const abortFromExternal = () => controller.abort(externalSignal?.reason)
    if (externalSignal?.aborted) abortFromExternal()
    else
      externalSignal?.addEventListener('abort', abortFromExternal, {
        once: true
      })

    try {
      logger.debug(`Sink API Request: ${options.method || 'GET'} ${url}`)
      const response = await this.fetchImpl(url, {
        ...options,
        headers,
        signal: controller.signal
      })

      const contentType = response.headers.get('content-type') || ''
      const text = await response.text()
      const isHtml =
        contentType.includes('text/html') ||
        /^\s*<!doctype|^\s*<html/i.test(text)

      let json: unknown
      if (!isHtml) {
        try {
          json = text ? JSON.parse(text) : undefined
        } catch {
          json = { message: text }
        }
      }

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}: ${response.statusText}`
        if (isHtml) {
          errorMsg = `HTTP ${response.status}: ${response.statusText} (HTML error response)`
        } else if (typeof json === 'object' && json !== null) {
          const record = json as Record<string, unknown>
          if (
            typeof record.message === 'string' &&
            record.message.trim().length > 0
          ) {
            errorMsg = record.message
          } else if (
            typeof record.statusMessage === 'string' &&
            record.statusMessage.trim().length > 0
          ) {
            errorMsg = record.statusMessage
          } else if (
            typeof record.error === 'string' &&
            record.error.trim().length > 0
          ) {
            errorMsg = record.error
          } else if (
            typeof record.data === 'string' &&
            record.data.trim().length > 0
          ) {
            errorMsg = record.data
          } else if (response.status === 401) {
            errorMsg =
              '인증 실패 (401 Unauthorized): SINK_API_TOKEN이 올바르지 않거나 권한이 없습니다.'
          } else if (response.status === 403) {
            errorMsg = '접근 거부 (403 Forbidden): API 접근 권한이 없습니다.'
          } else if (response.status === 404) {
            errorMsg = '리소스를 찾을 수 없습니다 (404 Not Found).'
          }
        }
        logger.warn(`Sink API Error (${response.status}): ${errorMsg}`)
        return { success: false, error: errorMsg, status: response.status }
      }

      if (isHtml) {
        logger.warn(
          `Sink API returned ${response.status} with HTML content for ${url} (expected JSON)`
        )
        return {
          success: false,
          error: `Invalid Sink response contract for ${path}: unexpected HTML response`,
          status: 502
        }
      }

      return { success: true, body: json as T, status: response.status }
    } catch (err) {
      const errorMsg = timedOut
        ? `Sink request timed out after ${this.requestTimeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err)
      logger.error(`Sink API Network Exception for ${url}:`, err)
      return { success: false, error: errorMsg, status: 0 }
    } finally {
      clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', abortFromExternal)
    }
  }

  /**
   * Creates a new shortened link.
   */
  async createLink(
    payload: CreateLinkPayload
  ): Promise<{ success: boolean; link?: SinkLink; error?: string }> {
    const res = await this.request<unknown>('/api/link/create', {
      method: 'POST',
      body: JSON.stringify(payload)
    })

    if (!res.success) {
      return { success: false, error: res.error || 'Failed to create link' }
    }

    const parsed = parseRequiredLink(res.body, '/api/link/create', [
      'link',
      'data',
      'item'
    ])
    return parsed.success
      ? { success: true, link: parsed.link }
      : { success: false, error: parsed.error }
  }

  /**
   * Queries a link by slug or url using /api/link/query.
   */
  async queryLink(params: SinkQueryParams): Promise<{
    success: boolean
    link?: SinkLink
    error?: string
    status: number
  }> {
    const query = new URLSearchParams()
    if (params.slug) {
      const cleanSlug = params.slug.startsWith('/')
        ? params.slug.substring(1)
        : params.slug
      query.append('slug', cleanSlug)
    }
    if (params.url) {
      query.append('url', params.url)
    }

    const endpoint = `/api/link/query?${query.toString()}`
    const res = await this.request<unknown>(endpoint, {
      method: 'GET'
    })

    if (!res.success) {
      return {
        success: false,
        error: res.error || 'Link not found',
        status: res.status
      }
    }

    const parsed = parseRequiredLink(res.body, '/api/link/query')
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error,
        status: 502
      }
    }

    return {
      success: true,
      link: parsed.link,
      status: res.status
    }
  }

  /**
   * Searches links using /api/link/search.
   */
  async searchLinks(params: SinkSearchParams = {}): Promise<SinkSearchResult> {
    const queryParams = new URLSearchParams()
    if (params.q) queryParams.append('q', params.q)
    if (params.url) queryParams.append('url', params.url)
    if (params.tag) queryParams.append('tag', params.tag)
    if (params.status) queryParams.append('status', params.status)
    if (params.limit && params.limit > 0)
      queryParams.append('limit', params.limit.toString())

    const queryString = queryParams.toString()
    const endpoint = `/api/link/search${queryString ? `?${queryString}` : ''}`

    const res = await this.request<unknown>(endpoint, {
      method: 'GET'
    })

    if (!res.success) {
      return {
        success: false,
        list: [],
        total: 0,
        error: res.error || 'Failed to search links',
        status: res.status
      }
    }

    const parsed = parseLinkList(res.body, '/api/link/search')
    if (!parsed.success) {
      return {
        success: false,
        list: [],
        total: 0,
        error: parsed.error,
        status: 502
      }
    }

    return {
      success: true,
      list: parsed.list,
      total: parsed.total,
      cursor: parsed.cursor,
      listComplete: parsed.listComplete,
      status: res.status
    }
  }

  /**
   * Counts links matching filters using /api/link/count.
   */
  async countLinks(params: SinkCountParams = {}): Promise<{
    success: boolean
    count: number
    error?: string
    status: number
  }> {
    const queryParams = new URLSearchParams()
    if (params.q) queryParams.append('q', params.q)
    if (params.url) queryParams.append('url', params.url)
    if (params.tag) queryParams.append('tag', params.tag)
    if (params.status) queryParams.append('status', params.status)

    const queryString = queryParams.toString()
    const endpoint = `/api/link/count${queryString ? `?${queryString}` : ''}`

    const res = await this.request<unknown>(endpoint, {
      method: 'GET'
    })

    if (!res.success) {
      return {
        success: false,
        count: 0,
        error: res.error || 'Failed to count links',
        status: res.status
      }
    }

    const body = res.body
    let count: number | undefined
    if (typeof body === 'number') count = body
    else if (isRecord(body)) {
      if (typeof body.count === 'number') count = body.count
      else if (typeof body.total === 'number') count = body.total
      else if (typeof body.data === 'number') count = body.data
      else if (isRecord(body.data)) {
        if (typeof body.data.count === 'number') count = body.data.count
        else if (typeof body.data.total === 'number') count = body.data.total
      }
    }
    if (count === undefined || !Number.isFinite(count) || count < 0) {
      logger.warn(
        'Sink contract validation failed for /api/link/count: a non-negative count is required'
      )
      return {
        success: false,
        count: 0,
        error:
          'Invalid Sink response contract for /api/link/count: a non-negative count is required',
        status: 502
      }
    }

    return {
      success: true,
      count,
      status: res.status
    }
  }

  /**
   * Fetches details of a link by slug.
   */
  async getLink(slug: string): Promise<{
    success: boolean
    link?: SinkLink
    error?: string
    status?: number
  }> {
    const rawClean = slug.startsWith('/') ? slug.substring(1) : slug
    const slugValidation = z.string().trim().min(1).max(100).safeParse(rawClean)
    if (!slugValidation.success) {
      return {
        success: false,
        error: '잘못된 슬러그입니다.',
        status: 400
      }
    }
    const cleanSlug = slugValidation.data

    // 1. Primary: Query /api/link/query?slug=... (Official Sink endpoint)
    const queryRes = await this.queryLink({ slug: cleanSlug })
    if (queryRes.success && queryRes.link?.url) {
      return { success: true, link: queryRes.link, status: queryRes.status }
    }
    if (
      queryRes.status === 401 ||
      queryRes.status === 403 ||
      queryRes.status === 0
    ) {
      return queryRes
    }

    // 2. Fallback: Search /api/link/search?q=... (limit 10)
    const searchRes = await this.searchLinks({ q: cleanSlug, limit: 10 })
    if (searchRes.success && searchRes.list.length > 0) {
      const exactMatch = searchRes.list.find(
        l => l.slug.toLowerCase() === cleanSlug.toLowerCase()
      )
      if (exactMatch) {
        return { success: true, link: exactMatch, status: 200 }
      }
    }

    // 3. Fallback: Try legacy direct endpoint GET /api/link/:slug
    const directRes = await this.request<unknown>(
      `/api/link/${encodeURIComponent(cleanSlug)}`,
      {
        method: 'GET'
      }
    )

    if (directRes.success) {
      const parsed = parseRequiredLink(directRes.body, `/api/link/${cleanSlug}`)
      if (parsed.success) {
        return { success: true, link: parsed.link, status: directRes.status }
      }
      logger.warn(
        `Legacy GET /api/link/${cleanSlug} returned invalid contract, ignoring: ${parsed.error}`
      )
    }

    return {
      success: false,
      error: queryRes.error || 'Link not found',
      status: queryRes.status ?? 404
    }
  }

  /**
   * Updates an existing link.
   */
  async updateLink(
    slug: string,
    payload: UpdateLinkPayload
  ): Promise<{ success: boolean; link?: SinkLink; error?: string }> {
    const cleanSlug = slug.startsWith('/') ? slug.substring(1) : slug
    let res = await this.request<unknown>('/api/link/edit', {
      method: 'PUT',
      body: JSON.stringify({ slug: cleanSlug, ...payload })
    })

    if (!res.success && (res.status === 404 || res.status === 405)) {
      res = await this.request<unknown>('/api/link/update', {
        method: 'POST',
        body: JSON.stringify({ slug: cleanSlug, ...payload })
      })
    }

    if (!res.success) {
      return { success: false, error: res.error || 'Failed to update link' }
    }
    const parsed = parseRequiredLink(res.body, '/api/link/edit')
    return parsed.success
      ? { success: true, link: parsed.link }
      : { success: false, error: parsed.error }
  }

  /**
   * Deletes a link by slug.
   */
  async deleteLink(
    slug: string
  ): Promise<{ success: boolean; error?: string }> {
    const rawClean = slug.startsWith('/') ? slug.substring(1) : slug
    const slugValidation = z.string().trim().min(1).max(100).safeParse(rawClean)
    if (!slugValidation.success) {
      return {
        success: false,
        error: '잘못된 슬러그입니다.'
      }
    }
    const cleanSlug = slugValidation.data

    // Check if the link exists before attempting deletion
    const existing = await this.getLink(cleanSlug)
    if (!existing.success || !existing.link) {
      if (
        existing.status === 404 ||
        existing.error === 'Link not found' ||
        existing.error?.includes('404')
      ) {
        logger.info(`Cannot delete link '/${cleanSlug}': link not found (404)`)
        return {
          success: false,
          error: `단축 링크 '/${cleanSlug}'을(를) 찾을 수 없습니다. (존재하지 않는 링크)`
        }
      }
      logger.warn(
        `Failed to inspect link '/${cleanSlug}' before deletion: ${existing.error}`
      )
      return {
        success: false,
        error: existing.error || '링크 정보를 조회하는 중 오류가 발생했습니다.'
      }
    }

    const res = await this.request<{ success: boolean }>('/api/link/delete', {
      method: 'POST',
      body: JSON.stringify({ slug: cleanSlug })
    })

    if (!res.success && (res.status === 404 || res.status === 405)) {
      // Fallback: try DELETE /api/link/:slug
      const fallbackRes = await this.request<{ success: boolean }>(
        `/api/link/${encodeURIComponent(cleanSlug)}`,
        {
          method: 'DELETE'
        }
      )

      if (!fallbackRes.success) {
        const errorMsg =
          fallbackRes.error || res.error || 'Failed to delete link'
        logger.warn(`Failed to delete link '/${cleanSlug}': ${errorMsg}`)
        return {
          success: false,
          error: errorMsg
        }
      }
      const ack = validateDeleteAcknowledgement(
        fallbackRes.body,
        `/api/link/${encodeURIComponent(cleanSlug)}`
      )
      if (!ack.success) {
        logger.warn(`Failed to delete link '/${cleanSlug}': ${ack.error}`)
      }
      return ack
    }

    if (!res.success) {
      const errorMsg = res.error || 'Failed to delete link'
      logger.warn(`Failed to delete link '/${cleanSlug}': ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
    const ack = validateDeleteAcknowledgement(res.body, '/api/link/delete')
    if (!ack.success) {
      logger.warn(`Failed to delete link '/${cleanSlug}': ${ack.error}`)
    }
    return ack
  }

  /**
   * Fetches visit counters for many links in one request.
   *
   * Sink groups analytics rows by `index1`, which is the link's `id`
   * (`indexes: [link.id]` in the access log). Ids are comma-joined into a single
   * `id` parameter, so a page of links costs one request regardless of size.
   *
   * `analyticsAvailable` distinguishes a real empty dataset from a real
   * "nobody clicked anything". Both come back as `{ data: [] }`: Sink's `useWAE`
   * short-circuits to an empty array when the instance has no Cloudflare
   * credentials, and a query that matched no rows returns the same shape. So an
   * empty response proves nothing and `analyticsAvailable` is then false —
   * callers must treat absent links as unknown, not as zero clicks.
   */
  async getCountersByIds(ids: readonly string[]): Promise<{
    success: boolean
    counters: Map<string, number>
    /** True only when every queried id resolved, so zero counts are provable. */
    analyticsAvailable: boolean
    /** Ids whose click count could not be established. */
    unresolvedIds: string[]
    error?: string
  }> {
    // Validate before de-duplicating so a malformed identifier fails loudly
    // instead of being silently dropped and skewing the totals.
    const validated = z
      .array(z.string().trim().min(1))
      .max(SINK_STATS_MAX_IDS)
      .safeParse(ids)
    if (!validated.success) {
      logger.warn(
        'Sink analytics id validation failed: ids must be non-empty strings'
      )
      return {
        success: false,
        counters: new Map(),
        analyticsAvailable: false,
        unresolvedIds: [...ids],
        error:
          'Invalid link ids for Sink analytics: each id must be a non-empty string of at most 26 characters'
      }
    }

    const uniqueIds = [...new Set(validated.data)]
    if (uniqueIds.length === 0) {
      return {
        success: true,
        counters: new Map(),
        analyticsAvailable: false,
        unresolvedIds: []
      }
    }

    const batches = chunkIdsForStatsRequest(uniqueIds)

    // Worker pool: at most SINK_STATS_CONCURRENCY requests are ever in flight,
    // and a freed slot immediately picks up the next batch rather than waiting
    // for a whole wave to finish. The dashboard passes the entire catalog here
    // (not one page), so this path can have many batches to drain.
    //
    // Each outcome is kept alongside the ids it covered: whether a batch came
    // back empty is only meaningful for that batch's own links.
    const outcomes: {
      ids: string[]
      res: { success: boolean; body?: unknown; error?: string }
    }[] = []
    let nextBatch = 0
    const worker = async (): Promise<void> => {
      while (nextBatch < batches.length) {
        const batch = batches[nextBatch++]
        if (!batch) return
        outcomes.push({
          ids: batch,
          res: await this.request<unknown>(
            `/api/stats/counters?id=${encodeURIComponent(batch.join(','))}`
          )
        })
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(SINK_STATS_CONCURRENCY, batches.length) },
        worker
      )
    )

    const counters = new Map<string, number>()
    let failure: string | undefined
    // Ids whose analytics figure could not be established. A batch that failed
    // outright, or that came back as `{ data: [] }` - which Sink also returns
    // when the instance has no Cloudflare credentials - tells us nothing about
    // whether its links were clicked, so they must not become a measured 0.
    const unresolvedIds = new Set<string>()
    for (const { ids, res } of outcomes) {
      if (!res.success) {
        // Keep whatever the successful batches resolved, so one bad batch does
        // not discard every other batch's real counts.
        failure ??= res.error
        for (const id of ids) unresolvedIds.add(id)
        continue
      }
      const rows = parseCounterRows(res.body)
      if (rows.length === 0) {
        for (const id of ids) unresolvedIds.add(id)
        continue
      }
      for (const row of rows) {
        counters.set(row.id, row.visits)
        unresolvedIds.delete(row.id)
      }
    }
    return {
      success: failure === undefined,
      counters,
      // Only a lookup that resolved every queried id proves the dataset is live
      // for the whole set. A partial or empty outcome leaves it inconclusive.
      analyticsAvailable: unresolvedIds.size === 0,
      unresolvedIds: [...unresolvedIds],
      error: failure
    }
  }

  /**
   * Fetches total visit counters for a single slug.
   *
   * `visits` is `undefined` when Sink returns no analytics row. That case is
   * ambiguous - it covers both a link that was never clicked and an instance
   * whose analytics dataset is unavailable - so it is reported as unknown
   * rather than as a measured zero.
   */
  async getCountersBySlug(slug: string): Promise<{
    success: boolean
    visits: number | undefined
    error?: string
  }> {
    const cleanSlug = validateAnalyticsSlug(slug)
    if (!cleanSlug.success) {
      return { success: false, visits: undefined, error: cleanSlug.error }
    }
    const res = await this.request<unknown>(
      `/api/stats/counters?slug=${encodeURIComponent(cleanSlug.slug)}`
    )
    if (!res.success) {
      return { success: false, visits: undefined, error: res.error }
    }
    // The slug-filtered response carries no `id` column (it is not grouped by
    // link id), so it is read separately from the id-grouped `parseCounterRows`.
    const rows = isRecord(res.body) ? res.body.data : undefined
    const first = Array.isArray(rows) ? rows[0] : undefined
    if (!isRecord(first)) {
      // An empty result is ambiguous and must not be reported as a measured 0.
      // Sink answers `{ data: [] }` both when the instance has no analytics
      // dataset (no Cloudflare credentials) and when the link has no rows; only
      // the instance side can tell those apart, so stay unknown here.
      return { success: true, visits: undefined }
    }
    const visits = Number(first.visits)
    return {
      success: true,
      visits: Number.isFinite(visits) ? visits : undefined
    }
  }

  /**
   * Fetches a single analytics dimension (country, referer, device, ...) for a slug.
   */
  async getMetrics(
    slug: string,
    type: SinkMetricType,
    limit: number = 100
  ): Promise<{
    success: boolean
    metrics: Record<string, number>
    error?: string
  }> {
    const cleanSlug = validateAnalyticsSlug(slug)
    if (!cleanSlug.success) {
      return { success: false, metrics: {}, error: cleanSlug.error }
    }
    const parsedLimit = z
      .number()
      .finite()
      .positive()
      .max(SINK_METRICS_MAX_LIMIT)
      .safeParse(limit)
    if (!parsedLimit.success) {
      return {
        success: false,
        metrics: {},
        error: `Invalid metrics limit for Sink analytics: expected a positive number up to ${SINK_METRICS_MAX_LIMIT}`
      }
    }
    const params = new URLSearchParams({
      slug: cleanSlug.slug,
      type,
      limit: String(Math.floor(parsedLimit.data))
    })
    const res = await this.request<unknown>(
      `/api/stats/metrics?${params.toString()}`
    )
    if (!res.success) {
      return { success: false, metrics: {}, error: res.error }
    }

    const metrics: Record<string, number> = {}
    const body = res.body as { data?: unknown }
    const rows = Array.isArray(body?.data) ? body.data : []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const count = typeof row.count === 'number' ? row.count : NaN
      if (!name || !Number.isFinite(count)) continue
      metrics[name] = count
    }
    return { success: true, metrics }
  }

  /**
   * Fetches the most recent click timestamp for a slug, if any.
   */
  async getLastClickedAt(slug: string): Promise<{
    success: boolean
    lastClickedAt?: number
    error?: string
  }> {
    const cleanSlug = validateAnalyticsSlug(slug)
    if (!cleanSlug.success) {
      return { success: false, error: cleanSlug.error }
    }
    const res = await this.request<unknown>(
      `/api/logs/events?slug=${encodeURIComponent(cleanSlug.slug)}&limit=1`
    )
    if (!res.success) {
      return { success: false, error: res.error }
    }
    if (!Array.isArray(res.body)) {
      return { success: true }
    }
    const first = res.body[0]
    if (!isRecord(first)) {
      return { success: true }
    }
    const timestamp = first.timestamp
    const seconds =
      typeof timestamp === 'number'
        ? timestamp
        : typeof timestamp === 'string'
          ? Date.parse(timestamp)
          : NaN
    if (!Number.isFinite(seconds)) {
      return { success: true }
    }
    // Sink emits either unix seconds or an ISO string; normalize to unix seconds.
    return {
      success: true,
      lastClickedAt: Math.floor(seconds > 1e11 ? seconds / 1000 : seconds)
    }
  }

  /**
   * Fetches statistics and click count for a slug.
   *
   * Sink has no per-link stats endpoint — every figure is derived from the analytics
   * dataset, so this composes counters, three metric dimensions, and the last click.
   */
  async getStats(
    slug: string
  ): Promise<{ success: boolean; stats?: SinkStats; error?: string }> {
    const cleanSlug = slug.startsWith('/') ? slug.substring(1) : slug

    const [counters, countries, referrers, devices, lastClicked, linkRes] =
      await Promise.all([
        this.getCountersBySlug(cleanSlug),
        this.getMetrics(cleanSlug, 'country'),
        this.getMetrics(cleanSlug, 'referer'),
        this.getMetrics(cleanSlug, 'device'),
        this.getLastClickedAt(cleanSlug),
        this.queryLink({ slug: cleanSlug })
      ])

    if (!linkRes.success || !linkRes.link) {
      return {
        success: false,
        error: linkRes.error || 'Link not found'
      }
    }
    if (!counters.success) {
      return {
        success: false,
        error: counters.error || 'Failed to fetch stats'
      }
    }

    const stats: SinkStats = {
      slug: linkRes.link.slug,
      url: linkRes.link.url,
      createdAt: linkRes.link.createdAt,
      countries: countries.metrics,
      referrers: referrers.metrics,
      devices: devices.metrics
    }
    // Left undefined when the instance has no analytics, so the card can say
    // "unavailable" instead of claiming a click count of zero.
    if (counters.visits !== undefined) {
      stats.clicks = counters.visits
    }
    if (lastClicked.success && lastClicked.lastClickedAt !== undefined) {
      stats.lastClickedAt = lastClicked.lastClickedAt
    }

    const parsed = statsSchema.safeParse(stats)
    if (!parsed.success) {
      logger.warn(
        'Sink contract validation failed for link stats: slug and url are required'
      )
      return {
        success: false,
        error:
          'Invalid Sink response contract for link stats: slug and url are required'
      }
    }
    return { success: true, stats: parsed.data }
  }

  /**
   * Lists links with optional tag/options and pagination.
   */
  async listLinks(
    tagOrOptions?: string | SinkListParams,
    page: number = 1,
    limit: number = 1000
  ): Promise<{
    success: boolean
    list: SinkLink[]
    total: number
    cursor?: string | null
    listComplete?: boolean
    error?: string
  }> {
    const params = new URLSearchParams()

    if (typeof tagOrOptions === 'string') {
      if (tagOrOptions) params.append('tag', tagOrOptions)
      if (page > 1) params.append('page', page.toString())
      if (limit > 0) params.append('limit', limit.toString())
    } else if (tagOrOptions && typeof tagOrOptions === 'object') {
      if (tagOrOptions.tag) params.append('tag', tagOrOptions.tag)
      if (tagOrOptions.cursor) params.append('cursor', tagOrOptions.cursor)
      if (tagOrOptions.sort) params.append('sort', tagOrOptions.sort)
      if (tagOrOptions.status) params.append('status', tagOrOptions.status)
      const effectiveLimit = tagOrOptions.limit ?? limit
      if (effectiveLimit > 0) params.append('limit', effectiveLimit.toString())
      if (page > 1 && !tagOrOptions.cursor)
        params.append('page', page.toString())
    } else {
      if (page > 1) params.append('page', page.toString())
      if (limit > 0) params.append('limit', limit.toString())
    }

    const queryString = params.toString()
    const endpoint = `/api/link/list${queryString ? `?${queryString}` : ''}`
    const canFallbackToBareList =
      page === 1 &&
      (typeof tagOrOptions === 'string'
        ? !tagOrOptions
        : !tagOrOptions?.cursor &&
          !tagOrOptions?.tag &&
          !tagOrOptions?.sort &&
          !tagOrOptions?.status)

    let res = await this.request<unknown>(endpoint, {
      method: 'GET'
    })

    // Preserve compatibility only when removing the query cannot change semantics.
    if (!res.success && queryString && canFallbackToBareList) {
      logger.debug(
        `Failed to fetch with queryString (${endpoint}), falling back to bare /api/link/list`
      )
      res = await this.request<unknown>('/api/link/list', {
        method: 'GET'
      })
    }

    if (!res.success) {
      return {
        success: false,
        list: [],
        total: 0,
        error: res.error ?? 'Failed to list links'
      }
    }

    const parsed = parseLinkList(res.body, '/api/link/list')
    if (!parsed.success) {
      return {
        success: false,
        list: [],
        total: 0,
        error: parsed.error
      }
    }

    logger.debug(`Parsed ${parsed.list.length} links from Sink API`)

    return {
      success: true,
      list: parsed.list,
      total: parsed.total,
      cursor: parsed.cursor,
      listComplete: parsed.listComplete
    }
  }

  /**
   * @deprecated Prefer `searchLinks`, `countLinks`, or `queryLink` for scalable operations.
   * Unbounded full listing risks severe latency and memory pressure on large instances.
   */
  async listAllLinks(
    tag?: string,
    maxPages: number = 5
  ): Promise<{
    success: boolean
    list: SinkLink[]
    total: number
    truncated?: boolean
    error?: string
  }> {
    const firstPage = await this.listLinks({ tag, limit: 1000 }, 1, 1000)
    if (!firstPage.success) {
      return firstPage
    }

    const allLinks = [...firstPage.list]
    let expectedTotal = firstPage.total
    let cursor = firstPage.cursor
    let listComplete = firstPage.listComplete

    for (let page = 2; page <= maxPages; page++) {
      const needsCursorPage = Boolean(cursor) && listComplete !== true
      const needsLegacyPage = !cursor && expectedTotal > allLinks.length
      if (!needsCursorPage && !needsLegacyPage) break

      const pageRes = needsCursorPage
        ? await this.listLinks({
            tag,
            cursor: cursor ?? undefined,
            limit: 1000
          })
        : await this.listLinks(tag, page, 1000)
      if (!pageRes.success || pageRes.list.length === 0) break
      allLinks.push(...pageRes.list)
      expectedTotal = Math.max(expectedTotal, pageRes.total, allLinks.length)
      cursor = pageRes.cursor
      listComplete = pageRes.listComplete
    }

    const truncated = expectedTotal > allLinks.length || listComplete === false
    if (truncated) {
      logger.warn(
        `listAllLinks capped results at ${allLinks.length}/${expectedTotal} links (maxPages: ${maxPages})`
      )
    }

    return {
      success: true,
      list: allLinks,
      total: Math.max(expectedTotal, allLinks.length),
      truncated
    }
  }

  /**
   * Checks the health and reachability of a target URL.
   */
  async checkUrlHealth(targetUrl: string): Promise<UrlCheckResult> {
    const startTime = Date.now()
    try {
      const response = await safeHttpGet(targetUrl, {
        timeoutMs: 6000,
        maxRedirects: 5
      })

      const responseTimeMs = Date.now() - startTime
      const contentTypeHeader = response.headers['content-type']
      const contentType = Array.isArray(contentTypeHeader)
        ? (contentTypeHeader[0] ?? null)
        : (contentTypeHeader ?? null)

      return {
        url: targetUrl,
        status: response.status,
        statusText: response.statusText,
        responseTimeMs,
        isAlive: response.status >= 200 && response.status < 400,
        contentType
      }
    } catch (err) {
      const responseTimeMs = Date.now() - startTime
      const errorMessage = err instanceof Error ? err.message : String(err)

      return {
        url: targetUrl,
        status: null,
        statusText: errorMessage,
        responseTimeMs,
        isAlive: false,
        contentType: null
      }
    }
  }

  /**
   * Helper to format a full short URL from slug.
   */
  getFullShortUrl(slug: string): string {
    return `${this.baseUrl}/${slug}`
  }
}

export const sinkClient = new SinkClient()
