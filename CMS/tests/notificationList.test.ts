import { describe, expect, it } from 'vitest'
import {
  MAX_NOTIFICATIONS,
  TOAST_MAX_CHARS,
  addNotification,
  hasMoreThanLine,
  markAllRead,
  toastLine,
  unreadCount,
  type AppNotification
} from '@shared/utils/notificationList'

const entry = (id: number, over: Partial<AppNotification> = {}): AppNotification => ({
  id,
  tone: 'info',
  title: `message ${id}`,
  at: '2026-09-04T10:00:00.000Z',
  read: false,
  ...over
})

describe('addNotification', () => {
  it('puts the newest first — that is what anyone opens it for', () => {
    const list = addNotification(addNotification([], entry(1)), entry(2))

    expect(list.map(i => i.id)).toEqual([2, 1])
  })

  // A stuck automation can emit hundreds. Holding them all grows the
  // renderer's memory for something nobody scrolls back to.
  it('caps the list rather than growing without bound', () => {
    let list: AppNotification[] = []

    for (let i = 0; i < MAX_NOTIFICATIONS + 50; i += 1) list = addNotification(list, entry(i))

    expect(list).toHaveLength(MAX_NOTIFICATIONS)
    expect(list[0]?.id).toBe(MAX_NOTIFICATIONS + 49)
  })
})

describe('read state', () => {
  it('counts only the unread', () => {
    expect(unreadCount([entry(1), entry(2, { read: true })])).toBe(1)
  })

  // Read, not deleted — the list stays there to go back to.
  it('marks read without removing anything', () => {
    const list = markAllRead([entry(1), entry(2)])

    expect(list).toHaveLength(2)
    expect(unreadCount(list)).toBe(0)
  })
})

/**
 * A packaged-app stack trace runs to several hundred characters of Windows
 * paths. Unclamped, a batch of failing claims turned the window into a wall of
 * red that covered the app and then vanished.
 */
describe('toastLine', () => {
  it('keeps only the first line', () => {
    expect(toastLine('claim failed\nRequire stack:\n  - a.js')).toBe('claim failed')
  })

  it('truncates a very long single line', () => {
    const long = 'x'.repeat(400)

    expect(toastLine(long)).toHaveLength(TOAST_MAX_CHARS)
    expect(toastLine(long).endsWith('…')).toBe(true)
  })

  it('leaves a short message alone', () => {
    expect(toastLine('Saved')).toBe('Saved')
  })

  // Only offer to expand when expanding would show something new — a row that
  // opens to reveal what it already said is worse than one that does not open.
  it('knows when trimming actually lost something', () => {
    expect(hasMoreThanLine('claim failed\nRequire stack: …')).toBe(true)
    expect(hasMoreThanLine('Saved')).toBe(false)
  })
})
