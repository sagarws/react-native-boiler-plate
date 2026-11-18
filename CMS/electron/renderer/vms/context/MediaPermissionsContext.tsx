import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { hasAllMediaPermissions } from '@shared/vms/mediaPermissions'
import type { MediaPermissionKind, MediaPermissionSnapshot } from '@shared/vms/permissions'

import { vmsClient } from '../services/vmsClient'

/**
 * One owner of the OS camera / microphone consent state. Ported from Argos
 * Watch; only the channels moved (`vms:media-permissions*`).
 *
 * Two places need the same answer: the dialog that asks for access, and the
 * recorder that must reopen its stream the moment access is given.
 * `grantSeq` is the recorder's retry signal — it increments only on a
 * transition INTO fully granted, so listing it as an effect dependency reopens
 * the camera once per grant rather than on every re-check.
 *
 * Mounted with the VMS content, so the ask happens when the operator opens the
 * VMS — the CMS half never asks for a camera.
 */
export interface MediaPermissionsValue {
  snapshot: MediaPermissionSnapshot
  /** True until the first snapshot arrives; the dialog stays shut meanwhile. */
  loading: boolean
  /** A prompt or settings launch is in flight. */
  busy: boolean
  grantSeq: number
  dialogOpen: boolean
  openDialog: () => void
  closeDialog: () => void
  refresh: () => Promise<void>
  request: () => Promise<void>
  openSettings: (kind: MediaPermissionKind) => Promise<void>
}

/** 'unknown' reads as granted, so nothing is blocked by a missing provider. */
const UNKNOWN_SNAPSHOT: MediaPermissionSnapshot = {
  camera: 'unknown',
  microphone: 'unknown',
  canPrompt: false,
  canOpenSettings: false
}

const noop = (): void => undefined
const asyncNoop = (): Promise<void> => Promise.resolve()

export const MediaPermissionsContext = createContext<MediaPermissionsValue>({
  snapshot: UNKNOWN_SNAPSHOT,
  loading: false,
  busy: false,
  grantSeq: 0,
  dialogOpen: false,
  openDialog: noop,
  closeDialog: noop,
  refresh: asyncNoop,
  request: asyncNoop,
  openSettings: asyncNoop
})

export const MediaPermissionsProvider = ({ children }: { children: ReactNode }) => {
  const [snapshot, setSnapshot] = useState<MediaPermissionSnapshot>(UNKNOWN_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [grantSeq, setGrantSeq] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)

  const mountedRef = useRef(true)
  const grantedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const applySnapshot = useCallback((next: MediaPermissionSnapshot): void => {
    if (!mountedRef.current) return
    setSnapshot(next)
    const granted = hasAllMediaPermissions(next)
    // Only a transition into granted counts, or every re-check would restart
    // the camera stream.
    if (granted && !grantedRef.current) {
      setGrantSeq((current) => current + 1)
      setDialogOpen(false)
    }
    grantedRef.current = granted
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const response = await vmsClient.mediaPermissions()
    if (response.success) applySnapshot(response.data)
    if (mountedRef.current) setLoading(false)
  }, [applySnapshot])

  const request = useCallback(async (): Promise<void> => {
    if (mountedRef.current) setBusy(true)
    try {
      const response = await vmsClient.requestMediaPermissions()
      if (response.success) applySnapshot(response.data)
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [applySnapshot])

  const openSettings = useCallback(async (kind: MediaPermissionKind): Promise<void> => {
    if (mountedRef.current) setBusy(true)
    try {
      await vmsClient.openMediaPrivacySettings(kind)
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [])

  // The first check. `grantedRef` starts true, so a first snapshot that is
  // already granted is not a transition and does not bump grantSeq.
  useEffect(() => {
    let cancelled = false
    void vmsClient.mediaPermissions().then((response) => {
      if (cancelled || !mountedRef.current) return
      setLoading(false)
      if (!response.success) return
      setSnapshot(response.data)
      const granted = hasAllMediaPermissions(response.data)
      grantedRef.current = granted
      // Ask up front, rather than let the recorder fail later with an error
      // the operator cannot act on.
      if (!granted) setDialogOpen(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A grant made in the OS settings window never reaches the app by itself;
  // re-reading on focus makes "switch back to the app" the confirmation.
  useEffect(() => {
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const value = useMemo<MediaPermissionsValue>(
    () => ({
      snapshot,
      loading,
      busy,
      grantSeq,
      dialogOpen,
      openDialog: () => setDialogOpen(true),
      closeDialog: () => setDialogOpen(false),
      refresh,
      request,
      openSettings
    }),
    [snapshot, loading, busy, grantSeq, dialogOpen, refresh, request, openSettings]
  )

  return <MediaPermissionsContext.Provider value={value}>{children}</MediaPermissionsContext.Provider>
}
