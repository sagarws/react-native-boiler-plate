import { useEffect, useState } from 'react'

/**
 * Enumerate video input devices exposed by the browser. Re-runs when a device
 * is plugged / unplugged (devicechange event). Returns [] until the user has
 * granted the camera permission at least once - MediaDeviceInfo.label is empty
 * without permission on Chromium, so we would show a menu of anonymous IDs.
 */
export interface VideoDevice {
  deviceId: string
  label: string
}

export const useVideoDevices = (): VideoDevice[] => {
  const [devices, setDevices] = useState<VideoDevice[]>([])

  useEffect(() => {
    let cancelled = false

    const refresh = async (): Promise<void> => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const videoInputs = list
          .filter((d) => d.kind === 'videoinput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Camera' }))
        setDevices(videoInputs)
      } catch {
        if (!cancelled) setDevices([])
      }
    }

    const onChange = (): void => {
      void refresh()
    }
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', onChange)
    }
  }, [])

  return devices
}
