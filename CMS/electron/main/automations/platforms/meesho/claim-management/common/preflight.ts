import type { ClaimDocument } from '@main/automations/common/types'
import { logger } from '@main/services/logger'

/**
 * Preflight: reject a Meesho claim the runner cannot possibly complete.
 *
 * Cheap checks that would otherwise surface as a Submit-is-disabled timeout
 * (or worse, an already-uploaded video for a form that was never going to
 * submit) belong here — before the browser opens.
 *
 * Called by both the api-based and the script-based runners, because both
 * shapes of the flow read the same config entry and neither can submit a
 * ticket without a Packet ID.
 */

export const requireMeeshoClaimPreflight = (awb: string, entry: ClaimDocument): void => {
  // Narrow before stringifying: the config bag is `[key: string]: unknown`
  // and a stray object would coerce to "[object Object]" and pass the falsy
  // check. Only string and number are legitimate ids.
  const raw = entry.packetId
  const packetId =
    typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''

  if (!packetId) {
    // Same wording the core's fillPacketId throws with, so an operator
    // reading either log sees one story. Failing here means no browser is
    // even opened for a claim that could not be submitted anyway.
    throw new Error(
      "Packet ID is missing — Meesho's Raise Ticket form requires it and the " +
        'Submit button stays disabled without one. Fill Packet ID on the row and retry.'
    )
  }

  // One line in the app log so the operator can see what will be typed into
  // the form — the user asked to log the packet id being added.
  logger.info(`[meesho-claim] packet id for ${awb}: ${packetId}`)
}
