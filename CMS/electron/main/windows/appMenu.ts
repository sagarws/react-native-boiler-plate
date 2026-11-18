import { Menu, app } from 'electron'
import type { BrowserWindow } from 'electron'

/**
 * The menu bar, and keeping the developer tools out of a shipped build.
 *
 * ELECTRON SHIPS A MENU NOBODY CHOSE. With no template set, the default one is
 * installed — and it carries View → Toggle Developer Tools, plus its
 * accelerator. On a machine holding live marketplace sessions that is an
 * inspector over the app's own renderer, one keystroke away, for anybody who
 * walks past an unlocked laptop.
 *
 * `setApplicationMenu(null)` is the usual answer and is wrong on macOS: the
 * menu is also where Cmd-Q, Cmd-C, Cmd-V and Cmd-W live, so removing it takes
 * copy and paste out of every text field in the app. This builds the standard
 * roles instead and simply leaves View out — the app draws its own navigation
 * and has never had a menu item of its own.
 *
 * IN DEVELOPMENT NOTHING CHANGES. The tools are how this app gets worked on,
 * and a guard that makes the work harder is a guard that gets removed.
 */
export const applyApplicationMenu = (): void => {
  if (!app.isPackaged) return

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      // macOS puts Quit, Hide and Services here; on Windows and Linux this
      // template is a no-op and the bar is hidden anyway.
      ...(process.platform === 'darwin'
        ? ([{ role: 'appMenu' }] as const)
        : ([] as const)),
      // Not decoration: this is Cmd/Ctrl-C, V, X, A and Z for every input in
      // the app, including the ticket boxes an operator types into all day.
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ])
  )
}

/**
 * The second half, because a menu is not the only way in.
 *
 * The accelerator survives the menu being rebuilt, and `openDevTools` can be
 * reached other ways besides. Closing the tools the moment they open is blunt
 * and it is honest about what it is: this raises the cost of a casual look, it
 * does not stop somebody determined — nothing running on the operator's own
 * machine can.
 */
export const refuseDevTools = (window: BrowserWindow): void => {
  if (!app.isPackaged) return

  window.webContents.on('devtools-opened', () => {
    window.webContents.closeDevTools()
  })
}
