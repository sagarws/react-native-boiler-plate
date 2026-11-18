import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import { leasedSession } from '@main/services/browserLease.service'
import {
  openSignedInAjioPage,
  type PuppeteerPage
} from '@main/automations/platforms/ajio/common/signedInPage'
import { logger } from '@main/services/logger'
import type { ReturnArticles } from '@shared/types/skuLookup'

/**
 * Reads the articles AJIO holds against one return AWB.
 *
 * A READ. It raises nothing and writes nothing to the marketplace — the whole
 * point is to show a person what is there so they can pick the right article,
 * rather than have an automation guess and file a claim against the wrong item.
 *
 * The signed-in page comes from the shared opener, which reuses the stored
 * session and — crucially — SAVES one when it has to sign in. This file used to
 * do that itself and skipped the saving half, so every press of the icon logged
 * in from scratch.
 *
 * Uses the same leased browser key as the AJIO claim runner (`ajio:<username>`),
 * so pressing this during a run costs nothing: it borrows the page that is
 * already signed in.
 */

interface AjioArticles {
  fetchReturnArticles: (
    page: PuppeteerPage,
    input: {
      sellerId: string
      pobid: string
      returnAwb: string
      accountType?: string
      userLogger?: unknown
    }
  ) => Promise<ReturnArticles>
}

/**
 * One account, opened once and asked about many returns.
 *
 * The sweep's shape, and the reason it is not simply `readAjioReturnArticles` in
 * a loop: opening an account is a browser launch and, when the stored session
 * has expired, an SSO sign-in. Seventy rows on one seller account is one page,
 * not seventy.
 *
 * NOT leased. The lease holds a single session at a time and a sweep works
 * through several accounts, so it owns its pages outright and closes each when
 * that account's rows are done.
 */
export interface AjioArticleReader {
  read: (input: { awbNumber: string; pobId: string; accountType?: string }) => Promise<ReturnArticles>
  close: () => Promise<void>
}

export const openAjioArticleReader = async (username: string): Promise<AjioArticleReader> => {
  const credentials = await claimCredentials('ajio', username)

  const { fetchReturnArticles } = loadCore<AjioArticles>(
    'platforms/ajio/claim-management/api-based-flow/returnArticles'
  )

  const opened = await openSignedInAjioPage({ username, password: credentials.password })

  return {
    read: input =>
      fetchReturnArticles(opened.page, {
        sellerId: opened.sellerId,
        pobid: input.pobId,
        returnAwb: input.awbNumber,
        ...(input.accountType ? { accountType: input.accountType } : {}),
        userLogger: logger
      }),
    close: async () => {
      await opened.browser.close().catch(() => undefined)
    }
  }
}

export const readAjioReturnArticles = async (input: {
  username: string
  pobId: string
  awbNumber: string
  accountType?: string
}): Promise<ReturnArticles> => {
  const credentials = await claimCredentials('ajio', input.username)

  const { fetchReturnArticles } = loadCore<AjioArticles>(
    'platforms/ajio/claim-management/api-based-flow/returnArticles'
  )

  const { page, context, release } = await leasedSession(`ajio:${input.username}`, async () => {
    const opened = await openSignedInAjioPage({
      username: input.username,
      password: credentials.password
    })

    return {
      browser: opened.browser,
      page: opened.page,
      context: { sellerId: opened.sellerId }
    }
  })

  try {
    return await fetchReturnArticles(page as PuppeteerPage, {
      sellerId: context.sellerId,
      pobid: input.pobId,
      returnAwb: input.awbNumber,
      ...(input.accountType ? { accountType: input.accountType } : {}),
      userLogger: logger
    })
  } finally {
    // A no-op while a run holds the lease; a real close when it does not.
    await release()
  }
}
