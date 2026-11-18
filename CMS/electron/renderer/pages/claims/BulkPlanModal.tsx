import { useMemo, useState } from 'react'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import tableStyles from '@core/styles/table.module.css'
import type { BulkSpfPlan, BulkSpfPlanRow } from '@shared/types/bulkSpf'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { classNames } from '@renderer/utils/format'
import { keysInRange, lastClaimableKeys, whole } from '@shared/utils/planSelection'
import { TruncatedText } from '@renderer/components/ui/TruncatedText'

/**
 * Selected Proceed: every row of the uploaded sheets, sorted, before anything is
 * filed.
 *
 * Claimable rows can be ticked and start ticked — the usual answer is "yes, file
 * these", and un-ticking a few is less work than ticking many. The rest cannot
 * be ticked and say why (no POB on any login here, already claimed, no POB ID),
 * which is what an operator reads to fix the sheet.
 *
 * Submit files ONLY the ticked rows. The main process reads the sheets again at
 * that moment, so a row that stopped being claimable in between is not filed.
 *
 * The parent remounts this with a fresh `key` for every plan, so the selection is
 * seeded once from that plan's claimable rows without an effect writing state.
 *
 * Rows are numbered, and a batch can be ticked by number — "22 to 45", or "the
 * last 30" — for filing a long sheet in parts. Claimable rows come first in the
 * plan, so numbers 1…N are exactly the rows that can be filed; a range that
 * reaches into the skipped rows below simply ticks nothing there.
 */

interface Props {
  open: boolean
  plan: BulkSpfPlan | null
  /** Submitting — the dialog cannot be closed underneath it. */
  busy: boolean
  onClose: () => void
  onSubmit: (selectedKeys: string[]) => void
}

const COUNT_LABELS: [keyof BulkSpfPlan['buckets'], string][] = [
  ['claimable', 'Claimable'],
  ['noAccount', 'POB not on any AJIO login here'],
  ['missingPob', 'No POB ID'],
  ['alreadyClaimed', 'Already claimed'],
  ['unknownType', 'Unknown claim type'],
  ['duplicate', 'Duplicate sheet row'],
  ['noReturnNumber', 'No return number']
]

