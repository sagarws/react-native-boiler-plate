import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ListItemButton from '@mui/material/ListItemButton'
import MenuItem from '@mui/material/MenuItem'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import CustomTextField from '@core/components/mui/TextField'
import { classNames } from '@renderer/utils/format'

/**
 * The admin panel's date filter, rebuilt on this app's stack.
 *
 * `/TrackVid-FE` renders `react-date-range` inside a MUI `Menu`
 * (`components/common/DatePickerDropdown.tsx`): a trigger reading
 * `dd/MM/yyyy - dd/MM/yyyy`, a preset rail down the left, and a month grid on
 * the right. Two pairs of native `input[type=date]` boxes were never the same
 * control — an operator comparing the two screens had to translate.
 *
 * Rebuilt rather than ported because the guidelines forbid a second UI
 * framework here and `react-date-range` brings MUI and `date-fns` with it. The
 * behaviour that matters is small enough to own: seven presets, a range the
 * user drags out in two clicks, and the same floor and ceiling the panel uses.
 *
 * Values cross the boundary as `yyyy-MM-dd` strings in LOCAL time, which is
 * what the CMS list endpoint already takes — nothing downstream changes.
 */

/**
 * How far back "All Time" reaches, matching the panel's `minDate`
 * (`new Date(2024, 9, 25)` there). Nothing in TrackVid predates it, so a
 * calendar that scrolls to 1970 only offers empty results.
 */
const FLOOR = new Date(2024, 9, 25)

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
// All local-midnight, all derived rather than mutated in place. `date-fns` is
// not a dependency of this app and one calendar does not justify adding one.

const atMidnight = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

const today = (): Date => atMidnight(new Date())

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)

const addMonths = (date: Date, months: number): Date =>
  new Date(date.getFullYear(), date.getMonth() + months, 1)

/** Week starts Sunday, matching the panel's `en-US` locale. */
const startOfWeek = (date: Date): Date => addDays(date, -date.getDay())

const endOfWeek = (date: Date): Date => addDays(startOfWeek(date), 6)

const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1)

const endOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth() + 1, 0)

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const clamp = (date: Date, min: Date, max: Date): Date =>
  date < min ? min : date > max ? max : date

/** `yyyy-MM-dd` in LOCAL time. `toISOString()` would shift the day west of UTC. */
const toIso = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`

/** Parses `yyyy-MM-dd` as a LOCAL date; `new Date(iso)` would read it as UTC. */
const fromIso = (iso: string): Date | null => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)

  if (!parts) return null

  const [, year, month, day] = parts
  const date = new Date(Number(year), Number(month) - 1, Number(day))

  return Number.isNaN(date.getTime()) ? null : date
}

/** `31/08/2026`, the format the panel's trigger uses. */
const asTrigger = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`

/** `Aug 31, 2026`, the format the panel's two range boxes use. */
const asBox = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    date
  )

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface Preset {
  label: string
  range: (max: Date) => { start: Date; end: Date }
}

export type { Preset as DateRangePreset }

/**
 * `react-date-range`'s `defaultStaticRanges` plus the panel's own "All Time",
 * in its order.
 *
 * Every preset is clamped to `max` on the way out: the grid refuses future
 * days, so "This Week" on a Tuesday must not hand back a Saturday the operator
 * cannot then see selected.
 */
const PRESETS: readonly Preset[] = [
  { label: 'Today', range: max => ({ start: max, end: max }) },
  {
    label: 'Yesterday',
    range: max => ({ start: addDays(max, -1), end: addDays(max, -1) })
  },
  { label: 'This Week', range: max => ({ start: startOfWeek(max), end: endOfWeek(max) }) },
  {
    label: 'Last Week',
    range: max => ({ start: startOfWeek(addDays(max, -7)), end: endOfWeek(addDays(max, -7)) })
  },
  { label: 'This Month', range: max => ({ start: startOfMonth(max), end: endOfMonth(max) }) },
  {
    label: 'Last Month',
    range: max => ({
      start: startOfMonth(addMonths(max, -1)),
      end: endOfMonth(addMonths(max, -1))
    })
  },
  { label: 'All Time', range: max => ({ start: FLOOR, end: max }) }
]

