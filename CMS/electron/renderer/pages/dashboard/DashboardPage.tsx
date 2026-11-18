// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Collapse from '@mui/material/Collapse'
import Divider from '@mui/material/Divider'
import MuiTooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { IconTile } from '@renderer/components/ui/IconTile'

// Third-party Imports
import classnames from 'classnames'

// Shared Imports
import { DASHBOARD_CHANNELS } from '@shared/constants/channels'
import type { DashboardSnapshot, PlatformSummary } from '@shared/types/dashboard'
import { HEALTH_LABEL, HEALTH_TONE, relativeTime } from '@shared/utils/sessionHealth'

// Component Imports
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { PlatformLogo } from '@renderer/components/ui/PlatformLogo'
import { EmptyState, LoadingState } from '@renderer/components/data/StateBlocks'

// Service Imports
import { invoke } from '@renderer/services/ipcClient'
import { registerPageRefresh } from '@renderer/services/refreshRegistry'

// Style Imports
import tableStyles from '@core/styles/table.module.css'

/**
 * The company at a glance: how its claims are doing, and what needs a person.
 *
 * REDESIGNED AROUND TWO QUESTIONS, in the order an operator asks them:
 *
 *   1. "How are we doing?"  — five headline figures, then every platform's
 *      outcome mix on ONE chart so they can be compared at a glance. The old
 *      screen gave each platform its own tall card, so comparing Myntra's
 *      rejection rate with Ajio's meant scrolling between them and doing the
 *      division in your head.
 *   2. "What needs me?"     — a short list of the things that are actually
 *      stuck (a login that stopped working, claims the automation could not
 *      file, stale master data), each one a click away from where it is fixed.
 *
 * The exact numbers are in the platform table at the bottom — the chart's
 * table view, so nothing is readable only by hovering.
 *
 * Every request, the refresh wiring and the partial-failure handling are what
 * they were; only the presentation changed.
 */

/**
 * The four outcomes every marketplace shares, in STACK ORDER.
 *
 * Approved · Pending · In review · Rejected: good at one end, bad at the
 * other, the work still moving in between — and, not by accident, the order in
 * which no two neighbours are hard to tell apart for a colour-blind reader
 * (red never touches amber or green). The colours are validated chart tokens
 * in styles/theme.css, not the theme's status mains — see the note there.
 *
 * Everything else a platform reports (Customer Replied, Un Attended, Awaiting
 * Seller Response…) is kept in its own words in the tooltip and the table, and
 * drawn as one neutral "Other" segment: inventing a shared meaning for those
 * would relabel states the operator recognises from the marketplace's screen.
 */
const OUTCOMES = [
  { key: 'Approved', label: 'Approved', colour: 'var(--chart-approved)' },
  { key: 'Pending', label: 'Pending', colour: 'var(--chart-pending)' },
  { key: 'In Review', label: 'In review', colour: 'var(--chart-review)' },
  { key: 'Rejected', label: 'Rejected', colour: 'var(--chart-rejected)' }
] as const

const OTHER_COLOUR = 'var(--mui-palette-action-selected)'

/** The one platform status that means "the automation could not file this". */
const FAILED = 'Failed to Proceed'

/** Master data older than this is flagged in "Needs attention". */
const STALE_MASTER_MS = 48 * 60 * 60 * 1000

const number = new Intl.NumberFormat('en-IN')

/** Rupees, whole, with Indian digit grouping: ₹1,23,456. */
const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
})

/**
 * A recovered amount, or a dash when it is UNKNOWN. `undefined` covers a
 * snapshot cached offline before the field existed; `null` a server that
 * predates it or a platform whose request failed. Neither is ₹0.
 */
const money = (value: number | null | undefined): string =>
  typeof value === 'number' ? rupees.format(value) : '—'

/** `29%`, `<1%` for a status that has something in it, `—` when there is no base. */
const percent = (part: number, whole: number): string => {
  if (whole <= 0) return '—'
  if (part <= 0) return '0%'

  const value = (part / whole) * 100

  return value < 1 ? '<1%' : `${Math.round(value)}%`
}

const count = (summary: PlatformSummary, key: string): number => summary.statusCounts[key] ?? 0

