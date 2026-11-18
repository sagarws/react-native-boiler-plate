import { useCallback, useEffect, useState } from 'react'
import type { ImportScheduleState } from '@shared/types/importSchedule'
import { relativeTime } from '@shared/utils/sessionHealth'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import { useToast } from '@renderer/hooks/useToast'
import {
  onScheduleChanged,
  scheduleState as readState,
  setSyncTime
} from '@renderer/services/importSchedule.service'

/**
 * The master-import schedule for this machine.
 *
 * The time is a company setting, so changing it here changes it everywhere —
 * said plainly on the card, because a control that looks machine-local but is
 * not is the kind of thing someone discovers by surprising a colleague.
 */
export const ImportScheduleCard = () => {
  const toast = useToast()
  const [state, setState] = useState<ImportScheduleState | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    void readState().then(response => {
      if (cancelled || !response.success) return
      setState(response.data)
      setDraft(response.data.syncTime ?? '')
    })

    // The scheduler pushes as it ticks, so the card reflects a run starting or
    // failing without the operator refreshing.
    const unsubscribe = onScheduleChanged(next => {
      setState(next)
      setDraft(current => (current === '' ? next.syncTime ?? '' : current))
    })

    // Both, not just the unsubscribe: returning only that left `cancelled`
    // permanently false, so an in-flight read could still write to an unmounted
    // component.
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    const response = await setSyncTime(draft.trim() === '' ? null : draft.trim())
    setSaving(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }
    setState(response.data)
    toast.success(
      response.data.syncTime
        ? `Master import scheduled for ${response.data.syncTime} IST`
        : 'Master import schedule turned off'
    )
  }, [draft, toast])

  if (!state) return null

  const dirty = (state.syncTime ?? '') !== draft.trim()

  return (
    <section className="veylix-glass mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="veylix-card-title">Master import schedule</h2>
          <p className="mt-0.5 text-xs text-muted">
            Runs on this machine for{' '}
            {state.platforms.length > 0 ? (
              <span className="capitalize">{state.platforms.join(', ')}</span>
            ) : (
              <span className="text-warning-fg">no platforms — none are routed to desktop</span>
            )}
            . The time is a company setting and applies to every machine.
          </p>
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="sync-time" className="mb-1 block text-xs font-medium text-secondary">
              Time (IST)
            </label>
            <Input
              id="sync-time"
              type="time"
              className="w-32"
              value={draft}
              disabled={saving}
              onChange={event => setDraft(event.target.value)}
            />
          </div>
          <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 border-t border-hairline pt-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted">Last import</dt>
          <dd className="font-medium text-primary">
            {state.lastRunAt === null
              ? 'never'
              : relativeTime(new Date(state.lastRunAt).toISOString())}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Next import</dt>
          <dd className="font-medium text-primary">
            {state.nextRunAt === null
              ? 'not scheduled'
              : relativeTime(new Date(state.nextRunAt).toISOString())}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Status</dt>
          <dd
            className={
              state.offline
                ? 'font-medium text-warning-fg'
                : state.running
                  ? 'font-medium text-accent-hover'
                  : 'font-medium text-primary'
            }
          >
            {state.offline ? 'Waiting for network' : state.running ? 'Running' : 'Idle'}
          </dd>
        </div>
      </dl>

      {state.lastError && (
        <p role="alert" className="mt-2 rounded bg-danger-surface px-2 py-1 text-xs text-danger-fg">
          {state.lastError}
        </p>
      )}
    </section>
  )
}
