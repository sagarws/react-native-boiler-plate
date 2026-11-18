import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { SnapdealCoverage, SnapdealRecord } from '@shared/types/snapdealBackup'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { Select } from '@renderer/components/ui/Select'
import { useToast } from '@renderer/hooks/useToast'
import {
  searchSnapdealBackup,
  snapdealCoverage,
  snapdealMonth
} from '@renderer/services/snapdealBackup.service'
import { CALENDAR_MONTHS } from './snapdealCalendar'

/**
 * The stored Snapdeal returns, month by month.
 *
 * FOUR COLUMNS, WHICH IS THE WHOLE RECORD. Snapdeal's report is 41 columns
 * wide and most of it is product copy and image URLs; what gets kept is the
 * sub-order, the forward AWB, the reverse AWB and the SKU — the four blanks a
 * scanned claim arrives without. A viewer that implied there were more would
 * be promising something the store does not hold.
 *
 * OPENING A MONTH CAN FETCH. The main process collects first when the month is
 * empty and a report covering it is still outstanding, which is what makes
 * "View data" the natural thing to press after "Request" — see
 * `snapdealMonth`. It takes as long as a download, so it says so while it runs.
 */

interface Props {
  open: boolean
  onClose: () => void
}

export const SnapdealViewerModal = ({ open, onClose }: Props) => {
  const toast = useToast()
  const [coverage, setCoverage] = useState<SnapdealCoverage | null>(null)
  const [picked, setPicked] = useState('')
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<SnapdealRecord[] | null>(null)
  /**
   * The month that has actually been READ, with what reading it produced.
   *
   * One piece of state rather than three, and set only after the await — which
   * is what keeps "loading" honest. A separate `setLoading(true)` before the
   * call would be a synchronous setState inside an effect, and it would also
   * be a second source of truth: the two drifted the moment a response arrived
   * for a month the operator had already clicked away from.
   */
  const [loaded, setLoaded] = useState<{
    key: string
    rows: SnapdealRecord[]
    fetched: boolean
  } | null>(null)

  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    void snapdealCoverage().then(response => {
      if (cancelled || !response.success) return

      setCoverage(response.data)

      // The newest month held, because that is the one somebody opening this
      // has just been working on.
      const first = response.data.months[0]

      if (first && !picked) setPicked(`${first.year}-${first.month}`)
    })

    return () => {
      cancelled = true
    }
    // `picked` is deliberately not a dependency: it is seeded here once and
    // then owned by the select.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !picked) return undefined

    let cancelled = false
    const [year, month] = picked.split('-').map(Number)

    if (!year || !month) return undefined

    void snapdealMonth({ year, month }).then(response => {
      if (cancelled) return

      if (!response.success) {
        toast.error(response.error.message)
        // Recorded as read with nothing in it, so the dialog stops saying
        // "Reading…" over a month that will never answer.
        setLoaded({ key: picked, rows: [], fetched: false })

        return
      }

      setLoaded({ key: picked, rows: response.data.rows, fetched: response.data.fetched })

      // Worth saying: the dialog went and downloaded before it could answer,
      // and silence over several seconds reads as a hang.
      if (response.data.fetched) {
        toast.success(
          response.data.rows.length > 0
            ? `Collected ${response.data.rows.length.toLocaleString()} row(s) for this month`
            : 'Snapdeal has not finished building the report for this month yet'
        )
      }
    })

    return () => {
      cancelled = true
    }
  }, [open, picked, toast])

  const search = async (): Promise<void> => {
    if (term.trim().length < 3) {
      setHits(null)

      return
    }

    const response = await searchSnapdealBackup(term.trim())

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setHits(response.data.hits)
  }

  // Derived, never stored: the rows on screen belong to the month that was
  // read, and a stale list under a newly-picked month is exactly the bug the
  // single `loaded` record above exists to prevent.
  const current = loaded?.key === picked ? loaded : null
  const rows = current?.rows ?? []
  const loading = picked !== '' && current === null
  const fetching = current?.fetched === true
  const shown = hits ?? rows

  const monthOptions = useMemo(
    () =>
      (coverage?.months ?? []).map(month => ({
        value: `${month.year}-${month.month}`,
        label: `${CALENDAR_MONTHS[month.month - 1]} ${month.year} · ${month.rows.toLocaleString()} rows`
      })),
    [coverage]
  )

  return (
    <Modal
      open={open}
      size="lg"
      title="Snapdeal backup · stored returns"
      description="The sub-order, both AWBs and the SKU, as Snapdeal served them."
      onClose={onClose}
      headerActions={
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-md p-1.5 text-faint ring-1 ring-subtle hover:bg-surface-active hover:text-textSecondary"
        >
          <X size={16} />
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Month"
            size="sm"
            className="w-64"
            value={picked}
            onChange={event => {
              setPicked(event.target.value)
              setHits(null)
              setTerm('')
            }}
            options={
              monthOptions.length > 0
                ? monthOptions
                : [{ value: '', label: 'Nothing held yet' }]
            }
          />

          <div className="flex items-center gap-2">
            <Input
              aria-label="Search"
              size="sm"
              className="w-72"
              placeholder="Sub-order, AWB or SKU — across every month"
              value={term}
              onChange={event => setTerm(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') void search()
              }}
            />
            <button
              type="button"
              aria-label="Search"
              className="rounded-md p-1.5 text-faint ring-1 ring-subtle hover:bg-surface-active hover:text-textSecondary"
              onClick={() => void search()}
            >
              <Search size={14} />
            </button>
          </div>

          <p className="ms-auto text-xs text-muted">
            {loading
              ? 'Reading…'
              : hits
                ? `${hits.length.toLocaleString()} match(es)`
                : `${rows.length.toLocaleString()} row(s)`}
          </p>
        </div>

        {fetching && !loading && rows.length === 0 && (
          <p className="rounded-md bg-warning-surface px-3 py-2 text-xs text-warning-fg ring-1 ring-warning-border">
            Snapdeal has not finished building the report for this month. The scheduled pass will
            collect it, or press Collect now in a few minutes.
          </p>
        )}

        <div className="max-h-96 overflow-auto rounded-md ring-1 ring-subtle">
          <table className="w-full text-left text-2xs">
            <thead className="sticky top-0 bg-surface-sunken text-faint">
              <tr>
                <th className="px-2 py-1.5 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Sub-order</th>
                <th className="px-2 py-1.5 font-medium">Forward AWB</th>
                <th className="px-2 py-1.5 font-medium">Reverse AWB</th>
                <th className="px-2 py-1.5 font-medium">SKU</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 1000).map(record => (
                <tr key={record.key} className="border-t border-subtle">
                  <td className="px-2 py-1.5 tabular-nums text-muted">{record.date}</td>
                  <td className="px-2 py-1.5 tabular-nums text-textSecondary">
                    {record.subOrderCode}
                  </td>
                  {/* An empty forward AWB is a fact, not a blank cell:
                      Snapdeal serves "NA" until the forward leg settles, and
                      the row is re-read later to fill it in. */}
                  <td className="px-2 py-1.5 tabular-nums text-textSecondary">
                    {record.awb || <span className="text-faint">not yet served</span>}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-textSecondary">
                    {record.reverseAwb || '—'}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-textSecondary">
                    {record.sku || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {shown.length > 1000 && (
          <p className="text-2xs text-muted">
            Showing the first 1,000 of {shown.length.toLocaleString()}.
          </p>
        )}
      </div>
    </Modal>
  )
}