/**
 * Statuses that are an APPROVAL under another name.
 *
 * Myntra moves an approved claim on to "Paid" once the compensation is
 * settled, so it leaves "Approved" at the very moment it has most clearly
 * succeeded. Counted separately, every settled Myntra claim fell out of the
 * approval rate and the green segment — the better Myntra did, the worse it
 * looked. A settled claim is an approved one.
 */
const APPROVED_STATUSES = ['Approved', 'Paid'] as const

const approvedOf = (summary: PlatformSummary): number =>
  APPROVED_STATUSES.reduce((total, key) => total + count(summary, key), 0)

/** A platform's claims split into the four outcomes plus the rest. */
const breakdown = (summary: PlatformSummary) => {
  const named = OUTCOMES.map(outcome => ({
    ...outcome,
    value: outcome.key === 'Approved' ? approvedOf(summary) : count(summary, outcome.key)
  }))
  // Paid is folded into Approved above, so it must not also land in "Other".
  const namedKeys = new Set<string>([...OUTCOMES.map(outcome => outcome.key), ...APPROVED_STATUSES])
  const others = Object.entries(summary.statusCounts)
    .filter(([status, value]) => value > 0 && !namedKeys.has(status))
    .sort(([, a], [, b]) => b - a)

  return { named, others, other: others.reduce((sum, [, value]) => sum + value, 0) }
}

/** Approved out of everything the marketplace has DECIDED — pending claims have no verdict yet. */
const approvalRate = (approved: number, rejected: number): string => percent(approved, approved + rejected)

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

type Tone = 'neutral' | 'warning' | 'danger' | 'success'

/**
 * One headline figure: label, value, and the context that makes it a number
 * you can act on. Clickable when there is somewhere to go to act on it.
 *
 * Value in the sans at 24px with proportional figures — tabular figures make a
 * standalone number look loose; they are kept for the table, where digits
 * have to line up.
 */
