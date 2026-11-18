import { useContext } from 'react'

import { MediaPermissionsContext, type MediaPermissionsValue } from '../context/MediaPermissionsContext'

/**
 * The shared OS camera / microphone consent state. Safe without a provider:
 * the default reports 'unknown', which counts as granted.
 */
export const useMediaPermissions = (): MediaPermissionsValue => useContext(MediaPermissionsContext)