export const BulkPlanModal = ({ open, plan, busy, onClose, onSubmit }: Props) => {
  const claimableKeys = useMemo(
    () => (plan?.rows ?? []).filter(row => row.claimable).map(row => row.key),
    [plan]
  )

  const [selected, setSelected] = useState<Set<string>>(() => new Set(claimableKeys))

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [last, setLast] = useState('')
  // What the last range pick did, in words — so "22 to 45" that ticked 18 rows
  // (the rest were skipped rows) says so instead of looking like it misfired.
  const [picked, setPicked] = useState<string | null>(null)

  const allSelected = claimableKeys.length > 0 && claimableKeys.every(key => selected.has(key))
  const someSelected = !allSelected && claimableKeys.some(key => selected.has(key))

  const toggle = (key: string): void => {
    // A hand-ticked box changes what the last range pick reported.
    setPicked(null)
    setSelected(current => {
      const next = new Set(current)

      if (next.has(key)) next.delete(key)
      else next.add(key)

      return next
    })
  }

  const ticked = (row: BulkSpfPlanRow): boolean => row.claimable && selected.has(row.key)


  const rows = plan?.rows ?? []
  const fromN = whole(from)
  const toN = whole(to)
  const lastN = whole(last)

  const pickRange = (): void => {
    if (fromN === null || toN === null) return

    const keys = keysInRange(rows, fromN, toN)

    setSelected(new Set(keys))
    setPicked(`Rows ${Math.min(fromN, toN)}–${Math.min(rows.length, Math.max(fromN, toN))}: ${keys.length} claimable selected`)
  }

  const pickLast = (): void => {
    if (lastN === null) return

    const keys = lastClaimableKeys(rows, lastN)

    setSelected(new Set(keys))
    setPicked(`Last ${keys.length} claimable selected`)
  }

  return (
    <Modal
      open={open}
      size="xl"
      fill
      title="Select claims to file"
      description={plan ? `${plan.rows.length} row${plan.rows.length === 1 ? '' : 's'} read from the sheets` : ''}
      onClose={onClose}
      busy={busy}
      toolbar={
        plan && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <form
              className="flex items-center gap-2"
              onSubmit={event => {
                event.preventDefault()
                pickRange()
              }}
            >
              <Typography variant="body2" color="text.secondary" component="span">
                Rows
              </Typography>
              <Input
                size="sm"
                className="w-16"
                inputMode="numeric"
                aria-label="From row number"
                placeholder="From"
                value={from}
                onChange={event => setFrom(event.target.value)}
              />
              <Typography variant="body2" color="text.secondary" component="span">
                to
              </Typography>
              <Input
                size="sm"
                className="w-16"
                inputMode="numeric"
                aria-label="To row number"
                placeholder="To"
                value={to}
                onChange={event => setTo(event.target.value)}
              />
              <Button size="sm" variant="secondary" type="submit" disabled={fromN === null || toN === null}>
                Select range
              </Button>
            </form>

            <form
              className="flex items-center gap-2"
              onSubmit={event => {
                event.preventDefault()
                pickLast()
              }}
            >
              <Typography variant="body2" color="text.secondary" component="span">
                Last
              </Typography>
              <Input
                size="sm"
                className="w-16"
                inputMode="numeric"
                aria-label="How many of the last claimable rows"
                placeholder="N"
                value={last}
                onChange={event => setLast(event.target.value)}
              />
              <Button size="sm" variant="secondary" type="submit" disabled={lastN === null}>
                Select last
              </Button>
            </form>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelected(new Set(claimableKeys))
                  setPicked(null)
                }}
              >
                All
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelected(new Set())
                  setPicked(null)
                }}
              >
                Clear
              </Button>
            </div>

            {picked && (
              <Typography variant="caption" color="text.secondary">
                {picked}
              </Typography>
            )}
          </div>
        )
      }
      footer={
        <>
          <Typography variant="caption" color="text.secondary" className="self-center">
            {selected.size} of {claimableKeys.length} claimable selected
          </Typography>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button size="sm" loading={busy} disabled={selected.size === 0} onClick={() => onSubmit([...selected])}>
            Submit ({selected.size})
          </Button>
        </>
      }
    >
      {plan && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {COUNT_LABELS.filter(([key]) => key === 'claimable' || plan.buckets[key] > 0).map(([key, label]) => (
              <Typography key={key} variant="caption" color="text.secondary">
                {label}:{' '}
                <span className={classNames('font-medium', key === 'claimable' ? 'text-success-fg' : 'text-textPrimary')}>
                  {plan.buckets[key]}
                </span>
              </Typography>
            ))}
          </div>

          {/* One element owns both scroll axes so the sticky header stays put — see Modal's `fill`. */}
          <Paper variant="outlined" className="min-h-80 flex-1 overflow-auto">
            <table className={tableStyles.table}>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-8">
                    <Checkbox
                      ariaLabel="Select every claimable row"
                      checked={allSelected}
                      indeterminate={someSelected}
                      disabled={claimableKeys.length === 0}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(claimableKeys))}
                    />
                  </th>
                  <th className="w-10 text-right">#</th>
                  {['Return AWB', 'SKU', 'Claim type', 'POB ID', 'AJIO login', 'Result'].map(label => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row, index) => (
                  <tr
                    // Skipped rows can share a key (a duplicate line in the sheet);
                    // the index keeps React's keys unique without changing Submit's.
                    key={`${row.key}::${index}`}
                    className={ticked(row) ? 'bg-actionSelected' : 'hover:bg-actionHover'}
                  >
                    <td>
                      <Checkbox
                        ariaLabel={`Select ${row.awb}${row.sku ? ` / ${row.sku}` : ''}`}
                        checked={ticked(row)}
                        disabled={!row.claimable}
                        onChange={() => toggle(row.key)}
                      />
                    </td>
                    <td className="text-right tabular-nums text-textDisabled">{index + 1}</td>
                    <td className="font-medium text-textPrimary">{row.awb || '—'}</td>
                    <td className="text-textPrimary">{row.sku || '—'}</td>
                    <td className="text-textPrimary">{row.claimType || '—'}</td>
                    <td className="text-textPrimary">{row.pobid || '—'}</td>
                    <td className="text-textPrimary">{row.account || '—'}</td>
                    <td className="max-w-96">
                      {row.claimable ? (
                        <Badge tone="success">Claimable</Badge>
                      ) : (
                        <TruncatedText text={row.reason} className="text-textSecondary" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Paper>
        </div>
      )}
    </Modal>
  )
}
