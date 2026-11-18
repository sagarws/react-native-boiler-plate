import type {
  ReturnArticle,
  ReturnArticles,
  SkuCandidate,
  SkuSweepProgress,
  SkuSweepResult,
  SkuSweepRow
} from '@shared/types/skuLookup'
import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { withAutomationLock } from './automationLock'
import {
  openAjioArticleReader,
  readAjioReturnArticles,
  type AjioArticleReader
} from '../automations/platforms/ajio/claim-management/api-based-flow/returnArticles'
import { loadCore } from '../automations/common/coreLoader'
import { broadcast } from '../ipc/broadcast'
import { SKU_LOOKUP_EVENTS } from '@shared/constants/channels'
import { logger } from './logger'

/**
 * Picking a claim's seller SKU off the marketplace's own answer.
 *
 * A claim cannot be filed without a SKU — `selectReturnItem` refuses to choose
 * when the return has several articles and none was given, because guessing
 * files the claim against the wrong item — and master data does not have these
 * rows. AJIO does: its return-order detail lists every article on the return.
 *
 * So the app reads that list and a PERSON picks. That is the whole design: the
 * one place an automation must not guess is the one where a human glance at a
 * product name settles it.
 *
 * AJIO only, for now. It is the platform whose claim aborts on a missing SKU
 * and the only one with an endpoint that answers per return AWB — Meesho is
 * keyed on the sub-order number, which account mapping already fills in.
 */

