import type { PlatformName } from '@shared/types/ipc'

/**
 * Everything that differs between operating systems is declared here and
 * implemented once per platform. Nothing outside electron/main/platform/ is
 * allowed to branch on process.platform.
 */
export interface PlatformAdapter {
  readonly name: PlatformName
  /** Title bar style handed to BrowserWindow. */
  readonly windowOptions: {
    titleBarStyle?: 'default' | 'hidden' | 'hiddenInset'
    frame?: boolean
  }
  /** Whether closing the last window should quit the app. */
  readonly quitOnLastWindowClosed: boolean
  /** Accelerator prefix used in user-facing hints (Cmd on macOS, Ctrl elsewhere). */
  readonly modifierLabel: string
  /**
   * Put the product mark on whatever the OS shows outside the window.
   *
   * Only macOS has somewhere to put it that `BrowserWindow.icon` does not
   * already cover — the dock reads the .app bundle, so an unpackaged run shows
   * Electron's own atom until something says otherwise. Windows and Linux take
   * their window and taskbar icon from the BrowserWindow option and want
   * nothing here.
   */
  readonly setAppIcon: (iconPath: string) => void
}
