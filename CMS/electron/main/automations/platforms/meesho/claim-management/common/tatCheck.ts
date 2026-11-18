import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import type { ClaimDocument } from '@main/automations/common/types'
import type { TatCheckInput, TatCheckVerdict } from '@main/automations/common/tatCheck'

/**
 * Is this Meesho claim still inside its claim window?
 *
 * Meesho answers directly. The supplier panel validates the ticket form as it
 * is typed, and the claim window is one of the things it validates:
 *
 *   POST /api/experience/support/validateTicketField
 *   → { is_valid: false, errors: [{ field_name: "awb_number",
 *       error_message: "The dispute can only be claimed within 7 days of return delivery" }] }
 *
 * Deliberately NOT part of filing. `createTicket` enforces the same rule
 * itself, so asking first would double the calls every batch makes for an
 * answer the submit already gives. This exists for the operator's own check
 * over rows they have selected.
 *
 * Only a window message counts as expired — see `tatVerdict` in the core. Any
 * other validation failure is a different problem, and filing it away as
 * "ME1: TAT expired" would hide it.
 *
 * THE SECOND QUESTION. When the window is not the answer, the SUB-ORDER NUMBER
 * is asked about on its own — the same endpoint with only that field, which is
 * what the panel sends before an AWB exists. The two do not always agree: a
 * form carrying both can come back valid while the number by itself is one
 * Meesho does not recognise, and that row will meet a bare 500 on submit. It
 * costs one more call per row, which is the price of an operator's check
 * answering the question they actually have — can this be filed, and if not,
 * what do I fix.
 */

interface MeeshoTatCore {
  loginMeeshoApi: (
    credentials: { username: string; password?: string; _id?: string | undefined },
    opts?: { session?: { jar: Record<string, string> } }
  ) => Promise<unknown>
  validateTicketField: (
    ctx: unknown,
    input: { subOrderNumber: string; awbNumber: string; categoryId?: string; subCategoryId?: string }
  ) => Promise<{ isValid: boolean; errors: { message: string; field: string | null }[] }>
  tatVerdict: (validation: { isValid: boolean; errors: { message: string }[] }) => {
    expired: boolean
    message: string | null
  }
  validateSubOrderNumber: (
    ctx: unknown,
    input: { subOrderNumber: string; categoryId?: string; subCategoryId?: string }
  ) => Promise<{ isValid: boolean; errors: { message: string; field: string | null }[] }>
  subOrderVerdict: (validation: {
    isValid: boolean
    errors: { message: string; field: string | null }[]
  }) => { invalid: boolean; message: string | null }
  resolveSubCategoryId: (typeOfClaim: unknown) => string
  searchReturnClaims: (
    ctx: unknown,
    awb: string
  ) => Promise<{ found: boolean; returns: { subOrderNumber: string | null }[] }>
}

const core = (): MeeshoTatCore =>
  loadCore<MeeshoTatCore>('platforms/meesho/claim-management/api-based-flow/claimApiFlow')

/** The sub-order number Meesho needs, from the claim or from the AWB search. */
const subOrderOf = async (
  ctx: unknown,
  doc: ClaimDocument,
  awb: string
): Promise<string | null> => {
  const fromClaim = (doc as { subOrderNumber?: unknown }).subOrderNumber

  if (typeof fromClaim === 'string' && fromClaim.trim()) return fromClaim.trim()

  // A claim with no sub-order number can still be checked: the Returns search
  // knows it, and that search is also how we learn the AWB is on this account
  // at all.
  const found = await core().searchReturnClaims(ctx, awb)
  const match = found.returns.find(row => row.subOrderNumber)

  return match?.subOrderNumber ?? null
}

export const meeshoTatCheck = async ({
  doc,
  awb,
  username,
  contexts
}: TatCheckInput): Promise<TatCheckVerdict> => {
  const {
    loginMeeshoApi,
    validateTicketField,
    tatVerdict,
    validateSubOrderNumber,
    subOrderVerdict,
    resolveSubCategoryId
  } = core()
  const { INVALID_SUB_ORDER } = loadCore<{ INVALID_SUB_ORDER: string }>('common/claimErrors')

  // One session per account for the whole run, not per row: a check over fifty
  // claims on one login must not sign in fifty times.
  let ctx = contexts.get(username)

  if (!ctx) {
    const credentials = await claimCredentials('meesho', username)

    ctx =
      credentials.context ??
      (await loginMeeshoApi(
        { username, password: credentials.password, _id: credentials.credentialId },
        { session: { jar: credentials.jar } }
      ))

    contexts.set(username, ctx)
  }

  const subOrderNumber = await subOrderOf(ctx, doc, awb)

  if (!subOrderNumber) {
    return {
      outcome: 'unknown',
      message: `Meesho has no return for AWB ${awb} on ${username}, and the claim carries no sub-order number`
    }
  }

  const validation = await validateTicketField(ctx, {
    subOrderNumber,
    awbNumber: awb,
    categoryId: '1',
    subCategoryId: resolveSubCategoryId((doc as { typeOfClaim?: unknown }).typeOfClaim)
  })

  const verdict = tatVerdict(validation)

  if (verdict.expired) return { outcome: 'expired', message: verdict.message }

  // The window is not the answer, so ask about the number itself.
  const single = await validateSubOrderNumber(ctx, {
    subOrderNumber,
    categoryId: '1',
    subCategoryId: resolveSubCategoryId((doc as { typeOfClaim?: unknown }).typeOfClaim)
  })
  const numberVerdict = subOrderVerdict(single)

  if (numberVerdict.invalid) {
    return { outcome: 'blocked', message: numberVerdict.message, error: INVALID_SUB_ORDER }
  }

  if (validation.isValid) return { outcome: 'within', message: null }

  // Refused, and neither question explains it. Reported as-is so the operator
  // sees the marketplace's own words rather than a wrong code.
  return {
    outcome: 'unknown',
    message: validation.errors[0]?.message ?? 'Meesho refused the claim without saying why'
  }
}
