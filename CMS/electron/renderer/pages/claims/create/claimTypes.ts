import type { ClaimTypeOption, ECommercePlatformRecord } from '@shared/types/cmsCreate'

/**
 * The claim types an operator may pick on a platform.
 *
 * The per-claim toggle from Settings → E-commerce Settings is respected as
 * soon as ANY claim is enabled. If every one is disabled — the backend seeds
 * Ajio, Meesho and Snapdeal that way — they are all offered anyway, so the
 * dropdown (and a bulk sheet) is never a dead end.
 */
export const selectableClaimTypes = (
  record: ECommercePlatformRecord | undefined
): ClaimTypeOption[] => {
  const all = record?.typeOfClaims || []
  const enabled = all.filter((c) => !c.isDisable)

  return enabled.length > 0 ? enabled : all
}

/**
 * A claim type's identity with case and the `_`/space/`-` separators collapsed.
 *
 * Only the primitives a claim type is ever stored as. Anything else would
 * stringify to "[object Object]" and compare equal to every other object.
 */
export const claimIdentity = (value: unknown): string =>
  (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .trim()
    .toUpperCase()
    .replace(/[_\s-]+/g, '')

/**
 * Which catalogue entry a stored `typeOfClaim` IS, if any.
 *
 * Strictly first, then after collapsing case and separators: a claim loaded by
 * /cms/update may carry a spelling from whenever it was created
 * ("SHORT_QUANTITY" against a catalogue holding "SHORT QUANTITY"), and those
 * are the same claim.
 *
 * Returns null when it is NOT one of this platform's claims — which is a
 * different thing from drifted spelling, and the case that has to be caught
 * rather than displayed as an empty box: a claim type belonging to another
 * marketplace cannot be filed here.
 */
export const matchClaimTypeOption = <T extends { key?: string; name?: string }>(
  options: T[],
  stored: string
): T | null => {
  if (!stored) return null

  const strict = options.find((item) => item.key === stored || item.name === stored)

  if (strict) return strict

  const target = claimIdentity(stored)

  return (
    options.find(
      (item) => claimIdentity(item.key) === target || claimIdentity(item.name) === target
    ) || null
  )
}
