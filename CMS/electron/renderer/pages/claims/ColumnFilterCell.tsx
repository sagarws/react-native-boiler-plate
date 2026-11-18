import { useMemo, useState } from 'react'
import Badge from '@mui/material/Badge'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import type { CmsRow } from '@shared/types/cmsList'
import { columnValues, type ColumnFilter, type ColumnFilters } from '@shared/utils/columnFilter'
import { Button } from '@renderer/components/ui/Button'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { Input } from '@renderer/components/ui/Input'
import CustomTextField from '@core/components/mui/TextField'
import { Tooltip } from '@renderer/components/ui/Tooltip'

/**
 * One column's header filter: a search box, and beside it a button that opens
 * the column's values to tick — the spreadsheet kind.
 *
 * The list is built from the rows the OTHER columns let through, so it never
 * offers a value that would empty the table. Ticks apply as they are made;
 * there is no Apply step for a filter whose effect is visible behind it.
 */
/** The pages behind the value list — scrolling to its end asks for the next one. */
export interface MorePages {
  loadedPages: number
  totalPages: number
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
}

/** How close to the bottom of the list, in pixels, counts as "reached the end". */
const NEAR_END_PX = 24

export const ColumnFilterCell = ({
  field,
  label,
  rows,
  filters,
  onChange,
  more
}: {
  field: keyof CmsRow
  label: string
  rows: CmsRow[]
  filters: ColumnFilters
  onChange: (next: ColumnFilter) => void
  more?: MorePages
}) => {
  const filter = filters[field] ?? {}
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [find, setFind] = useState('')

  const values = useMemo(
    () => (anchor ? columnValues(rows, filters, field) : []),
    // Only while open: every column computing its list on every keystroke
    // anywhere in the table is work nobody is looking at.
    [anchor, rows, filters, field]
  )

  const listed = useMemo(() => {
    const needle = find.trim().toLowerCase()

    return needle ? values.filter(({ value }) => value.toLowerCase().includes(needle)) : values
  }, [values, find])

  const all = values.map(({ value }) => value)
  const ticked = new Set(filter.values ?? all)

  const setValues = (next: string[] | undefined) => onChange({ ...filter, values: next })

  const toggle = (value: string) => {
    const next = new Set(ticked)

    if (next.has(value)) next.delete(value)
    else next.add(value)

    // Everything ticked is no filter at all — stored as such, so the button
    // does not light up for a column that narrows nothing.
    setValues(next.size >= all.length ? undefined : [...next])
  }

  const narrowed = filter.values !== undefined

  return (
    <>
      {/* One field: the search, with the value filter as its end icon. */}
      <CustomTextField
        size='small'
        value={filter.search ?? ''}
        placeholder='Search'
        onChange={event => onChange({ ...filter, search: event.target.value })}
        sx={{ minInlineSize: 140 }}
        fullWidth
        slotProps={{
          htmlInput: { 'aria-label': `Search ${label}` },
          input: {
            endAdornment: (
              <InputAdornment position='end'>
                <Tooltip
                  label={
                    narrowed
                      ? `${label}: ${filter.values?.length ?? 0} value(s) picked`
                      : `Filter ${label} by value`
                  }
                >
                  <IconButton
                    size='small'
                    edge='end'
                    aria-label={`Filter ${label} by value`}
                    color={narrowed ? 'primary' : 'default'}
                    onClick={event => {
                      setFind('')
                      setAnchor(event.currentTarget)
                    }}
                  >
                    <Badge color='primary' variant='dot' invisible={!narrowed}>
                      <i className='tabler-filter text-base' />
                    </Badge>
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            )
          }
        }}
      />

      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <div className='flex flex-col gap-2 p-3' style={{ inlineSize: 280 }}>
          <Typography variant='subtitle2'>{label}</Typography>
          <Input
            size='sm'
            value={find}
            placeholder='Find a value'
            aria-label={`Find a ${label} value`}
            onChange={event => setFind(event.target.value)}
            style={{ inlineSize: '100%' }}
          />
          <div className='flex gap-2'>
            <Button size='sm' variant='secondary' onClick={() => setValues(undefined)}>
              Select all
            </Button>
            <Button size='sm' variant='secondary' onClick={() => setValues([])}>
              Clear
            </Button>
          </div>
          <div
            className='flex flex-col overflow-y-auto'
            style={{ maxBlockSize: 280 }}
            // Infinite scroll: the end of the list fetches the next page of
            // claims, and its values join the list.
            onScroll={event => {
              const list = event.currentTarget

              if (
                more?.hasMore &&
                !more.loading &&
                list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_END_PX
              ) {
                more.onLoadMore()
              }
            }}
          >
            {listed.length === 0 ? (
              <Typography variant='body2' color='text.secondary' className='plb-2'>
                No values
              </Typography>
            ) : (
              listed.map(({ value, count }) => (
                <div key={value} className='flex items-center justify-between gap-2'>
                  <Checkbox
                    checked={ticked.has(value)}
                    onChange={() => toggle(value)}
                    label={<span className='break-all'>{value}</span>}
                  />
                  <Typography variant='caption' color='text.secondary' className='tabular-nums'>
                    {count}
                  </Typography>
                </div>
              ))
            )}

            {/* The list's end: what is loaded, and a way on when a short list
                has nothing to scroll. */}
            {more && (
              <div className='flex items-center justify-between gap-2 pbs-2'>
                <Typography variant='caption' color='text.secondary'>
                  Page {more.loadedPages} of {more.totalPages} loaded
                </Typography>
                {more.loading ? (
                  <CircularProgress size={16} />
                ) : more.hasMore ? (
                  <Button size='sm' variant='secondary' onClick={more.onLoadMore}>
                    Load next page
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}