/**
 * Rolling windows, for a screen that reads a marketplace by date rather than by
 * calendar period.
 *
 * The default set mirrors the admin panel so the two screens agree — that
 * parity is the reason it exists and it is not changed here. This set answers a
 * different question: AJIO's reports are queried over "the last N days", and a
 * "This Week" that means Sunday-to-Saturday is the wrong shape for it.
 *
 * "Last N days" INCLUDES today, which is how it is read aloud and how the
 * claims list already defaults (`isoDaysAgo(6)` → a seven-day window).
 */
const lastDays = (days: number): Preset => ({
  label: `Last ${days} days`,
  range: max => ({ start: addDays(max, -(days - 1)), end: max })
})

export const ROLLING_PRESETS: readonly Preset[] = [
  { label: 'Today', range: max => ({ start: max, end: max }) },
  {
    label: 'Yesterday',
    range: max => ({ start: addDays(max, -1), end: addDays(max, -1) })
  },
  lastDays(2),
  lastDays(7),
  lastDays(31),
  {
    label: 'Last Month',
    range: max => ({
      start: startOfMonth(addMonths(max, -1)),
      end: endOfMonth(addMonths(max, -1))
    })
  },
  { label: 'This Month', range: max => ({ start: startOfMonth(max), end: endOfMonth(max) }) }
]

/** The six-week grid a month is drawn on, Sunday-first. */
const monthGrid = (month: Date): Date[] => {
  const first = startOfWeek(startOfMonth(month))

  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}

export interface DateRange {
  /** `yyyy-MM-dd` */
  startDate: string
  /** `yyyy-MM-dd` */
  endDate: string
}

export interface DateRangePickerProps {
  value: DateRange
  onChange: (range: DateRange) => void
  /** Latest selectable day. Defaults to today, as the panel does. */
  maxDate?: Date
  /**
   * The preset rail down the left.
   *
   * Defaults to the admin panel's set, which is the parity this control exists
   * for. `ROLLING_PRESETS` is the alternative, for a screen that asks for the
   * last N days rather than for a calendar period.
   */
  presets?: readonly Preset[]
  /** Earliest selectable day. Defaults to the panel's floor. */
  minDate?: Date
  className?: string
  /**
   * Which edge the panel is anchored to. Default `right`, which is correct for
   * a trigger sitting on the right of a toolbar.
   *
   * `left` is for a trigger near the LEFT edge of its container: anchored right
   * the panel extends leftwards and runs off the edge, which inside a dialog
   * means it is simply cut in half.
   */
  align?: 'left' | 'right'
  /**
   * The trigger's height. `sm` matches the small inputs and buttons it sits
   * between in a toolbar; the default keeps the old 40px box.
   */
  size?: 'sm' | 'md'
}

