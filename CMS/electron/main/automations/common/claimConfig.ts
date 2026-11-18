import type { ClaimDocument } from '@main/automations/common/types'

/**
 * The config entry a claim sequence is given.
 *
 * `file<Platform>Claim` reads a shape the backend builds — `configEntry.awbNumber`,
 * `.disputedAmount`, `.shippingLabelImage`, `.issueCategory` — resolving S3
 * keys, Drive links and per-platform cascades on the way. None of those field
 * names exist on the raw CMS document, so the runners were handing the sequences
 * an object with nothing they could read, and the first thing to notice was
 * Myntra: `Fetch claim for "undefined" … searchId is required`.
 *
 * `/cms/find-by-awb` now returns that entry as `config`, built by the backend's
 * own `getPlatformConfig` — the same function the server's runners are fed from.
 *
 * @throws when the backend could not build it, which is a real problem to fix
 *   at the row rather than something to paper over with a half-empty object.
 */
export const requireClaimConfig = (platform: string, doc: ClaimDocument): ClaimDocument => {
  const config = doc.config

  if (config && typeof config === 'object' && Object.keys(config).length > 0) {
    // The document's own identifiers stay reachable — some sequences read the
    // ticket or platform off it — with the built entry taking precedence.
    return { ...doc, ...config }
  }

  throw new Error(
    `The backend returned no ${platform} claim config for this row. It is built by ` +
      '/cms/find-by-awb; a missing one usually means the row lacks the evidence or account ' +
      'details the claim needs.'
  )
}
