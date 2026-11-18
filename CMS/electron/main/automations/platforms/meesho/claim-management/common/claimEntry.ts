import { requireClaimConfig } from '@main/automations/common/claimConfig'
import type { ClaimDocument } from '@main/automations/common/types'

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * The config entry a Meesho claim is filed with — the backend's, plus the
 * return video when the backend's entry has none.
 *
 * A row holds its return video in ONE of two places: `returnVideoLink` when a
 * link was pasted, or `returnVideo` (a File ref) when a video was uploaded.
 * The backend builds `config.unpackingVideo` from the link alone, so an
 * uploaded video reached the core as "" and Meesho refused the ticket with
 * "Unpacking Video is required." — on a row whose form showed the video.
 *
 * `/cms/find-by-awb` already resolves both into the document's own
 * `returnVideoLink` (`returnVideoLink || url(returnVideo.key)`), which is what
 * the form displays. So the video the operator sees is the video filed: the
 * config's value wins when it has one, and the document's fills it when not.
 */
export const meeshoClaimEntry = (doc: ClaimDocument): ClaimDocument => {
  const entry = requireClaimConfig('meesho', doc)

  if (text(entry.unpackingVideo)) return entry

  const video = text(doc.returnVideoLink) || text(doc.config?.['returnVideoLink'])

  return video ? { ...entry, unpackingVideo: video } : entry
}