export const DateRangePicker = ({
  value,
  onChange,
  maxDate,
  minDate,
  className,
  align = 'right',
  size = 'md',
  presets = PRESETS
}: DateRangePickerProps) => {
  const [open, setOpen] = useState(false)
  // State, not a ref: the Popover reads its anchor during render.
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)

  const max = maxDate ?? today()
  const min = minDate ?? FLOOR

  // A malformed or missing value must not blank the calendar — fall back to the
  // bounds rather than rendering "Invalid Date" in the trigger.
  const start = fromIso(value.startDate) ?? min
  const end = fromIso(value.endDate) ?? max

  /**
   * Which end the next click sets. `null` means "start a new range"; after the
   * first click it holds the anchor until the second click closes the range —
   * the two-click drag `react-date-range` does.
   */
  const [anchor, setAnchor] = useState<Date | null>(null)

  // Which month the grid shows. Opening on the start of the range is what makes
  // "Last Month" land somewhere visible instead of leaving the operator on a
  // grid with nothing highlighted.
  const [visible, setVisible] = useState<Date>(() => startOfMonth(start))

  /*
   * Dismissal — click-away and Escape — is the Popover's, which also removes
   * its own listeners on close. The hand-written document listeners this
   * replaced did the same job for a panel that could not escape its container.
   */
  const close = (): void => {
    setOpen(false)
    setAnchor(null)
  }

  /**
   * Opening resets the grid to where the current range starts, so "Last Month"
   * chosen yesterday does not reopen on a month with nothing highlighted.
   *
   * Done here rather than in an effect on purpose: an effect that re-seeds on
   * every render of an open panel would yank the grid back mid-drag, and one
   * keyed only on `open` is a cascading render the linter rightly rejects.
   */
  const toggle = (): void => {
    if (!open) {
      setVisible(startOfMonth(start))
      setAnchor(null)
    }
    setOpen(current => !current)
  }

  const days = useMemo(() => monthGrid(visible), [visible])

  const years = useMemo(() => {
    const first = min.getFullYear()

    return Array.from({ length: max.getFullYear() - first + 1 }, (_, index) => first + index)
  }, [min, max])

  const emit = (nextStart: Date, nextEnd: Date): void =>
    onChange({ startDate: toIso(nextStart), endDate: toIso(nextEnd) })

  const pick = (day: Date): void => {
    if (day < min || day > max) return

    if (anchor === null) {
      // First click collapses the range onto the clicked day, so the grid shows
      // where the drag began rather than keeping a stale highlight.
      setAnchor(day)
      emit(day, day)

      return
    }

    // Clicking before the anchor reads as "I meant to start here", not as an
    // empty range — order the two ends rather than rejecting the click.
    emit(day < anchor ? day : anchor, day < anchor ? anchor : day)
    // The range is complete, so the question the panel asked is answered.
    // Leaving it open made the operator click away to see the result.
    close()
  }

  const applyPreset = (preset: Preset): void => {
    const { start: presetStart, end: presetEnd } = preset.range(max)
    const nextStart = clamp(presetStart, min, max)
    const nextEnd = clamp(presetEnd, min, max)

    setVisible(startOfMonth(nextStart))
    emit(nextStart, nextEnd)
    close()
  }

  const isActivePreset = (preset: Preset): boolean => {
    const { start: presetStart, end: presetEnd } = preset.range(max)

    return (
      isSameDay(clamp(presetStart, min, max), start) && isSameDay(clamp(presetEnd, min, max), end)
    )
  }

  const step = (months: number): void => setVisible(current => addMonths(current, months))

  return (
    <div className={className}>
      {/* The same secondary button every toolbar here uses — a hairline box
          with 13px text — so the dates sit level with the search field and
          the actions beside them instead of being the one taller control. */}
      <Button
        ref={setTrigger}
        variant='tonal'
        color='secondary'
        size={size === 'sm' ? 'small' : 'medium'}
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-label='Date range'
        onClick={toggle}
        startIcon={<i className='tabler-calendar' />}
        endIcon={<i className={classNames('tabler-chevron-down text-base transition-transform', open && 'rotate-180')} />}
        className='whitespace-nowrap tabular-nums'
      >
        {asTrigger(start)} – {asTrigger(end)}
      </Button>

      {/*
        A POPOVER, NOT A POSITIONED DIV.

        The panel used to be `position: absolute` inside the trigger's wrapper,
        so it lived inside whatever held the trigger — and on Manage Claims that
        is a MUI Card, which clips its content. The calendar opened as a sliver
        with its bottom half cut off. A Popover renders in a portal on the
        document's root, so no card, dialog or scrolling table can clip it, and
        MUI keeps it inside the window when there is no room below.
      */}
      <Popover
        open={open}
        anchorEl={trigger}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: align === 'left' ? 'left' : 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: align === 'left' ? 'left' : 'right' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': 'Choose a date range',
            className: 'mbs-1 flex overflow-hidden'
          }
        }}
      >
        {/* Presets: the quick answers, one click each. */}
        <Box component='ul' className='m-0 flex w-40 shrink-0 list-none flex-col gap-0.5 p-2'>
          {presets.map(preset => {
            const active = isActivePreset(preset)

            return (
              <li key={preset.label}>
                <ListItemButton
                  selected={active}
                  onClick={() => applyPreset(preset)}
                  className='min-h-8 pli-3 py-1.5'
                >
                  <Typography variant='body2' className={active ? 'font-medium' : undefined}>
                    {preset.label}
                  </Typography>
                </ListItemButton>
              </li>
            )
          })}
        </Box>

        <Divider orientation='vertical' flexItem />

        <div className='flex w-80 shrink-0 flex-col gap-3 p-3'>
          {/* The two ends. The one the next click will set is outlined in ink,
              so a half-finished range is visible. */}
          <div className='flex gap-2'>
            {[
              { label: 'Start', date: start, next: anchor === null },
              { label: 'End', date: end, next: anchor !== null }
            ].map(box => (
              <Box
                key={box.label}
                className='flex flex-1 flex-col rounded-md px-2.5 py-1.5'
                sx={{
                  border: '1px solid',
                  borderColor: box.next ? 'text.primary' : 'divider',
                  bgcolor: box.next ? 'action.selected' : 'transparent'
                }}
              >
                <Typography variant='caption' color='text.secondary'>
                  {box.label}
                </Typography>
                <Typography variant='body2' className='font-medium tabular-nums'>
                  {asBox(box.date)}
                </Typography>
              </Box>
            ))}
          </div>

          <div className='flex items-center gap-1'>
            <IconButton
              size='small'
              aria-label='Previous month'
              disabled={startOfMonth(visible) <= startOfMonth(min)}
              onClick={() => step(-1)}
            >
              <i className='tabler-chevron-left text-lg' />
            </IconButton>

            <CustomTextField
              select
              size='small'
              value={visible.getMonth()}
              onChange={event =>
                setVisible(current => new Date(current.getFullYear(), Number(event.target.value), 1))
              }
              className='min-w-0 flex-1'
              slotProps={{ select: { SelectDisplayProps: { 'aria-label': 'Month' } } }}
            >
              {MONTHS.map((month, index) => (
                <MenuItem key={month} value={index}>
                  {month}
                </MenuItem>
              ))}
            </CustomTextField>

            <CustomTextField
              select
              size='small'
              value={visible.getFullYear()}
              onChange={event =>
                setVisible(current => new Date(Number(event.target.value), current.getMonth(), 1))
              }
              className='w-24 shrink-0'
              slotProps={{ select: { SelectDisplayProps: { 'aria-label': 'Year' } } }}
            >
              {years.map(year => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </CustomTextField>

            <IconButton
              size='small'
              aria-label='Next month'
              disabled={startOfMonth(visible) >= startOfMonth(max)}
              onClick={() => step(1)}
            >
              <i className='tabler-chevron-right text-lg' />
            </IconButton>
          </div>

          <div>
            <div className='grid grid-cols-7 text-center'>
              {WEEKDAYS.map(day => (
                <Typography key={day} variant='caption' color='text.disabled' className='plb-1'>
                  {day}
                </Typography>
              ))}
            </div>

            <div className='grid grid-cols-7'>
              {days.map(day => {
                const outside = day.getMonth() !== visible.getMonth()
                const disabled = day < min || day > max
                const isStart = isSameDay(day, start)
                const isEnd = isSameDay(day, end)
                const isEndpoint = isStart || isEnd
                const inRange = day > start && day < end
                const isToday = isSameDay(day, today())

                return (
                  /*
                    The band is on the cell and the endpoints are the disc in
                    it, so a range reads as one continuous stripe with a
                    filled dot at each end.
                  */
                  <Box
                    key={day.getTime()}
                    className={classNames(
                      'flex justify-center',
                      isStart && 'rounded-s-full',
                      isEnd && 'rounded-e-full'
                    )}
                    sx={{
                      bgcolor:
                        (inRange || (isStart && !isEnd) || (isEnd && !isStart)) && !disabled
                          ? 'action.hover'
                          : undefined
                    }}
                  >
                    <ButtonBase
                      disabled={disabled}
                      aria-label={asBox(day)}
                      aria-current={isEndpoint ? 'date' : undefined}
                      onClick={() => pick(day)}
                      className='h-8 w-8 rounded-full tabular-nums'
                      sx={{
                        typography: 'body2',
                        fontWeight: isEndpoint ? 600 : 400,
                        color: isEndpoint
                          ? 'primary.contrastText'
                          : disabled || outside
                            ? 'text.disabled'
                            : 'text.primary',
                        bgcolor: isEndpoint ? 'primary.main' : undefined,
                        // Today is ringed, so "Last 7 days" has a visible end.
                        boxShadow: isToday && !isEndpoint ? 'inset 0 0 0 1px var(--mui-palette-divider)' : undefined,
                        '&:hover': { bgcolor: isEndpoint ? 'primary.main' : 'action.selected' }
                      }}
                    >
                      {day.getDate()}
                    </ButtonBase>
                  </Box>
                )
              })}
            </div>
          </div>

          {/* What the next click does — the one thing about a two-click range
              that is not obvious from looking at it. */}
          <Typography variant='caption' color='text.secondary'>
            {anchor === null ? 'Click a day to start the range.' : 'Now click the last day of the range.'}
          </Typography>
        </div>
      </Popover>
    </div>
  )
}
