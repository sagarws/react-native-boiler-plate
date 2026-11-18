import { createContext, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  addNotification,
  markAllRead as markAllReadIn,
  unreadCount,
  type AppNotification,
  type NotificationTone
} from '@shared/utils/notificationList'

/**
 * Every message the app has shown, kept after its toast has gone.
 *
 * Toasts were the ONLY place these appeared, and they vanish after four
 * seconds. A batch of claims failing produced a wall of red that covered the
 * whole window and then left nothing behind — the operator could neither read
 * them in time nor go back to them.
 *
 * So the toast becomes a glance (one clamped line, four seconds) and this is
 * the record: everything, in full, until the app closes. Deliberately NOT
 * persisted to disk — these are about what just happened in this session, and a
 * list that survives restarts would mostly be answering questions nobody is
 * asking any more.
 */

export type { AppNotification, NotificationTone }

export interface NotificationApi {
  items: AppNotification[]
  unread: number
  add: (tone: NotificationTone, title: string, detail?: string) => void
  markAllRead: () => void
  clear: () => void
}

export const NotificationContext = createContext<NotificationApi | null>(null)

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<AppNotification[]>([])
  // A ref, not state: an id is bookkeeping, and bumping state for it would
  // render the whole tree a second time for every message.
  const nextId = useRef(0)

  const add = useCallback((tone: NotificationTone, title: string, detail?: string) => {
    const id = nextId.current++

    setItems(current =>
      addNotification(current, {
        id,
        tone,
        title,
        ...(detail ? { detail } : {}),
        at: new Date().toISOString(),
        read: false
      })
    )
  }, [])

  const markAllRead = useCallback(() => setItems(markAllReadIn), [])

  const clear = useCallback(() => setItems([]), [])

  const api = useMemo<NotificationApi>(
    () => ({ items, unread: unreadCount(items), add, markAllRead, clear }),
    [items, add, markAllRead, clear]
  )

  return <NotificationContext.Provider value={api}>{children}</NotificationContext.Provider>
}
