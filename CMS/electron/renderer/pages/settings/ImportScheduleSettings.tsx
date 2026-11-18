import { useCallback, useEffect, useState } from 'react'
import { IMPORT_SCHEDULE_CHANNELS, PLATFORM_SESSION_CHANNELS } from '@shared/constants/channels'
import type { ImportScheduleState } from '@shared/types/importSchedule'
import type { PlatformDescriptor } from '@shared/types/platformSession'
import { Button } from '@renderer/components/ui/Button'
import { useToast } from '@renderer/hooks/useToast'
import { invoke } from '@renderer/services/ipcClient'
import { registerPageRefresh } from '@renderer/services/refreshRegistry'

/**
 * When each platform's master import runs.
 *
 * Per platform, not per company. An operator running four marketplaces has four
 * report APIs to be polite to, and stacking every import on the same minute is
 * how one night's run becomes four simultaneous browser sessions competing for
 * the same machine.
 *
 * Only platforms that HAVE a master import appear — four of the eight. A time
 * box for Flipkart would be a control wired to nothing.
 *
 * The time is a COMPANY setting: it applies to every machine that runs this
 * company's imports, not just this one. Said plainly on the card, because a
 * per-installation Settings page is exactly where someone would assume
 * otherwise.
 */

export const ImportScheduleSettings = (): React.JSX.Element => {
  const toast = useToast()
  const [state, setState] = useState<ImportScheduleState | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  // Labels come over IPC: @trackvid/automation-core is CommonJS and
  // main-process only, so the renderer cannot import the platform registry.
  const [labels, setLabels] = useState<Record<string, string>>({})

  const labelFor = useCallback(
    (platform: string): string => labels[platform] ?? platform,
    [labels]
  )

  const load = useCallback(async () => {
    const response = await invoke<ImportScheduleState>(IMPORT_SCHEDULE_CHANNELS.state)

    if (!response.success) return

    setState(response.data)
    setDrafts(
      Object.fromEntries(
        Object.entries(response.data.syncTimes).map(([platform, time]) => [platform, time ?? ''])
      )
    )
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const [response, platformList] = await Promise.all([
        invoke<ImportScheduleState>(IMPORT_SCHEDULE_CHANNELS.state),
        invoke<PlatformDescriptor[]>(PLATFORM_SESSION_CHANNELS.list)
      ])

      if (cancelled) return

      if (platformList.success) {
        setLabels(Object.fromEntries(platformList.data.map((p) => [p.key, p.label])))
      }
      if (!response.success) return
      setState(response.data)
      setDrafts(
        Object.fromEntries(
          Object.entries(response.data.syncTimes).map(([platform, time]) => [platform, time ?? ''])
        )
      )
    })()

    const unregister = registerPageRefresh(load)

    return () => {
      cancelled = true
      unregister()
    }
  }, [load])

  const save = useCallback(
    async (platform: string) => {
      setSaving(platform)

      const response = await invoke<ImportScheduleState>(
        IMPORT_SCHEDULE_CHANNELS.setPlatformTime,
        // An empty box means "no schedule", not "midnight" — sent as null so
        // the server turns the schedule off rather than storing 00:00.
        { platform, syncTime: drafts[platform]?.trim() || null }
      )

      setSaving(null)

      if (!response.success) {
        toast.error(response.error.message)

        return
      }

      setState(response.data)
      toast.success(
        drafts[platform]?.trim()
          ? `${labelFor(platform)} will import at ${drafts[platform]} IST`
          : `${labelFor(platform)} import schedule turned off`
      )
    },
    [drafts, labelFor, toast]
  )

  const platforms = state?.schedulablePlatforms ?? []

  return (
    <section className="overflow-hidden rounded-lg bg-surface ring-1 ring-subtle">
      <header className="border-b border-hairline px-6 py-4">
        <h2 className="text-sm font-semibold text-textPrimary">Master import schedule</h2>
        <p className="mt-0.5 text-sm text-muted">
          When each platform pulls its master data, in IST. This is a company setting and applies to
          every machine that runs these imports — not only this one. Leave a time empty to turn that
          platform&rsquo;s schedule off.
        </p>
      </header>

      {platforms.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-faint">
          No platform on this company has a master import.
        </p>
      ) : (
        <ul className="divide-y divide-hairline px-6">
          {platforms.map((platform) => {
            const label = labelFor(platform)
            const stored = state?.syncTimes[platform] ?? null
            const draft = drafts[platform] ?? ''
            const dirty = (stored ?? '') !== draft

            return (
              <li key={platform} className="flex items-center gap-3 py-3">
                <span className="w-28 text-sm font-medium text-textPrimary">{label}</span>

                <input
                  type="time"
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [platform]: event.target.value }))
                  }
                  className="h-9 rounded-md border border-strong bg-surface px-2 text-sm text-textPrimary"
                  aria-label={`${label} master import time`}
                />

                <span className="text-xs text-faint">
                  {stored ? `currently ${stored} IST` : 'no schedule'}
                </span>

                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  // Disabled until something changes: a Save that does nothing
                  // still costs a round trip and still shows a success toast.
                  disabled={!dirty}
                  loading={saving === platform}
                  onClick={() => void save(platform)}
                >
                  Save
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
