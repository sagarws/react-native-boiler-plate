import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { FlipkartCoverage, FlipkartRecord, FlipkartReport } from '@shared/types/flipkartBackup'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { Select } from '@renderer/components/ui/Select'
import { useToast } from '@renderer/hooks/useToast'
import {
  flipkartCoverage,
  flipkartMonth,
  searchFlipkartBackup
} from '@renderer/services/flipkartBackup.service'
import { CALENDAR_MONTHS } from './snapdealCalendar'

/**
 * The stored rows of one Flipkart report, month by month — the Snapdeal viewer.
 *
 * FOUR FACTS, WHICH IS THE WHOLE RECORD: the order item id, the SKU, the AWB
 * (forward on Orders, return on Returns) and the date. Everything else in
 * Flipkart's file is left in the file.
 *
 * OPENING A MONTH CAN FETCH, as on Snapdeal: when the month is empty and a
 * request covering it is still outstanding, the main process collects first.
 */

interface Props {
  open: boolean
  report: FlipkartReport
  onClose: () => void
}

const REPORT_NAME: Record<FlipkartReport, string> = { forward: 'Orders', return: 'Returns' }

export const FlipkartViewerModal = ({ open, report, onClose }: Props) => {
  const toast = useToast()
  const [coverage, setCoverage] = useState<FlipkartCoverage | null>(null)
  const [picked, setPicked] = useState('')
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<FlipkartRecord[] | null>(null)
  /**
   * The month that has actually been READ, with what reading it produced —
   * one piece of state, set only after the await, as in the Snapdeal viewer.
   */
  const [loaded, setLoaded] = useState<{
    key: string
    rows: FlipkartRecord[]
    fetched: boolean
  } | null>(null)

  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    void flipkartCoverage(report).then(response => {
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
  }, [open, report])

  useEffect(() => {
    if (!open || !picked) return undefined

    let cancelled = false
    const [year, month] = picked.split('-').map(Number)

    if (!year || !month) return undefined

    void flipkartMonth({ year, month, report }).then(response => {
      if (cancelled) return

      if (!response.success) {
        toast.error(response.error.message)
        setLoaded({ key: picked, rows: [], fetched: false })

        return
      }

      setLoaded({ key: picked, rows: response.data.rows, fetched: response.data.fetched })

      if (response.data.fetched) {
        toast.success(
          response.data.rows.length > 0
            ? `Collected ${response.data.rows.length.toLocaleString()} row(s) for this month`
            : 'Flipkart has not finished building the report for this month yet'
        )
      }
    })

    return () => {
      cancelled = true
    }
  }, [open, picked, report, toast])

  const search = async (): Promise<void> => {
    if (term.trim().length < 3) {
      setHits(null)

      return
    }

    const response = await searchFlipkartBackup(report, term.trim())

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    setHits(response.data.hits)
  }

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
      title={`Flipkart backup · stored ${REPORT_NAME[report]}`}
      description="The order item, the SKU and the AWB, as Flipkart served them."
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
            options={monthOptions.length > 0 ? monthOptions : [{ value: '', label: 'Nothing held yet' }]}
          />

          <div className="flex items-center gap-2">
            <Input
              aria-label="Search"
              size="sm"
              className="w-72"
              placeholder="Order item, AWB or SKU — across every month"
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
            Flipkart has not finished building the report for this month. The scheduled pass will
            collect it, or press Collect now in a few minutes.
          </p>
        )}

        <div className="max-h-96 overflow-auto rounded-md ring-1 ring-subtle">
          <table className="w-full text-left text-2xs">
            <thead className="sticky top-0 bg-surface-sunken text-faint">
              <tr>
                <th className="px-2 py-1.5 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Order item</th>
                <th className="px-2 py-1.5 font-medium">{report === 'forward' ? 'Forward AWB' : 'Return AWB'}</th>
                <th className="px-2 py-1.5 font-medium">SKU</th>
                <th className="px-2 py-1.5 font-medium">Account</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 1000).map(record => (
                <tr key={record.key} className="border-t border-subtle">
                  <td className="px-2 py-1.5 tabular-nums text-muted">{record.date}</td>
                  <td className="px-2 py-1.5 tabular-nums text-textSecondary">{record.orderItemId}</td>
                  {/* An empty AWB is a fact, not a blank cell: a return is
                      listed before its pickup has a tracking id, and the row is
                      re-read later to fill it in. */}
                  <td className="px-2 py-1.5 tabular-nums text-textSecondary">
                    {record.awb || <span className="text-faint">not yet served</span>}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-textSecondary">{record.sku || '—'}</td>
                  <td className="px-2 py-1.5 text-textSecondary">{record.username}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {shown.length > 1000 && (
          <p className="text-2xs text-muted">Showing the first 1,000 of {shown.length.toLocaleString()}.</p>
        )}
      </div>
    </Modal>
  )
}