const StatTile = ({
  label,
  value,
  detail,
  icon,
  tone = 'neutral',
  meter,
  onClick
}: {
  label: string
  value: string
  detail: string
  icon: string
  tone?: Tone
  /** 0–1, drawn as a thin meter under the value. */
  meter?: number | undefined
  onClick?: (() => void) | undefined
}) => {
  const body = (
    <div className='flex h-full flex-col gap-2 p-4'>
      <div className='flex items-center justify-between gap-2'>
        <Typography variant='body2' color='text.secondary'>
          {label}
        </Typography>
        {/* `.icon-tile` in the tone (Veylix). */}
        <IconTile icon={icon} tone={tone} />
      </div>
      {/* `.c-summary strong`: heavy and pulled tight. */}
      <Typography variant='h3' component='p' sx={{ fontWeight: 800, letterSpacing: '-0.6px' }}>
        {value}
      </Typography>
      {meter !== undefined && (
        /* The meter: fill in the tone, the track a wash of the same hue, so
           the share reads across the whole bar. */
        <Box
          role='presentation'
          className='h-1.5 overflow-hidden rounded-full'
          sx={{ bgcolor: 'action.hover' }}
        >
          <Box
            className='h-full rounded-full'
            sx={{ inlineSize: `${Math.max(0, Math.min(1, meter)) * 100}%`, bgcolor: 'var(--chart-approved)' }}
          />
        </Box>
      )}
      <Typography variant='caption' color='text.secondary' className='mt-auto'>
        {detail}
      </Typography>
    </div>
  )

  return (
    <Card className='h-full'>
      {onClick ? (
        <CardActionArea onClick={onClick} className='h-full'>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Outcome chart
// ---------------------------------------------------------------------------

/**
 * One platform's outcome mix as a 100% bar.
 *
 * 100%, not absolute: the question this chart answers is "which marketplace is
 * approving what it is sent", and on absolute bars a 16-claim platform is a
 * sliver whose mix nobody can read. The volume is the number at the end of the
 * row, and in the table.
 *
 * Segments are separated by a 2px gap in the surface colour rather than a
 * border, the ends are rounded, and every segment has a tooltip — which only
 * enhances: the same figures are in the table below.
 */
const OutcomeBar = ({ summary }: { summary: PlatformSummary }) => {
  const { named, others, other } = breakdown(summary)
  const segments = [
    ...named.map(outcome => ({
      key: outcome.key,
      label: outcome.label,
      value: outcome.value,
      colour: outcome.colour,
      // Says so when Approved is carrying settled claims, so the number can be
      // reconciled with the claim tabs, where Paid is its own tab.
      detail:
        outcome.key === 'Approved' && count(summary, 'Paid') > 0
          ? `includes ${number.format(count(summary, 'Paid'))} Paid`
          : (null as string | null)
    })),
    {
      key: 'other',
      label: 'Other',
      value: other,
      colour: OTHER_COLOUR,
      detail: others.map(([status, value]) => `${status} ${number.format(value)}`).join(' · ')
    }
  ].filter(segment => segment.value > 0)

  if (summary.total <= 0 || segments.length === 0) {
    return <Box className='h-2 rounded-full' sx={{ bgcolor: 'action.hover' }} />
  }

  return (
    <div className='flex h-2 gap-0.5' role='img' aria-label={`${summary.label} claim outcomes`}>
      {segments.map((segment, index) => (
        /* MUI's Tooltip, not the app's: it attaches to the segment itself
           instead of wrapping it, so the segment stays the flex item and its
           width is its share. */
        <MuiTooltip
          key={segment.key}
          arrow
          title={`${segment.label}: ${number.format(segment.value)} (${percent(segment.value, summary.total)})${segment.detail ? ` — ${segment.detail}` : ''}`}
        >
          <Box
            className={classnames(
              'h-full min-w-1',
              index === 0 && 'rounded-s-full',
              index === segments.length - 1 && 'rounded-e-full'
            )}
            sx={{ flex: `0 1 ${(segment.value / summary.total) * 100}%`, bgcolor: segment.colour }}
          />
        </MuiTooltip>
      ))}
    </div>
  )
}

/** One chart row: the platform, its outcome bar, its volume and approval rate. */
const OutcomeRow = ({ summary, onOpen }: { summary: PlatformSummary; onOpen?: (() => void) | undefined }) => {
  const approved = approvedOf(summary)
  const rejected = count(summary, 'Rejected')

  return (
    <ButtonBase
      onClick={onOpen}
      disabled={!onOpen}
      className='grid w-full grid-cols-12 items-center gap-3 rounded-md px-2 py-2 text-start hover:bg-actionHover'
    >
      <span className='col-span-3 flex min-w-0 items-center gap-2'>
        <PlatformLogo name={summary.label} size={18} />
        <Typography variant='body2' className='truncate font-medium'>
          {summary.label}
        </Typography>
      </span>
      <span className='col-span-7'>
        <OutcomeBar summary={summary} />
      </span>
      <span className='col-span-2 flex flex-col items-end'>
        <Typography variant='body2' className='font-medium tabular-nums'>
          {number.format(summary.total)}
        </Typography>
        {/* THE RATE WITH ITS BASE. "100% approved" off one decided claim is
            technically true and practically misleading; "100% of 1 decided"
            is both. A platform with nothing decided says so instead. */}
        <Typography variant='caption' color='text.secondary' className='tabular-nums'>
          {summary.total === 0
            ? 'No claims'
            : approved + rejected === 0
              ? 'None decided yet'
              : `${approvalRate(approved, rejected)} of ${number.format(approved + rejected)} decided`}
        </Typography>
      </span>
    </ButtonBase>
  )
}

const Legend = () => (
  <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
    {[...OUTCOMES.map(outcome => ({ label: outcome.label, colour: outcome.colour })), { label: 'Other', colour: OTHER_COLOUR }].map(
      item => (
        <span key={item.label} className='inline-flex items-center gap-1.5'>
          <Box aria-hidden='true' className='h-2 w-2 rounded-full' sx={{ bgcolor: item.colour }} />
          <Typography variant='caption' color='text.secondary'>
            {item.label}
          </Typography>
        </span>
      )
    )}
  </div>
)

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

interface AttentionItem {
  key: string
  platform: string
  text: string
  tone: 'danger' | 'warning' | 'neutral'
  icon: string
  target: 'sessions' | 'claims' | 'settings'
  weight: number
}

/**
 * GROUPED BY CAUSE, one row per kind of problem.
 *
 * One row per platform per problem produced ten near-identical lines on a
 * normal day ("Flipkart 78 claims failed…", "Myntra 61 claims failed…"). The
 * cause is the part an operator can act on — it decides which screen to open —
 * so it is the headline, with the platforms named under it, worst first.
 */
const attentionItems = (platforms: PlatformSummary[]): AttentionItem[] => {
  const items: AttentionItem[] = []
  const now = Date.now()
  const list = (entries: [string, number][]) =>
    entries
      .sort(([, a], [, b]) => b - a)
      .map(([label, value]) => (value > 1 ? `${label} ${number.format(value)}` : label))
      .join(' · ')

  // Most urgent: nothing on these platforms can run until a login is fixed.
  const logins = platforms
    .filter(summary => summary.sessionsNeedingAttention > 0)
    .map(summary => [summary.label, summary.sessionsNeedingAttention] as [string, number])
  const loginCount = logins.reduce((sum, [, value]) => sum + value, 0)

  if (loginCount > 0) {
    items.push({
      key: 'logins',
      platform: `${loginCount} login${loginCount === 1 ? '' : 's'} need${loginCount === 1 ? 's' : ''} updating`,
      text: list(logins),
      tone: 'danger',
      icon: 'tabler-key',
      target: 'sessions',
      weight: 3
    })
  }

  const failed = platforms
    .map(summary => [summary.label, count(summary, FAILED)] as [string, number])
    .filter(([, value]) => value > 0)
  const failedCount = failed.reduce((sum, [, value]) => sum + value, 0)

  if (failedCount > 0) {
    items.push({
      key: 'failed',
      platform: `${number.format(failedCount)} claim${failedCount === 1 ? '' : 's'} failed to proceed`,
      text: list(failed),
      tone: 'warning',
      icon: 'tabler-alert-triangle',
      target: 'claims',
      weight: 2
    })
  }

  const stale = platforms.filter(
    summary =>
      summary.hasMasterImport &&
      (summary.lastMasterSync === null || now - summary.lastMasterSync > STALE_MASTER_MS)
  )

  if (stale.length > 0) {
    items.push({
      key: 'master',
      platform: `Master data is out of date on ${stale.length} platform${stale.length === 1 ? '' : 's'}`,
      text: stale
        .map(summary =>
          summary.lastMasterSync === null
            ? `${summary.label} never synced`
            : `${summary.label} ${relativeTime(new Date(summary.lastMasterSync).toISOString())}`
        )
        .join(' · '),
      tone: 'neutral',
      icon: 'tabler-database',
      target: 'settings',
      weight: 1
    })
  }

  return items.sort((a, b) => b.weight - a.weight)
}

const ATTENTION_ICON_CLASS: Record<AttentionItem['tone'], string> = {
  danger: 'text-error',
  warning: 'text-warning-fg',
  neutral: 'text-textSecondary'
}

// ---------------------------------------------------------------------------
// Load errors
// ---------------------------------------------------------------------------

/**
 * The parts of the dashboard that did not load, collapsed to a line.
 *
 * Six platforms failing the same way produced six near-identical sentences — a
 * paragraph of amber above the numbers, all of it saying "the server is
 * unreachable". Grouped by CAUSE and opened on demand: the headline is what an
 * operator can act on, the platform list is the detail.
 */
const LoadErrors = ({ errors }: { errors: string[] }) => {
  const [open, setOpen] = useState(false)

  // "ajio claim counts: Cannot reach the TrackVid server." → cause + subject.
  // Grouping on the cause is what collapses six lines into one.
  const groups = useMemo<[string, string[]][]>(() => {
    const byCause = new Map<string, string[]>()

    for (const error of errors) {
      const split = error.indexOf(': ')
      const subject = split === -1 ? '' : error.slice(0, split)
      const cause = split === -1 ? error : error.slice(split + 2)

      byCause.set(cause, [...(byCause.get(cause) ?? []), subject].filter(Boolean))
    }

    return [...byCause.entries()]
  }, [errors])

  const headline =
    groups.length === 1 && groups[0]
      ? groups[0][0]
      : `${errors.length} part${errors.length === 1 ? '' : 's'} of this page could not be loaded`

  return (
    <Alert
      severity='warning'
      icon={<i className='tabler-alert-triangle' />}
      action={
        <Button size='sm' variant='ghost' onClick={() => setOpen(current => !current)} aria-expanded={open}>
          {open ? 'Hide' : `${errors.length} item${errors.length === 1 ? '' : 's'}`}
        </Button>
      }
    >
      <AlertTitle>{headline}</AlertTitle>
      <Collapse in={open}>
        {/* Plain elements, not Typography with color='inherit' — that prop
            crashes the obfuscated production build. */}
        <div className='mt-2 flex flex-col gap-2'>
          {groups.map(([cause, subjects]) => (
            <div key={cause}>
              <div className='font-medium'>{cause}</div>
              {subjects.length > 0 && <div className='opacity-80'>{subjects.join(', ')}</div>}
            </div>
          ))}
        </div>
      </Collapse>
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const DashboardPage = ({
  onNavigate
}: {
  /** Opens another screen by nav id — the tiles and attention rows are links. */
  onNavigate?: ((id: string) => void) | undefined
}) => {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    const response = await invoke<DashboardSnapshot>(DASHBOARD_CHANNELS.snapshot)
    setRefreshing(false)

    if (!response.success) {
      setLoadError(response.error.message)

      return
    }
    setLoadError(null)
    setSnapshot(response.data)
  }, [])

  // Sync's page tier — see refreshRegistry.
  useEffect(() => registerPageRefresh(load), [load])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const response = await invoke<DashboardSnapshot>(DASHBOARD_CHANNELS.snapshot)

      if (cancelled) return
      if (response.success) setSnapshot(response.data)
      else setLoadError(response.error.message)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const platforms = useMemo(
    () => [...(snapshot?.platforms ?? [])].sort((a, b) => b.total - a.total),
    [snapshot]
  )

  /** Company-wide sums of the statuses the tiles are built from. */
  const sums = useMemo(() => {
    const sum = (key: string) => platforms.reduce((total, summary) => total + count(summary, key), 0)

    return {
      approved: APPROVED_STATUSES.reduce((total, key) => total + sum(key), 0),
      rejected: sum('Rejected'),
      inReview: sum('In Review'),
      pending: sum('Pending'),
      failed: sum(FAILED)
    }
  }, [platforms])

  const attention = useMemo(() => attentionItems(platforms), [platforms])
  const totals = snapshot?.totals
  const decided = sums.approved + sums.rejected
  const go = (id: string) => (onNavigate ? () => onNavigate(id) : undefined)

  return (
    <div className='flex flex-col gap-4'>
      {/* The same frame as every other screen: one header card first. */}
      <Card className='flex flex-wrap items-center justify-between gap-3 p-3'>
        <Typography variant='body2' color='text.secondary'>
          Claims, logins and master data for every platform this company runs
          {snapshot && (
            <span className='text-textDisabled'> · updated {relativeTime(snapshot.generatedAt)}</span>
          )}
        </Typography>
        <Button
          size='sm'
          variant='secondary'
          icon={<i className='tabler-refresh' />}
          loading={refreshing}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </Card>

      {loadError && (
        <Alert severity='error' icon={<i className='tabler-alert-circle' />}>
          {loadError}
        </Alert>
      )}

      {/* A partial dashboard says which parts are missing. A figure showing
          zero because a request failed is worse than one saying so. */}
      {snapshot && snapshot.errors.length > 0 && <LoadErrors errors={snapshot.errors} />}

      {!snapshot && !loadError && (
        <Card>
          <LoadingState label='Reading this company’s claims…' />
        </Card>
      )}

      {snapshot && platforms.length === 0 && (
        <Card>
          <EmptyState
            icon={<i className='tabler-building-store text-3xl' />}
            title='No marketplaces yet'
            message='This company has no marketplace credentials configured, so there is nothing to sign in to or file against. They are added in TrackVid.'
          />
        </Card>
      )}

      {/* MASTER DATA TABLE — still commented out, not deleted. Hidden at the
          operator's request; the table, its resync buttons and the IPC behind
          them are untouched. Stale master data is now flagged in "Needs
          attention" instead. */}
      {/* <MasterImportTable /> */}

      {totals && platforms.length > 0 && (
        <>
          {/* 1 — HOW ARE WE DOING. Five figures, each with the context that
              makes it actionable; the ones with somewhere to go are links. */}
          {/* Six tiles: 3 × 2 on an ordinary window, one row on a wide one. */}
          {/* `auto-rows-fr`: every row as tall as the tallest tile, so the two
              rows of a 3 × 2 grid are one height, not 133 over 119. */}
          <div className='grid auto-rows-fr grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6'>
            {/* THE OUTCOME IN MONEY, first: what the claims were for. The
                compensation marketplaces actually paid — "Paid" on Myntra,
                the settled amount Refill Data reads on the others. */}
            <StatTile
              label='Recovered'
              value={money(totals.recovered)}
              detail={
                typeof totals.recovered === 'number'
                  ? 'Compensation paid out by marketplaces on your claims'
                  : 'Not available yet — the server has to be updated to report it'
              }
              icon='tabler-currency-rupee'
              tone={typeof totals.recovered === 'number' && totals.recovered > 0 ? 'success' : 'neutral'}
            />
            <StatTile
              label='Claims'
              value={number.format(totals.claims)}
              detail={`${platforms.length} platform${platforms.length === 1 ? '' : 's'} · ${number.format(totals.queuedLocally)} queued on this machine`}
              icon='tabler-list-check'
              onClick={go('claims')}
            />
            <StatTile
              label='Approval rate'
              value={approvalRate(sums.approved, sums.rejected)}
              detail={
                decided > 0
                  ? `${number.format(sums.approved)} approved of ${number.format(decided)} decided`
                  : 'No claim decided yet'
              }
              icon='tabler-circle-check'
              tone='success'
              meter={decided > 0 ? sums.approved / decided : undefined}
            />
            <StatTile
              label='In review'
              value={number.format(sums.inReview)}
              detail={`${percent(sums.inReview, totals.claims)} of all claims · waiting on the marketplace`}
              icon='tabler-hourglass'
            />
            <StatTile
              label='Failed to proceed'
              value={number.format(sums.failed)}
              detail={sums.failed > 0 ? 'Could not be filed — open the claim queue' : 'Nothing stuck'}
              icon='tabler-alert-triangle'
              tone={sums.failed > 0 ? 'warning' : 'neutral'}
              onClick={go('claims')}
            />
            <StatTile
              label='Logins need attention'
              value={number.format(totals.sessionsNeedingAttention)}
              detail={
                totals.sessionsNeedingAttention > 0
                  ? `of ${number.format(totals.credentials)} accounts — automations on them will fail`
                  : `All ${number.format(totals.credentials)} accounts are signed in`
              }
              icon='tabler-key'
              tone={totals.sessionsNeedingAttention > 0 ? 'danger' : 'success'}
              onClick={go('sessions')}
            />
          </div>

          {/* 2 — COMPARE, and WHAT NEEDS ME, side by side. */}
          {/* `lg`, not `xl`: this app's breakpoints are MUI's (xl is 1536px),
              so `xl` left a 1500px window single-column. */}
          <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
            <Card className='flex flex-col gap-3 p-4 lg:col-span-2'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div>
                  <Typography variant='h5' component='h2'>
                    Claim outcomes by platform
                  </Typography>
                  <Typography variant='caption' color='text.secondary'>
                    Share of each platform’s claims · approval rate is approved out of decided
                  </Typography>
                </div>
                <Legend />
              </div>
              <div className='flex flex-col'>
                {platforms.map(summary => (
                  <OutcomeRow key={summary.platform} summary={summary} onOpen={go('claims')} />
                ))}
              </div>
            </Card>

            <Card className='flex flex-col p-4'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <Typography variant='h5' component='h2'>
                  Needs attention
                </Typography>

              </div>

              {attention.length === 0 ? (
                <div className='flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center'>
                  <i className='tabler-circle-check text-3xl text-success-fg' />
                  <Typography variant='body2'>All clear</Typography>
                  <Typography variant='caption' color='text.secondary'>
                    Every login works and nothing is stuck.
                  </Typography>
                </div>
              ) : (
                <ul className='m-0 flex list-none flex-col p-0'>
                  {attention.map((item, index) => (
                    <li key={item.key}>
                      {index > 0 && <Divider />}
                      <ButtonBase
                        onClick={go(item.target)}
                        disabled={!onNavigate}
                        className='flex w-full items-center justify-start gap-3 rounded-md px-2 py-2 text-start hover:bg-actionHover'
                      >
                        <i className={classnames(item.icon, 'shrink-0 text-lg', ATTENTION_ICON_CLASS[item.tone])} />
                        <span className='flex min-w-0 flex-1 flex-col'>
                          <Typography variant='body2' className='font-medium'>
                            {item.platform}
                          </Typography>
                          <Typography variant='caption' color='text.secondary' className='line-clamp-2' title={item.text}>
                            {item.text}
                          </Typography>
                        </span>
                        {onNavigate && <i className='tabler-chevron-right shrink-0 text-base text-textDisabled' />}
                      </ButtonBase>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* 3 — THE NUMBERS. The chart's table view: every figure the bars
              and tooltips show, readable without hovering. */}
          <Card>
            <div className='px-4 pb-2 pt-4'>
              <Typography variant='h5' component='h2'>
                Platforms
              </Typography>
            </div>
            <div className='overflow-x-auto'>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th align='right'>Claims</th>
                    <th align='right'>Approved</th>
                    <th align='right'>Rejected</th>
                    <th align='right'>Approval rate</th>
                    <th align='right'>Recovered</th>
                    <th align='right'>In review</th>
                    <th align='right'>Pending</th>
                    <th align='right'>Failed to proceed</th>
                    <th>Login</th>
                    <th>Master data</th>
                    <th align='right'>Queued here</th>
                  </tr>
                </thead>
                <tbody>
                  {platforms.map(summary => {
                    const approved = approvedOf(summary)
                    const rejected = count(summary, 'Rejected')
                    const failed = count(summary, FAILED)

                    return (
                      <tr key={summary.platform} className='hover:bg-actionHover'>
                        <td>
                          <span className='flex items-center gap-2'>
                            <PlatformLogo name={summary.label} size={18} />
                            <span className='font-medium text-textPrimary'>{summary.label}</span>
                          </span>
                        </td>
                        <td align='right' className='tabular-nums font-medium text-textPrimary'>
                          {number.format(summary.total)}
                        </td>
                        <td align='right' className='tabular-nums'>{number.format(approved)}</td>
                        <td align='right' className='tabular-nums'>{number.format(rejected)}</td>
                        <td align='right' className='tabular-nums text-textPrimary'>
                          {approvalRate(approved, rejected)}
                        </td>
                        <td align='right' className='tabular-nums font-medium text-textPrimary'>
                          {money(summary.recovered)}
                        </td>
                        <td align='right' className='tabular-nums'>{number.format(count(summary, 'In Review'))}</td>
                        <td align='right' className='tabular-nums'>{number.format(count(summary, 'Pending'))}</td>
                        <td align='right' className={classnames('tabular-nums', failed > 0 && 'font-medium text-warning-fg')}>
                          {number.format(failed)}
                        </td>
                        <td>
                          {summary.worstSession ? (
                            <Badge tone={HEALTH_TONE[summary.worstSession]}>{HEALTH_LABEL[summary.worstSession]}</Badge>
                          ) : (
                            <span className='text-textDisabled'>—</span>
                          )}
                        </td>
                        <td>
                          {!summary.hasMasterImport ? (
                            <span className='text-textDisabled'>—</span>
                          ) : summary.lastMasterSync === null ? (
                            <span className='text-warning-fg'>Never synced</span>
                          ) : (
                            relativeTime(new Date(summary.lastMasterSync).toISOString())
                          )}
                        </td>
                        <td align='right' className='tabular-nums'>
                          {summary.queuedLocally > 0 ? number.format(summary.queuedLocally) : <span className='text-textDisabled'>0</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
