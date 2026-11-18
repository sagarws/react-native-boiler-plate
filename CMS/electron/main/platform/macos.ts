import { app, nativeImage } from 'electron'
import type { PlatformAdapter } from './types'

export const macosAdapter: PlatformAdapter = {
  name: 'darwin',
  // A REAL TITLE BAR, not `hiddenInset`.
  //
  // hiddenInset let the app draw its own header, and the cost was that the
  // traffic lights floated over whatever the rail happened to be drawing: the
  // rail needed a 34px shim to duck under them, the nav header had to become a
  // drag strip, and every control inside it had to opt back out of dragging or
  // stop taking clicks. macOS places and spaces the buttons itself here, so
  // none of that is needed and none of it can drift.
  //
  // It follows the app's Light/Dark choice rather than the system's - see
  // windows/nativeAppearance.ts.
  windowOptions: { titleBarStyle: 'default' },
  // macOS apps conventionally stay alive when every window is closed.
  quitOnLastWindowClosed: false,
  modifierLabel: 'Cmd',
  // `app.dock` is absent when the app runs as an agent, so this is optional
  // rather than assumed. An unreadable file yields an empty image, which
  // setIcon rejects - so it is checked rather than handed over blind.
  setAppIcon: (iconPath) => {
    const icon = nativeImage.createFromPath(iconPath)

    if (icon.isEmpty()) return

    app.dock?.setIcon(icon)
  }
}
