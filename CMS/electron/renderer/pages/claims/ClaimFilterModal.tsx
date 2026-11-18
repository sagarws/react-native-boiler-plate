import { Fragment, useMemo, useState } from 'react'
import ButtonBase from '@mui/material/ButtonBase'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import type { CmsRow } from '@shared/types/cmsList'
import { Button } from '@renderer/components/ui/Button'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { classNames } from '@renderer/utils/format'
import {
  distinctValues,
  FILTER_FIELDS,
  hasEmptySelection,
  isFiltered,
  previewRows,
  toFilters,
  valueOf,
  type FilterField,
  type FilterSelection,
  type RowFilters
} from '@shared/utils/rowFilter'

/**
 * Filter the claims on screen by the values a column actually holds — the
 * spreadsheet gesture: pick a column, tick the values, apply.
 *
 * Two columns, because there are two questions behind a screen full of
 * failures: "what happened to THIS parcel" (Return AWB) and "how many of these
 * are the same failure" (Script Error). Values are listed with their counts and
 * ordered by count, so the failure worth acting on is at the top.
 *
 * THE ROWS ON THIS PAGE, and the dialog says so. It filters what was fetched;
 * it does not search the company. Pretending otherwise would have an operator
 * conclude a claim does not exist when it is simply on page 2.
 *
 * The parent remounts this per opening (`key`), so the working copy starts from
 * the applied filters without an effect syncing state.
 *
 * The working copy is a `FilterSelection`, not the applied `RowFilters`, for one
 * reason: it has to hold "nothing ticked". In the applied shape an empty list
 * means "not filtered", so unticking a column re-ticked it immediately and both
 * Clear buttons appeared to do nothing.
 */

interface Props {
  open: boolean
  rows: CmsRow[]
  filters: RowFilters
  onApply: (filters: RowFilters) => void
  onClose: () => void
}

export const ClaimFilterModal = ({ open, rows, filters, onApply, onClose }: Props) => {
  const [picked, setPicked] = useState<FilterSelection>(filters)
  const [field, setField] = useState<FilterField>(FILTER_FIELDS[0]?.field ?? 'returnAwb')
  const [search, setSearch] = useState('')

  // The values offered for a column are the ones still reachable under the
  // OTHER columns' selections — as a spreadsheet does it. Filtering by one
  // failure reason and then opening Return AWB should list those parcels, not
  // all of them.
  const others: FilterSelection = useMemo(() => {
    const rest = { ...picked }

    delete rest[field]

    return rest
  }, [picked, field])

  const values = useMemo(
    () => distinctValues(previewRows(rows, others), field),
    [rows, others, field]
  )

  // An untouched column is every value ticked; a touched one is exactly what
  // was ticked, including nothing.
  const selected = useMemo(() => {
    const picks = picked[field]

    return new Set(picks ?? values.map(entry => entry.value))
  }, [picked, field, values])

  const term = search.trim().toLowerCase()
  const shown = term ? values.filter(entry => entry.value.toLowerCase().includes(term)) : values

  const setSelected = (next: Set<string>): void => {
    setPicked(current => ({ ...current, [field]: [...next] }))
  }

  const toggle = (value: string): void => {
    const next = new Set(selected)

    if (next.has(value)) next.delete(value)
    else next.add(value)

    setSelected(next)
  }

  const allShownTicked = shown.length > 0 && shown.every(entry => selected.has(entry.value))

  const matched = useMemo(() => previewRows(rows, picked).length, [rows, picked])
  const nothingTicked = hasEmptySelection(picked)

  return (
    <Modal
      open={open}
      size="lg"
      fill
      title="Filter claims"
      description={`${rows.length} row${rows.length === 1 ? '' : 's'} on this page — filtering does not search the other pages`}
      onClose={onClose}
      footer={
        <>
          <Typography variant="caption" color="text.secondary" className="self-center">
            {matched} of {rows.length} row{rows.length === 1 ? '' : 's'} match
          </Typography>
          <div className="flex-1" />
          {/* Puts every column back to "all values" — distinct from the
              Clear beside the search, which unticks the column being edited. */}
          <Button size="sm" variant="ghost" onClick={() => setPicked({})}>
            Reset filters
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={nothingTicked} onClick={() => onApply(toFilters(picked, rows))}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Column picker. Each says whether it is narrowed, so an operator can
            see at a glance where a filter they forgot is hiding. */}
        <div className="flex w-56 shrink-0 flex-col gap-1">
          {FILTER_FIELDS.map(entry => (
            <ButtonBase
              key={entry.field}
              type="button"
              onClick={() => {
                setField(entry.field)
                setSearch('')
              }}
              className={classNames(
                'flex min-h-8 items-center justify-between gap-2 rounded pli-3 plb-1 text-start',
                entry.field === field ? 'bg-actionSelected' : 'hover:bg-actionHover'
              )}
            >
              <Typography
                variant="body2"
                color="text.primary"
                component="span"
                className={entry.field === field ? 'font-medium' : undefined}
              >
                {entry.label}
              </Typography>
              {picked[entry.field] !== undefined && (
                <Chip size="small" color="primary" label={picked[entry.field]?.length} />
              )}
            </ButtonBase>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              className="flex-1"
              placeholder="Search values…"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const next = new Set(selected)

                // Acts on what the search is showing, not on the whole column —
                // "select all" under a search that lists four values means those
                // four.
                for (const entry of shown) {
                  if (allShownTicked) next.delete(entry.value)
                  else next.add(entry.value)
                }

                setSelected(next)
              }}
            >
              {allShownTicked ? 'Untick' : 'Tick'} {term ? 'shown' : 'all'}
            </Button>
          </div>

          <Paper variant="outlined" className="min-h-72 flex-1 overflow-auto">
            {shown.length === 0 ? (
              <Typography variant="body2" color="text.secondary" className="p-6 text-center">
                No values match that search.
              </Typography>
            ) : (
              <ul className='m-0 list-none p-0'>
                {shown.map((entry, index) => (
                  <Fragment key={entry.value}>
                    {index > 0 && <Divider component="li" />}
                    <li>
                      <label className="flex cursor-pointer items-center gap-2 pli-3 hover:bg-actionHover">
                        <Checkbox
                          ariaLabel={entry.value}
                          checked={selected.has(entry.value)}
                          onChange={() => toggle(entry.value)}
                        />
                        <Typography
                          variant="body2"
                          component="span"
                          color={entry.value === '(blank)' ? 'text.disabled' : 'text.primary'}
                          className={classNames('min-w-0 flex-1 truncate', entry.value === '(blank)' && 'italic')}
                          title={entry.value}
                        >
                          {entry.value}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.disabled"
                          className="shrink-0 tabular-nums"
                        >
                          {entry.count}
                        </Typography>
                      </label>
                    </li>
                  </Fragment>
                ))}
              </ul>
            )}
          </Paper>

          {nothingTicked && (
            <Typography variant="caption" color="error.main" component="p">
              Nothing is ticked in this column — pick at least one value, or press Reset filters.
            </Typography>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Exported for the page's chips: the values currently narrowing each column. */
export const filterSummary = (filters: RowFilters, rows: CmsRow[]): string[] =>
  FILTER_FIELDS.filter(({ field }) => isFiltered(filters, field)).map(({ field, label }) => {
    const picked = filters[field] ?? []
    const total = new Set(rows.map(row => valueOf(row, field))).size

    return `${label}: ${picked.length} of ${total}`
  })
