/**
 * MUST match electron-builder.yml `appId`, because main.ts feeds it to
 * app.setAppUserModelId(): the installer stamps Start Menu shortcuts with the
 * builder's appId, and Windows matches a running window to its shortcut by
 * this string. When the two disagreed (com.example.app here,
 * com.electron.app there) shortcuts failed to resolve and taskbar pinning
 * broke - fixed here rather than left as a second silent mismatch through the
 * rebrand.
 */
export const APP_ID = 'in.trackvid.argoswatch'

/**
 * Filename-safe product name, matching electron-builder's executableName. Used
 * for the installer filename the updater falls back to when the feed URL has
 * no usable name of its own.
 */
export const APP_FILE_SLUG = 'ArgosWatch'
/**
 * The product name shown to operators. Every user-visible mention imports this
 * rather than spelling it out, so a rebrand is one edit and cannot leave a
 * stale name in a dialog nobody opened during testing.
 *
 * NOT the same as electron-builder's `productName`, which names the install
 * directory and the userData folder and therefore cannot change without
 * stranding an existing install's data.
 */
/** The name shown in VMS messages — the merged app is TrackVid CMS (Argos Watch's id/slug kept for reference only). */
export const APP_NAME = 'TrackVid CMS'

export const WINDOW_DEFAULTS = {
  width: 1280,
  height: 800,
  minWidth: 940,
  minHeight: 600
} as const