interface LookupRequest {
  cmsId?: unknown
  awbNumber?: unknown
  pobId?: unknown
  username?: unknown
  accountType?: unknown
  platform?: unknown
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const lookupReturnArticles = async (payload: unknown): Promise<Result<ReturnArticles>> => {
  const request = (payload ?? {}) as LookupRequest
  const platform = text(request.platform).toLowerCase()
  const awbNumber = text(request.awbNumber)
  const pobId = text(request.pobId)
  const username = text(request.username)

  if (platform !== 'ajio') {
    return fail(
      'VALIDATION_ERROR',
      `Reading a return's articles is an AJIO feature — ${text(request.platform) || 'this platform'} has no endpoint that answers by return AWB.`
    )
  }
  if (!awbNumber) return fail('VALIDATION_ERROR', 'This claim has no return AWB to look up')
  if (!username) {
    // The account decides which seller portal is asked, so without it there is
    // nothing to sign into. Map Username is the fix, and naming it beats a
    // generic failure.
    return fail(
      'VALIDATION_ERROR',
      'This claim names no AJIO account — run Map Username first, then look the SKU up'
    )
  }
  if (!pobId) {
    // The return search is scoped to a place of business; without one there is
    // no search to run. Map Username resolves the POB alongside the account.
    return fail(
      'VALIDATION_ERROR',
      'This claim has no POB ID — run Map Username first, which resolves it along with the account'
    )
  }

  // Takes the lock like any other browser work: it may open a marketplace
  // session, and two of those at once is what the lock exists to prevent. When
  // a run already holds a signed-in AJIO page this borrows it and costs nothing.
  return withAutomationLock('sku-lookup', async () => {
    try {
      const articles = await readAjioReturnArticles({
        username,
        pobId,
        awbNumber,
        ...(text(request.accountType) ? { accountType: text(request.accountType) } : {})
      })

      logger.info(`[sku-lookup] ${awbNumber}: ${articles.articles.length} article(s)`)

      return ok(articles)
    } catch (error) {
      // AJIO's own wording is the actionable one here ("No return found for AWB
      // … under POB …"), so it is passed through rather than flattened.
      return fail(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Could not read the return from AJIO'
      )
    }
  })
}

/** Stores the SKU the operator chose. */
export const applySellerSku = async (
  payload: unknown
): Promise<Result<{ cmsId: string; sellerSku: string; previous: string | null }>> => {
  const request = (payload ?? {}) as { cmsId?: unknown; sellerSku?: unknown }
  const cmsId = text(request.cmsId)
  const sellerSku = text(request.sellerSku)

  if (!cmsId) return fail('VALIDATION_ERROR', 'No claim was given')
  if (!sellerSku) return fail('VALIDATION_ERROR', 'No SKU was chosen')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to update the claim')

  return apiRequest('/cms/claim-seller-sku', {
    method: 'POST',
    token,
    body: { cmsId, sellerSku }
  })
}


/* ------------------------------------------------------------------------- *
 * The bulk sweep.
 *
 * Two phases, deliberately. The first asks AJIO about every eligible row and
 * shows its progress; the second is a REVIEW an operator saves. Nothing is
 * written until they do — a sweep that wrote as it went would silently replace
 * SKUs across seventy claims on the strength of one bad search, and a return
 * with several articles has no automatic right answer at all.
 * ------------------------------------------------------------------------- */

/** The run in flight, or the last one — so a minimised modal can be reopened. */
let sweepProgress: SkuSweepProgress | null = null
let sweepResult: SkuSweepResult | null = null

interface CandidatesResponse {
  platform: string
  limit: number
  claims: SkuCandidate[]
}

interface ArticleRules {
  storableSku: (
    article: ReturnArticle,
    articles: ReturnArticle[]
  ) => { value: string; field: string; unique: boolean } | null
  findArticleBySku: (articles: ReturnArticle[], sku: string) => ReturnArticle | null
}

export const skuSweepStatus = (): Result<{
  progress: SkuSweepProgress | null
  result: SkuSweepResult | null
}> => ok({ progress: sweepProgress, result: sweepResult })

/** How many claims a sweep would ask about. Drives the button. */
export const skuSweepPending = async (
  payload: unknown
): Promise<Result<{ platform: string; count: number; capped: boolean; cmsIds: string[] }>> => {
  const platform = text((payload as { platform?: unknown })?.platform).toLowerCase()

  if (platform !== 'ajio') return ok({ platform, count: 0, capped: false, cmsIds: [] })

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to look SKUs up')

  const response = await apiRequest<CandidatesResponse>('/cms/sku-candidates', {
    method: 'POST',
    token,
    body: { platform }
  })

  if (!response.success) return response

  const claims = response.data.claims ?? []

  return ok({
    platform,
    count: claims.length,
    capped: claims.length >= response.data.limit,
    // Ids as well as the count, so every eligible row can be ticked in one go
    // rather than a page at a time. See accountMapPending.
    cmsIds: claims.map(claim => claim.cmsId)
  })
}

/**
 * Reorders a sweep so one account's rows run together.
 *
 * Only one page is held per account and opening one is a browser launch — so a
 * list that alternates between two sellers would open, close and reopen Chrome
 * on every row. Stable, so an operator still sees roughly the order they were
 * listed in.
 */
const groupedByAccount = (claims: SkuCandidate[]): SkuCandidate[] => {
  const groups = new Map<string, SkuCandidate[]>()

  for (const claim of claims) {
    const key = claim.username.toLowerCase()

    groups.set(key, [...(groups.get(key) ?? []), claim])
  }

  return [...groups.values()].flat()
}

/**
 * Which SKU to pre-select, and whether what the claim already says is wrong.
 *
 * Three cases, and only one of them is a decision:
 *
 *   one article          → that one, chosen. Nothing to decide.
 *   several, SKU matches → keep what the claim says. It is already right, and
 *                          re-picking it would invite an operator to change a
 *                          correct answer.
 *   several, no match    → nothing pre-selected. This is the case the review
 *                          table exists for, and guessing here is precisely how
 *                          a claim gets filed against the wrong item.
 *
 * `mismatch` is separate from all of that: it means the claim names a SKU that
 * is on NONE of the articles, which is worth showing whether or not there is
 * anything to choose.
 */
const review = (
  claim: SkuCandidate,
  articles: ReturnArticle[],
  rules: ArticleRules
): { suggested: string | null; mismatch: boolean } => {
  const matched = claim.currentSku ? rules.findArticleBySku(articles, claim.currentSku) : null
  const mismatch = claim.currentSku.length > 0 && matched === null

  if (matched) return { suggested: rules.storableSku(matched, articles)?.value ?? null, mismatch }

  const only = articles.length === 1 ? articles[0] : undefined

  return {
    suggested: only ? (rules.storableSku(only, articles)?.value ?? null) : null,
    mismatch
  }
}

/** Asks AJIO about every eligible claim, and reports what it found. */
export const runSkuSweep = async (payload: unknown): Promise<Result<SkuSweepResult>> => {
  const request = (payload ?? {}) as { platform?: unknown; cmsIds?: unknown }
  const platform = text(request.platform).toLowerCase()
  // The rows the operator ticked — narrowed by the backend, whose rule decides
  // what is readable in the first place.
  const cmsIds = Array.isArray(request.cmsIds)
    ? request.cmsIds.map(id => text(id)).filter(id => id.length > 0)
    : null

  if (platform !== 'ajio') {
    return fail(
      'VALIDATION_ERROR',
      'Only AJIO can be asked which articles a return AWB holds, so only AJIO SKUs can be swept.'
    )
  }

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to look SKUs up')

  const candidates = await apiRequest<CandidatesResponse>('/cms/sku-candidates', {
    method: 'POST',
    token,
    body: { platform, ...(cmsIds ? { cmsIds } : {}) }
  })

  if (!candidates.success) return candidates

  const claims = candidates.data.claims ?? []

  if (claims.length === 0) {
    sweepResult = { platform, total: 0, resolved: 0, failed: 0, rows: [] }

    return ok(sweepResult)
  }

  return withAutomationLock('sku-sweep', () => sweep(platform, groupedByAccount(claims), token))
}

const sweep = async (
  platform: string,
  claims: SkuCandidate[],
  _token: string
): Promise<Result<SkuSweepResult>> => {
  const rules = loadCore<ArticleRules>(
    'platforms/ajio/claim-management/api-based-flow/returnArticles'
  )

  const readers = new Map<string, Promise<AjioArticleReader>>()
  const rows: SkuSweepRow[] = []
  const misses: { awbNumber: string; message: string }[] = []

  let resolved = 0
  let failed = 0

  const publish = (awbNumber: string, running: boolean): void => {
    sweepProgress = {
      platform,
      done: rows.length,
      total: claims.length,
      resolved,
      failed,
      awbNumber,
      running,
      misses
    }

    broadcast(SKU_LOOKUP_EVENTS.progress, sweepProgress)
  }

  /**
   * Opens an account once, including when the sign-in FAILS.
   *
   * A dead credential otherwise costs one slow failed sign-in per row, for
   * every row on that account.
   */
  const readerFor = (username: string): Promise<AjioArticleReader> => {
    const existing = readers.get(username.toLowerCase())

    if (existing) return existing

    logger.info(`[sku-sweep] opening ${username}`)

    const opening = openAjioArticleReader(username)

    readers.set(username.toLowerCase(), opening)

    return opening
  }

  try {
    for (const [index, claim] of claims.entries()) {
      publish(claim.awbNumber, true)
      logger.info(`[sku-sweep] ${index + 1}/${claims.length} — ${claim.awbNumber}`)

      try {
        const reader = await readerFor(claim.username)
        const found = await reader.read({
          awbNumber: claim.awbNumber,
          pobId: claim.pobId,
          ...(claim.accountType ? { accountType: claim.accountType } : {})
        })

        resolved += 1
        rows.push({
          cmsId: claim.cmsId,
          awbNumber: claim.awbNumber,
          currentSku: claim.currentSku,
          articles: found.articles,
          ...review(claim, found.articles, rules),
          error: null
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        failed += 1
        misses.push({ awbNumber: claim.awbNumber, message })
        rows.push({
          cmsId: claim.cmsId,
          awbNumber: claim.awbNumber,
          currentSku: claim.currentSku,
          articles: [],
          suggested: null,
          mismatch: false,
          error: message
        })
      }
    }
  } finally {
    for (const [username, opening] of readers) {
      try {
        await (await opening).close()
      } catch (error) {
        logger.warn(
          `[sku-sweep] could not close ${username}: ` +
            (error instanceof Error ? error.message : String(error))
        )
      }
    }

    // STORED BEFORE IT IS ANNOUNCED. The terminal tick is what tells the window
    // the sweep is over, and the window answers it by asking for the review —
    // so publishing first means answering that question with the PREVIOUS run's
    // rows, or with none at all. The same ordering mistake the claim queue made:
    // a listener reacting to a broadcast must never be able to outrun the write
    // it is reacting to.
    sweepResult = { platform, total: claims.length, resolved, failed, rows }

    publish('', false)
  }

  logger.info(`[sku-sweep] ${platform}: ${resolved} resolved, ${failed} failed of ${claims.length}`)

  return ok(sweepResult)
}

/**
 * Saves the SKUs an operator confirmed.
 *
 * One row per call, through the endpoint the single picker already uses — the
 * server re-checks the claim's company and status on each, and a save that dies
 * halfway has still stored everything it got to.
 */
export const applySkuSelections = async (
  payload: unknown
): Promise<Result<{ saved: number; failed: number; failures: { awbNumber: string; message: string }[] }>> => {
  const selections = ((payload as { selections?: unknown })?.selections ?? []) as {
    cmsId?: unknown
    awbNumber?: unknown
    sellerSku?: unknown
  }[]

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to update claims')

  let saved = 0
  const failures: { awbNumber: string; message: string }[] = []

  for (const selection of selections) {
    const cmsId = text(selection.cmsId)
    const sellerSku = text(selection.sellerSku)

    if (!cmsId || !sellerSku) continue

    const response = await apiRequest('/cms/claim-seller-sku', {
      method: 'POST',
      token,
      body: { cmsId, sellerSku }
    })

    if (response.success) saved += 1
    else failures.push({ awbNumber: text(selection.awbNumber) || cmsId, message: response.error.message })
  }

  logger.info(`[sku-sweep] saved ${saved} SKU(s), ${failures.length} failed`)

  return ok({ saved, failed: failures.length, failures })
}
