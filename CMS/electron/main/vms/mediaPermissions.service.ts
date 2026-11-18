import { shell, systemPreferences } from 'electron'
import { fail, ok, type Result } from '@shared/types/result'
import type { PlatformName } from '@shared/types/ipc'
import type { MediaPermissionKind, MediaPermissionSnapshot, MediaPermissionStatus } from '@shared/vms/permissions'
import { platform } from '../platform'
import { logger } from '../services/logger'

/**
 * OS camera / microphone consent — Argos Watch's permissions.service.
 *
 * Argos kept the per-OS facts on its platform adapter. The CMS adapter does
 * not carry them, so they are a table here keyed by the adapter's `name`:
 * the OS is still decided once, in electron/main/platform/index.ts.
 */

interface MediaSupport {
  canQueryStatus: boolean
  /** systemPreferences.askForMediaAccess exists (macOS only). */
  canPrompt: boolean
  settingsUrl: Readonly<Record<MediaPermissionKind, string | null>>
}

const MEDIA_SUPPORT: Readonly<Record<PlatformName, MediaSupport>> = {
  darwin: {
    canQueryStatus: true,
    canPrompt: true,
    settingsUrl: {
      camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
      microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    }
  },
  win32: {
    canQueryStatus: true,
    canPrompt: false,
    settingsUrl: { camera: 'ms-settings:privacy-webcam', microphone: 'ms-settings:privacy-microphone' }
  },
  linux: { canQueryStatus: false, canPrompt: false, settingsUrl: { camera: null, microphone: null } },
  other: { canQueryStatus: false, canPrompt: false, settingsUrl: { camera: null, microphone: null } }
}

const media = (): MediaSupport => MEDIA_SUPPORT[platform.name]

const MEDIA_KINDS: readonly MediaPermissionKind[] = ['camera', 'microphone']

const isMediaKind = (value: unknown): value is MediaPermissionKind =>
  typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value)

/** A status that cannot be read is 'unknown', which the UI treats as granted. */
const readStatus = (kind: MediaPermissionKind): MediaPermissionStatus => {
  if (!media().canQueryStatus) return 'unknown'
  try {
    const status = systemPreferences.getMediaAccessStatus(kind)
    switch (status) {
      case 'granted':
      case 'denied':
      case 'restricted':
      case 'not-determined':
        return status
      default:
        return 'unknown'
    }
  } catch (error) {
    logger.warn('[vms] could not read media access status', { kind, error: String(error) })
    return 'unknown'
  }
}

const snapshot = (): MediaPermissionSnapshot => ({
  camera: readStatus('camera'),
  microphone: readStatus('microphone'),
  canPrompt: media().canPrompt,
  canOpenSettings: MEDIA_KINDS.some((kind) => media().settingsUrl[kind] !== null)
})

export const getMediaPermissions = (): Promise<Result<MediaPermissionSnapshot>> => Promise.resolve(ok(snapshot()))

/** Raises the OS dialog (macOS) one kind at a time; elsewhere answers the current snapshot. */
export const requestMediaPermissions = async (payload: unknown): Promise<Result<MediaPermissionSnapshot>> => {
  const requested = (payload as { kinds?: unknown } | null)?.kinds
  const kinds = Array.isArray(requested) ? requested.filter(isMediaKind) : MEDIA_KINDS
  if (!media().canPrompt) return ok(snapshot())
  for (const kind of kinds) {
    const granted = await systemPreferences.askForMediaAccess(kind)
    logger.info('[vms] media access prompt answered', { kind, granted })
  }
  return ok(snapshot())
}

export const openMediaPrivacySettings = async (payload: unknown): Promise<Result<null>> => {
  const kind = (payload as { kind?: unknown } | null)?.kind
  if (!isMediaKind(kind)) return fail('VALIDATION_ERROR', 'kind must be "camera" or "microphone"')
  const url = media().settingsUrl[kind]
  if (!url) return fail('NOT_FOUND', 'This system has no privacy settings page to open.')
  try {
    await shell.openExternal(url)
    return ok(null)
  } catch (error) {
    logger.error('[vms] could not open privacy settings', error)
    return fail('INTERNAL_ERROR', 'Could not open system settings. Open them manually.')
  }
}
