import { useEffect, useState } from 'react'

/**
 * The rail's Camera On / Off switch, shared with the recorder. Ported verbatim
 * from Argos Watch (same storage key, same window event), so a recorder that
 * reads either this hook or the key directly sees the same answer.
 *
 * A window CustomEvent rather than `storage`: storage events do not fire in the
 * window that wrote them, and the rail and the recorder share one window.
 */
const KEY = 'trackvid.cameraOn'
const EVENT = 'trackvid:camera-toggle'

const read = (): boolean => {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === null ? true : saved === 'true'
  } catch {
    return true
  }
}

const write = (on: boolean): void => {
  try {
    localStorage.setItem(KEY, String(on))
  } catch {
    // Storage refused: the switch still works for this session.
  }
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: on }))
}

export const getCameraOn = read

/** A new feed session always starts with the camera on. */
export const resetCameraOn = (): void => write(true)

export const useCameraOn = (): [boolean, (on: boolean) => void] => {
  const [cameraOn, setCameraOnState] = useState<boolean>(read)

  useEffect(() => {
    const handler = (event: Event): void => setCameraOnState((event as CustomEvent<boolean>).detail)
    window.addEventListener(EVENT, handler)
    return () => window.removeEventListener(EVENT, handler)
  }, [])

  const setCameraOn = (on: boolean): void => {
    write(on)
    setCameraOnState(on)
  }

  return [cameraOn, setCameraOn]
}
