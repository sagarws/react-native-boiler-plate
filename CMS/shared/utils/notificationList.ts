/**
 * How the notification list behaves, with no React in the way.
 *
 * Kept pure so the rules that actually matter — newest first, capped, unread
 * counted — can be tested directly rather than through a rendered component.
 */

export type NotificationTone = 'success' | 'error' | 'info'

export interface AppNotification {
  id: number
  tone: NotificationTone
  /** The one line a toast and the collapsed row show. */
  title: string
  /** Everything else — a stack trace, a require chain. Absent when there is none. */
  detail?: string
  at: string
  read: boolean
}

/**
 * How many to keep.
 *
 * A stuck automation can emit hundreds. Holding them all would grow the
 * renderer's memory for something nobody scrolls back to.
 */
export const MAX_NOTIFICATIONS = 200

/**
 * Newest first — the reason anyone opens this is to see what just happened,
 * not what happened first.
 */
export const addNotification = (
  items: AppNotification[],
  entry: AppNotification
): AppNotification[] => [entry, ...items].slice(0, MAX_NOTIFICATIONS)

/** Read, not deleted: the list stays there to go back to. */
export const markAllRead = (items: AppNotification[]): AppNotification[] =>
  items.map(item => (item.read ? item : { ...item, read: true }))

export const unreadCount = (items: AppNotification[]): number =>
  items.reduce((total, item) => (item.read ? total : total + 1), 0)

/**
 * The longest a toast may be.
 *
 * A packaged-app stack trace runs to several hundred characters of Windows
 * paths; a batch of failing claims turned the window into a wall of red that
 * covered the app and then disappeared. The toast is a GLANCE — the full text
 * goes to the notification centre, which is where it can be read.
 */
export const TOAST_MAX_CHARS = 120

export const toastLine = (message: string): string => {
  const line = message.split('\n')[0]?.trim() ?? message

  return line.length > TOAST_MAX_CHARS ? `${line.slice(0, TOAST_MAX_CHARS - 1)}…` : line
}

/** True when trimming actually lost something worth keeping. */
export const hasMoreThanLine = (message: string): boolean =>
  message.trim().length > toastLine(message).length
