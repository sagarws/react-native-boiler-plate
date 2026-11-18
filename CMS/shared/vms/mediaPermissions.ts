import type {
  MediaPermissionKind,
  MediaPermissionSnapshot,
  MediaPermissionStatus
} from '@shared/vms/permissions'

/**
 * Decisions about the permission modal, kept as pure functions so they can be
 * unit-tested without Electron or a DOM.
 *
 * 'unknown' counts as granted throughout. It means the platform has no API to
 * ask with (Linux), and blocking a recorder behind a question nobody can answer
 * would be worse than letting getUserMedia decide.
 */

export const MEDIA_PERMISSION_KINDS: readonly MediaPermissionKind[] = ['camera', 'microphone']

export const MEDIA_PERMISSION_LABELS: Readonly<Record<MediaPermissionKind, string>> = {
  camera: 'Camera',
  microphone: 'Microphone'
}

export const isMediaPermissionGranted = (status: MediaPermissionStatus): boolean =>
  status === 'granted' || status === 'unknown'

/** The permissions still standing between the operator and a recording. */
export const missingMediaPermissions = (
  snapshot: MediaPermissionSnapshot
): MediaPermissionKind[] =>
  MEDIA_PERMISSION_KINDS.filter((kind) => !isMediaPermissionGranted(snapshot[kind]))

export const hasAllMediaPermissions = (snapshot: MediaPermissionSnapshot): boolean =>
  missingMediaPermissions(snapshot).length === 0

/**
 * What the modal's primary button should do.
 *
 *   'none'     - everything granted; the modal has nothing to ask for.
 *   'prompt'   - the OS will show its consent dialog, so ask it to.
 *   'settings' - already refused once (macOS answers a second
 *                askForMediaAccess with an immediate false, showing nothing),
 *                or this OS never prompts. Send the operator to the settings
 *                page instead of a button that looks broken.
 */
export const mediaPermissionAction = (
  snapshot: MediaPermissionSnapshot
): 'none' | 'prompt' | 'settings' => {
  const missing = missingMediaPermissions(snapshot)
  if (missing.length === 0) return 'none'
  const promptable = missing.every((kind) => snapshot[kind] === 'not-determined')
  if (promptable && snapshot.canPrompt) return 'prompt'
  return snapshot.canOpenSettings ? 'settings' : 'prompt'
}

/** One line the operator can act on, per state. */
export const mediaPermissionSummary = (snapshot: MediaPermissionSnapshot): string => {
  const missing = missingMediaPermissions(snapshot)
  if (missing.length === 0) return 'Camera and microphone access are granted.'
  const names = missing.map((kind) => MEDIA_PERMISSION_LABELS[kind].toLowerCase()).join(' and ')
  return mediaPermissionAction(snapshot) === 'prompt'
    ? `Argos Watch needs ${names} access to record packing evidence.`
    : `${names.charAt(0).toUpperCase()}${names.slice(1)} access is blocked in your system settings. Turn it on for Argos Watch, then re-check.`
}
