import { useCallback, useEffect, useMemo, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'

// Icon Imports — the shared Tabler set, bundled; see scripts/build-icon-subset.
import { FilterTab, TAB_BLOCK_SIZE } from '@renderer/components/ui/FilterTab'
import type { CmsCounts, CmsListQuery, CmsRow } from '@shared/types/cmsList'
import { Badge, type BadgeTone } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { EmptyState, LoadingState } from '@renderer/components/data/StateBlocks'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { DateRangePicker } from '@renderer/components/ui/DateRangePicker'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { useToast } from '@renderer/hooks/useToast'
import { useNotifications } from '@renderer/hooks/useNotifications'
import {
  bulkUpdateClaims,
  cmsCounts,
  exportClaimsXlsx,
  listCms,
  onDriveStatus,
  retryDriveConversion
} from '@renderer/services/cmsList.service'
import { downloadClaimResources } from '@renderer/services/claimResources.service'
import {
  claimStatusTabs,
  processClaims,
  supportedPlatforms
} from '@renderer/services/claimQueue.service'
import type { ClaimStatusTab, ClaimSupport } from '@shared/types/claimQueue'
import type { Result } from '@shared/types/result'
import { classNames } from '@renderer/utils/format'

// Style Imports
import tableStyles from '@core/styles/table.module.css'
import { registerPageRefresh } from '@renderer/services/refreshRegistry'
import { copyToClipboard } from '@renderer/services/clipboard.service'
import { registerRestore } from '@renderer/services/restoreRegistry'
import { useDevMode } from '@renderer/context/DevModeContext'
import {
  canEditTicket,
  hasTatCheck,
  hasTicketThread,
  isRowSelectable,
  isSelectableStatus,
  resolveActiveStatus,
  selectionBlockReason
} from '@shared/constants/claims'
import { checkClaimTat } from '@renderer/services/tatCheck.service'
import {
  isSkuSweepEligible
} from '@shared/constants/accountMapping'
import { SkuPickerModal } from './SkuPickerModal'
import { SkuSweepModal } from './SkuSweepModal'
import { MasterDataModal } from './MasterDataModal'
import { BulkEditModal } from './BulkEditModal'
import {
  rebuildSixSidePdf,
  SIX_SIDE_REBUILD_FIELD,
  type SixSideRebuildResult
} from './create/platforms/ajio/sixSideRebuild'
import { ReClaimModal } from './ReClaimModal'
import { TatCheckModal } from './TatCheckModal'
import { ClaimFilterModal, filterSummary } from './ClaimFilterModal'
import { RefillFieldsModal } from './RefillFieldsModal'
import { RefillProgressModal } from './RefillProgressModal'
import { canRefillBlanks, canRefillStatus } from '@shared/constants/refill'
import type { RefillField } from '@shared/types/refill'
import { runRefill } from '@renderer/services/refill.service'
import { activeFilterCount, applyFilters, type RowFilters } from '@shared/utils/rowFilter'
import {
  applyColumnFilters,
  isColumnFiltered,
  withColumnFilter,
  type ColumnFilter,
  type ColumnFilters
} from '@shared/utils/columnFilter'
import { ColumnFilterCell } from './ColumnFilterCell'
import {
  runSkuSweep,
  skuSweepPending,
  skuSweepStatus
} from '@renderer/services/skuLookup.service'
import { BulkClaimModal } from './BulkClaimModal'
import { NykaaDdrBulkModal } from './NykaaDdrBulkModal'
import { SessionGateModal } from './SessionGateModal'
import { VideoSizeModal } from './VideoSizeModal'
import { TicketThreadModal } from './TicketThreadModal'
import { TicketEditModal } from './TicketEditModal'
import type { TicketThreadTarget } from '@shared/types/ticketThread'
import { hasUploadLimit, uploadLimitFor } from '@shared/constants/uploadLimits'
import type { VideoSizeChoice } from '@shared/types/claimResources'
import { useSessionGate } from '@renderer/hooks/useSessionGate'
import { platformKey } from '@shared/utils/platformKey'
import { TruncatedText } from '@renderer/components/ui/TruncatedText'

/**
 * The company's claims, the same records the web CMS shows.
 *
 * Read live from the server rather than from anything this machine has
 * processed: an operator opening the app for the first time should see the full
 * history, not an empty screen, so the desktop app is a second window onto the
 * same data rather than a separate ledger.
 *
 * Selecting rows offers one action — Create Ticket — which files those claims
 * from this machine, using the flows in @trackvid/automation-core and a session
 * this app captured itself. It is offered only for platforms the company has
 * routed to desktop execution; everything else is the server's to file, and
 * showing the action for those would mean two machines raising one dispute.
 */

/** Tabs, in the order the web CMS shows them. Values are the STORED casing. */
const PLATFORM_TABS = [
  'Ajio',
  'Meesho',
  'Snapdeal',
  'Nykaa',
  'Amazon',
  'Myntra',
  'Flipkart',
  'Tata CliQ',
  'Delhivery',
  'Xbees',
  'Other'
] as const

/**
 * Until the registry answers.
 *
 * The base set every platform has, so the tab strip is never empty on first
 * paint — not a default anyone falls back to permanently. The real list is
 * per platform and comes from the core.
 */
const BASE_STATUS_TABS: ClaimStatusTab[] = [
  /*
   * THE DOTS ARE THEME VARIABLES, not hex.
   *
   * They were six hard-coded Tailwind colours (#F59E0B, #0EA5E9, #22C55E …)
   * matched by hand to the admin panel. That stopped being right twice over:
   * the app is dressed in Geist now, so those six were the only statuses on
   * screen NOT speaking the palette, and being literal hex they rendered
   * identically in dark mode, where a #22C55E on black is a different green
   * from the one every other success indicator uses.
   *
   * Pointing them at the CSS variables keeps the six tabs in step with the
   * badges, the progress bars and the dashboard — one place to change, both
   * schemes for free.
   */
  { value: 'All', label: 'All', dot: 'var(--mui-palette-text-secondary)' },
  {
    value: 'Failed to Proceed',
    label: 'Failed to Proceed',
    dot: 'var(--mui-palette-error-dark)'
  },
  { value: 'Pending', label: 'Pending', dot: 'var(--mui-palette-warning-main)' },
  { value: 'In Review', label: 'In Review', dot: 'var(--mui-palette-info-main)' },
  { value: 'Approved', label: 'Approved', dot: 'var(--mui-palette-success-main)' },
  { value: 'Rejected', label: 'Rejected', dot: 'var(--mui-palette-error-main)' }
]

const STATUS_TONE: Record<string, BadgeTone> = {
  Approved: 'success',
  Paid: 'success',
  Resolved: 'success',
  Pending: 'warning',
  'In Review': 'info',
  'In Progress': 'warning',
  'Awaiting Agent Response': 'warning',
  'Customer Replied': 'neutral',
  'Un Attended': 'neutral',
  Rejected: 'danger',
  'Failed to Proceed': 'danger'
}

const SCRIPT_TONE: Record<string, BadgeTone> = {
  Success: 'success',
  Completed: 'success',
  Running: 'warning',
  Queued: 'warning',
  Failed: 'danger',
  'Help Center Failed': 'danger',
  'Not Started': 'neutral'
}

/**
 * Rows per page the operator can pick. 25 is the default; 200 is the ceiling
 * the main process enforces on `/cms` (`cmsList.service`), so offering more
 * would silently return 200.
 */
const PAGE_SIZES = [25, 50, 100, 200] as const

const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(size => ({ value: String(size), label: String(size) }))

/** `yyyy-MM-dd`, in LOCAL time — the panel formats its window the same way. */
const isoDaysAgo = (days: number): string => {
  const date = new Date()

  date.setDate(date.getDate() - days)

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

const dash = (value: string): string => (value.length > 0 ? value : '—')

/** Rupees, whole, with Indian digit grouping: ₹1,23,456. */
const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
})

const formatDate = (iso: string): string => {
  if (!iso) return '—'
  const at = Date.parse(iso)

  if (Number.isNaN(at)) return '—'

  return new Date(at).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Whether this row's SKU can be read off the marketplace.
 *
 * AJIO only: it is the one platform with an endpoint that answers "what is on
 * this return" from an AWB, and the one whose claim aborts outright without a
 * SKU. The account and the POB are what the lookup signs in with and searches
 * under — both come from Map Username — so without them there is nothing to
 * ask, and an icon that could only ever fail is worse than no icon.
 *
 * Status-gated for the same reason the writes are: a filed claim's ticket was
 * raised against the SKU it had, and changing the row would only make the two
 * disagree.
 */
const canPickSku = (row: CmsRow): boolean =>
  row.platform.toLowerCase().trim() === 'ajio' &&
  isSelectableStatus(row.status) &&
  row.username.length > 0 &&
  row.pobId.length > 0 &&
  row.returnAwb.length > 0

/**
 * The five tabs whose claim flow carries no SKU, POB, scanned number, customer
 * order number or account type — the web CMS calls them the bundle tabs and
 * narrows their column set the same way (TrackVid-FE `PLATFORM_BUNDLE_TABS`).
 */
const BUNDLE_TABS = ['amazon', 'flipkart', 'tata cliq', 'delhivery', 'xbees'] as const

/** Pages after the current one, loaded by a header value list — see `loadNextPage`. */
interface ExtraPages {
  /** The list query they were loaded for, as JSON. */
  key: string
  rows: CmsRow[]
  /** The last page number loaded. */
  lastPage: number
  loading: boolean
}

const NO_EXTRA_PAGES: ExtraPages = { key: '', rows: [], lastPage: 0, loading: false }

/** Which tabs a column belongs to. Absent means all of them. */
type ColumnScope = { readonly only: readonly string[] } | { readonly except: readonly string[] }

interface ClaimColumn {
  readonly key: keyof CmsRow | 'resources'
  readonly label: string
  readonly width?: string
  /** Numbers read down a column when they line up on the right. */
  readonly align?: 'right'
  /** Platform tab labels, lowercased. See `columnsFor`. */
  readonly scope?: ColumnScope
  /** Hidden in packaged builds — see `columnsFor`. */
  readonly devOnly?: boolean
}

/**
 * Columns, left to right. Kept as data so the header and body cannot drift.
 *
 * SCOPED PER PLATFORM, because a column the marketplace has no concept of is
 * not an empty cell — it is a wrong header. POB ID is AJIO's place of business
 * and nothing else has one; Sub Order No is Meesho's per-item order id; Nykaa
 * and Snapdeal's claim flows carry no customer order number or account type.
 * Showing every column on every tab put "POB ID" above a column of em dashes on
 * Flipkart, and left the operator to know from somewhere else that it could
 * never have held a value.
 *
 * These are the rules the web CMS already applies (TrackVid-FE
 * `src/pages/CMS.tsx`), so the two screens agree about what a platform has.
 * Two columns are new here: Sub Order No and Drive Status exist on the row and
 * were simply never shown, which is the same mismatch in the other direction.
 *
 * `only` for a column that belongs to those tabs alone, `except` for one that
 * is noise on them — one or the other, never both.
 */
const COLUMNS: readonly ClaimColumn[] = [
  // ONE LINE EACH. The platform cell used to stack a logo, the marketplace
  // and the account in two lines, which made it the tallest cell in every row
  // and set the height of the whole table. The account now has its own column
  // right beside it — still the second thing read, since it decides whether a
  // claim can be filed at all — and the marketplace is its name alone.
  { key: 'platform', label: 'Platform' },
  { key: 'username', label: 'Username', width: 'max-w-56' },
  { key: 'ticket', label: 'Ticket' },
  { key: 'returnAwb', label: 'Return AWB' },
  // Beside the AWB it belongs to. Meesho's claim form is searched by this, so a
  // row without one cannot be filed at all.
  { key: 'subOrderNumber', label: 'Sub Order No', scope: { only: ['meesho', 'snapdeal'] } },
  // Beside the AWB it is for: the evidence zip for filing this claim by hand.
  // Shipped to every operator — filing by hand is a flow they reach from here.
  { key: 'resources', label: 'Resources' },
  { key: 'sellerSku', label: 'Seller SKU', scope: { except: ['snapdeal', ...BUNDLE_TABS] } },
  // AJIO's place of business — the thing its claim is filed under. No other
  // marketplace has one, which is why this column was the clearest mismatch.
  { key: 'pobId', label: 'POB ID', scope: { only: ['ajio'] } },
  { key: 'status', label: 'Status' },
  // What the marketplace paid on the claim — beside the status that says it
  // was paid. Every platform, and a dash where nothing has been paid.
  { key: 'amount', label: 'Amount', align: 'right' },
  // Why it was rejected, beside the verdict and the amount it did not earn.
  // Capped like Error: a reason is a sentence, and the whole of it is on hover.
  { key: 'rejectReason', label: 'Rejection reason', width: 'max-w-56' },
  { key: 'scriptStatus', label: 'Status' },
  // AJIO only: whether this claim's evidence has finished converting to the
  // Drive links a claim attaches. Nothing else uploads that way.
  { key: 'driveStatus', label: 'Drive Status', scope: { only: ['ajio'] } },
  { key: 'attempts', label: 'Attempts' },
  { key: 'scriptError', label: 'Error', width: 'max-w-56' },
  { key: 'scannedNumber', label: 'Scanned Number', scope: { except: BUNDLE_TABS } },
  {
    key: 'customerOrderNumber',
    label: 'Cust. Order No.',
    scope: { except: ['nykaa', 'snapdeal', ...BUNDLE_TABS] }
  },
  { key: 'brand', label: 'Brand' },
  {
    key: 'accountType',
    label: 'Account Type',
    scope: { except: ['nykaa', 'snapdeal', ...BUNDLE_TABS] }
  },
  { key: 'forwardOrderDate', label: 'Forward Order Date' },
  { key: 'feedName', label: 'Feed Name' },
  { key: 'createdAt', label: 'Create Date - Time' }
]

/**
 * The columns one platform tab shows.
 *
 * "Other" is every platform this app does not model, so it gets the
 * platform-agnostic base set and none of the platform-specific columns — the
 * one honest answer when the platform itself is unknown.
 *
 * `devOnly` columns are dropped from packaged builds. `import.meta.env.DEV` is
 * a build-time literal, so the branch is resolved by the bundler rather than at
 * runtime, and the column cannot be reached in a shipped app.
 */
const columnsFor = (tab: string): readonly ClaimColumn[] => {
  const key = tab.toLowerCase().trim()

  return COLUMNS.filter(column => {
    if (column.devOnly && !import.meta.env.DEV) return false
    if (!column.scope) return true
    if ('only' in column.scope) return column.scope.only.includes(key)

    return !column.scope.except.includes(key)
  })
}

const Cell = ({
  row,
  column,
  onPickSku,
  onDownload,
  onEdit,
  onViewTicket,
  onEditTicket,
  onRetryDrive,
  retryingDrive,
  downloading
}: {
  row: CmsRow
  column: ClaimColumn
  /** Null when this row's SKU cannot be looked up — see `canPickSku`. */
  onPickSku: (() => void) | null
  onDownload: () => void
  /** Opens this claim in the full form. Null when there is nowhere to open it. */
  onEdit: (() => void) | null
  /** Opens the filed ticket in the ticket window. Null when there is none to open. */
  onViewTicket: (() => void) | null
  /** Adds or corrects the ticket by hand. Null outside `canEditTicket`. */
  onEditTicket: (() => void) | null
  /** Re-queues this AJIO claim's failed Drive conversion. */
  onRetryDrive: () => void
  /** This row's Drive retry is on its way to the server. */
  retryingDrive: boolean
  /** This row's zip is being prepared. */
  downloading: boolean
}) => {
  // The ticket id, with an eye beside it on platforms whose ticket can be read
  // here (TICKET_THREAD_PLATFORMS) — details, attachments, comments, reply —
  // and a pencil where it may still be typed in by hand.
  if (column.key === 'ticket' && ((row.ticket && onViewTicket) || onEditTicket)) {
    return (
      <span className='flex items-center gap-1'>
        {/* No placeholder dash when empty — the pencil alone says "add one". */}
        {row.ticket && <span>{row.ticket}</span>}
        {row.ticket && onViewTicket && (
          <Tooltip label='View the ticket — details, files and comments'>
            <IconButton size='small' aria-label={`View ticket ${row.ticket}`} onClick={onViewTicket}>
              <i className='tabler-eye text-lg' />
            </IconButton>
          </Tooltip>
        )}
        {onEditTicket && (
          <Tooltip label={row.ticket ? 'Update the ticket number' : 'Add the ticket number — moves the claim to In Review'}>
            <IconButton
              size='small'
              aria-label={`${row.ticket ? 'Update' : 'Add'} the ticket for ${row.returnAwb || row.id}`}
              onClick={onEditTicket}
            >
              <i className='tabler-pencil text-lg' />
            </IconButton>
          </Tooltip>
        )}
      </span>
    )
  }

  // Every platform, every status: evidence is useful to someone filing by hand
  // whether the automation never ran, failed, or filed it already.
  if (column.key === 'resources') {
    return (
      // Icon only — a text button on every row made the column the widest thing
      // in the table. The Tooltip wraps the button rather than using `title`: a
      // disabled button gets no pointer events, so the reason would never show.
      <div className='flex items-center gap-0.5'>
        <Tooltip
          label={
            downloading
              ? 'Preparing the zip…'
              : row.returnAwb
                ? 'Download resources — images, video and description, named after the claim form'
                : 'This row has no AWB to look the claim up by'
          }
        >
          <span>
            <IconButton
              size='small'
              aria-label={`Download claim resources for ${row.returnAwb || row.id}`}
              aria-busy={downloading}
              disabled={downloading || !row.returnAwb}
              onClick={onDownload}
            >
              {downloading ? (
                <CircularProgress size={16} color='inherit' />
              ) : (
                <i className='tabler-download text-lg' />
              )}
            </IconButton>
          </span>
        </Tooltip>
        {/*
          Full edit, next to the download.
          Every field of the claim, on the form it was created with — which is
          the only way to fix an image slot or a per-platform bundle. The
          inline editors on this grid reach the text fields and nothing else.
        */}
        {onEdit && (
          <Tooltip
            label={
              row.returnAwb
                ? 'Open this claim in the full form'
                : 'This row has no AWB to look the claim up by'
            }
          >
            <span>
              <IconButton
                size='small'
                aria-label={`Edit the claim for ${row.returnAwb || row.id}`}
                disabled={!row.returnAwb}
                onClick={onEdit}
              >
                <i className='tabler-edit text-lg' />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </div>
    )
  }

  // The marketplace account. Missing on precisely the rows Refill Data exists
  // for, so the blank is drawn as a real absence — the same em dash the rest
  // of the table uses, faint — rather than left as empty space that reads like
  // a rendering fault.
  if (column.key === 'username') {
    return (
      // A plain span, so the value takes the cell's colour like every other
      // value in the row; only the absence is drawn fainter.
      <span
        className={classNames('block truncate', !row.username && 'text-textDisabled')}
        title={row.username || undefined}
      >
        {dash(row.username)}
      </span>
    )
  }

  if (column.key === 'status') {
    return <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{dash(row.status)}</Badge>
  }

  if (column.key === 'scriptStatus') {
    return <Badge tone={SCRIPT_TONE[row.scriptStatus] ?? 'neutral'}>{dash(row.scriptStatus)}</Badge>
  }

  // The SKU, with a way to go and get it.
  //
  // AJIO is the only platform that can answer "what is on this return" from an
  // AWB, and it is the platform whose claim ABORTS without a SKU — so the one
  // screen that shows the blank is the one that should be able to fill it.
  // Beside the value rather than replacing it: correcting a wrong SKU is as
  // real a case as setting a missing one.
  if (column.key === 'sellerSku') {
    return (
      <span className="flex items-center gap-1.5">
        <span className={row.sellerSku ? undefined : 'text-textDisabled'}>{dash(row.sellerSku)}</span>

        {onPickSku && (
          <Tooltip label="Read this return's articles from AJIO and choose the SKU">
            <IconButton
              size='small'
              onClick={onPickSku}
              aria-label={`Look up the SKU for ${row.returnAwb || row.id}`}
              className='-mlb-1'
            >
              <i className='tabler-refresh text-base' />
            </IconButton>
          </Tooltip>
        )}
      </span>
    )
  }

  // The admin panel's Drive Status, drawn the same way: Preparing while the
  // links are being copied, Failed with a retry beside it, Ready otherwise — a
  // claim from before Drive conversion existed has no status and is ready too.
  if (column.key === 'driveStatus') {
    if (row.driveStatus === 'pending') {
      return (
        <Tooltip label='Copying the CCTV video and images from S3 to Google Drive. Ready to auto-claim in a few moments.'>
          <span>
            <Badge tone='warning'>
              <span className='flex items-center gap-1'>
                <CircularProgress size={10} color='inherit' />
                Preparing…
              </span>
            </Badge>
          </span>
        </Tooltip>
      )
    }

    if (row.driveStatus === 'failed') {
      return (
        <span className='flex items-center gap-0.5'>
          <Tooltip label="Could not prepare the Google Drive links. The server retries on its own; this claim isn't ready to file yet.">
            <span>
              <Badge tone='danger'>Failed</Badge>
            </span>
          </Tooltip>
          <Tooltip label={retryingDrive ? 'Retrying…' : 'Retry the Drive upload'}>
            <span>
              <IconButton
                size='small'
                aria-label={`Retry the Drive upload for ${row.returnAwb || row.id}`}
                aria-busy={retryingDrive}
                disabled={retryingDrive}
                onClick={onRetryDrive}
              >
                {retryingDrive ? (
                  <CircularProgress size={14} color='inherit' />
                ) : (
                  <i className='tabler-refresh text-base' />
                )}
              </IconButton>
            </span>
          </Tooltip>
        </span>
      )
    }

    return <Badge tone='success'>Ready</Badge>
  }

  if (column.key === 'amount') {
    return row.amount === null ? (
      <span className='text-textDisabled'>—</span>
    ) : (
      <span className='font-medium tabular-nums text-textPrimary'>{rupees.format(row.amount)}</span>
    )
  }

  if (column.key === 'createdAt') return <>{formatDate(row.createdAt)}</>
  if (column.key === 'attempts') return <span className="tabular-nums">{row.attempts}</span>

  if (column.key === 'rejectReason') {
    return row.rejectReason ? (
      <TruncatedText text={row.rejectReason} />
    ) : (
      <span className='text-textDisabled'>—</span>
    )
  }

  if (column.key === 'scriptError') {
    return <TruncatedText text={row.scriptError} className="text-danger-fg" />
  }

  return <>{dash(String(row[column.key] ?? ''))}</>
}

/**
 * A failed routing lookup is an ANSWER — "we could not find out" — not an
 * absent one. Keeping them distinct is what lets the disabled button say
 * something true instead of guessing at a setting.
 */
const toSupport = (response: Result<ClaimSupport>): ClaimSupport =>
  response.success
    ? response.data
    : { routingKnown: false, runners: [], routedHere: [], supported: [] }

export const ClaimsPage = ({
  onOpenJobs,
  onEditClaim
}: {
  onOpenJobs?: () => void
  /**
   * Open a claim in the full Create Claim form.
   *
   * Absent when there is nowhere to open it — the page renders without the
   * button rather than with one that does nothing.
   */
  onEditClaim?: (target: { awb: string; platform: string }) => void
}) => {
  const toast = useToast()
  const notifications = useNotifications()
  const [platform, setPlatform] = useState<string>('Ajio')
  // What this tab's marketplace actually has — see COLUMNS.
  const columns = useMemo(() => columnsFor(platform), [platform])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [nykaaDdrOpen, setNykaaDdrOpen] = useState(false)
  // Keyed by the platform tab's own label, which is what PLATFORM_TABS holds.
  const [tabsByPlatform, setTabsByPlatform] = useState<Record<string, ClaimStatusTab[]>>({})

  /**
   * Pending, not All.
   *
   * This page exists to get claims FILED, and Pending is the only large tab
   * whose rows can still be acted on — everything else is either already with
   * the marketplace or finished. Opening on All meant the first thing an
   * operator did every morning was narrow it down to Pending by hand.
   *
   * Kept as a plain initial value rather than a stored preference: it is where
   * the day starts, and `resolveActiveStatus` still falls back to All on a
   * platform whose tab list has no Pending.
   */
  const [status, setStatus] = useState<string>('Pending')

  // Myntra's payout states, AJIO's full workflow, the base set for the rest —
  // whatever the admin panel shows for THIS platform.
  const statusTabs = tabsByPlatform[platform.toLowerCase()] ?? BASE_STATUS_TABS

  const activeStatus = resolveActiveStatus(status, statusTabs)

  // The admin panel lists the last SEVEN DAYS by default and always sends the
  // window; this app sent none, so the same account read 1365 Myntra claims here
  // and 35 there. Matched — and shown, because a filter that changes the numbers
  // should never be invisible.
  const [range, setRange] = useState(() => ({ startDate: isoDaysAgo(6), endDate: isoDaysAgo(0) }))
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])

  const [rows, setRows] = useState<CmsRow[] | null>(null)
  // Every marketplace action on this page stops here first — see useSessionGate.
  const { gate: sessionGate, closeGate, ensureLiveSessions, recheckGate } = useSessionGate()
  // Per row, so two zips can be prepared at once and each button spins alone.
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())
  // Per row too: a retry is one claim's, and each icon spins alone.
  const [retryingDriveIds, setRetryingDriveIds] = useState<Set<string>>(new Set())
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<CmsCounts | null>(null)
  const [support, setSupport] = useState<ClaimSupport | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /**
   * Auto-mapping — what a run does when the marketplace's sub-order number
   * disagrees with the one already on the row.
   *
   *   on   replace it as the run goes
   *   off  change nothing and ask, row by row, when the run ends
   *
   * Off by default: the stored value can be somebody's correction, and
   * overwriting it should be a decision rather than a default.
   */
  const [checkingTat, setCheckingTat] = useState(false)
  // How many the running check was given — what the dialog shows until its
  // first progress event lands.
  const [tatTotal, setTatTotal] = useState(0)
  const [tatOpen, setTatOpen] = useState(false)
  // Bumped per run; the dialog is remounted on it so each check starts empty.
  const [tatRun, setTatRun] = useState(0)
  /**
   * Refill Data. The fields are chosen FIRST (they decide what the run may
   * write), then the table is armed for rows, then it runs.
   */
  const [refillFieldsOpen, setRefillFieldsOpen] = useState(false)
  const [refillFields, setRefillFields] = useState<RefillField[]>([])
  const [refilling, setRefilling] = useState(false)
  const [refillOpen, setRefillOpen] = useState(false)
  const [refillTotal, setRefillTotal] = useState(0)
  const [refillRun, setRefillRun] = useState(0)
  /**
   * Column filters over the rows ALREADY fetched — see shared/utils/rowFilter.
   * Not part of the server query on purpose: it answers "which of these", and
   * the tab counts keep meaning what they say.
   */
  const [filters, setFilters] = useState<RowFilters>({})
  /** The header row's per-column search and value lists — see shared/utils/columnFilter. */
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({})
  /** Later pages of the same query, loaded by a header value list — see `loadNextPage`. */
  const [extra, setExtra] = useState<ExtraPages>(NO_EXTRA_PAGES)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterRun, setFilterRun] = useState(0)
  /**
   * Which bulk tool is armed, if any.
   *
   * Pressing "Map Username" or "Bulk SKU" no longer starts anything — it arms
   * the table. The checkbox column switches to that tool's own eligibility, the
   * operator ticks what they want, and the button becomes "Run …". A run over
   * everything the backend considers eligible is still one click away (Select
   * all), but it is now a click somebody made.
   */
  const [armedTool, setArmed] = useState<
    'sku-sweep' | 'refill' | 'status-change' | 'bulk-edit' | null
  >(null)
  /** The bulk-edit dialog, and whether its write is in flight. */
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkEditing, setBulkEditing] = useState(false)
  /**
   * Ask the marketplace rather than this machine's backup. AJIO only.
   *
   * Chosen in the fields dialog and carried to the run, because the rows are
   * picked in between — the decision is made before there is anything to run.
   */
  const [refillUseApis, setRefillUseApis] = useState(false)

  /**
   * The bulk tools — Check master data, Map Username, Bulk SKU — are developer
   * mode only.
   *
   * Each of them reaches a marketplace directly and writes across many claims
   * at once, which is not what the page is for most of the time: filing a claim
   * is. They are unlocked with five clicks on the logo.
   */
  const { devMode } = useDevMode()

  /**
   * Armed is DERIVED, not just stored.
   *
   * Turning developer mode off while a tool is armed would otherwise leave the
   * table in a selection mode with no button left to run or cancel it — the
   * checkbox column would keep offering a tool that is no longer there.
   */
  // Status Change and Bulk Update are everyday tools, offered without developer
  // mode; the rest stay behind it.
  const armed =
    devMode || armedTool === 'status-change' || armedTool === 'bulk-edit' ? armedTool : null
  // Whether the run's own window is on screen. Separate from `mapping` because
  // the two are genuinely independent: minimising leaves the run going, and the
  // window stays up after it finishes so the totals can be read.
  // The row whose SKU is being chosen, or null when the picker is shut.
  const [skuRow, setSkuRow] = useState<CmsRow | null>(null)
  // The claim whose ticket number is being typed in by hand, if any.
  const [ticketEditRow, setTicketEditRow] = useState<CmsRow | null>(null)
  // The filed ticket open in the ticket window, if any.
  const [ticketTarget, setTicketTarget] = useState<TicketThreadTarget | null>(null)
  const [sweeping, setSweeping] = useState(false)
  const [sweepOpen, setSweepOpen] = useState(false)
  const [masterOpen, setMasterOpen] = useState(false)
  const [reClaimOpen, setReClaimOpen] = useState(false)
  const [sweepCount, setSweepCount] = useState<{
    platform: string
    count: number
    cmsIds: string[]
  }>({ platform: '', count: 0, cmsIds: [] })
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** The query behind the page on screen — the list, and Export, both send it. */
  const listQuery = useMemo<CmsListQuery>(
    () => ({
      platform,
      // "All" is a tab, not a stored status — sending it would match nothing.
      ...(activeStatus === 'All' ? {} : { status: activeStatus }),
      ...(search.trim() ? { search: search.trim() } : {}),
      ...range,
      page,
      limit: pageSize
    }),
    [platform, activeStatus, search, page, pageSize, range]
  )

  /** Fetches without touching state, so the effect below can await first. */
  const fetchPage = useCallback(
    () =>
      Promise.all([
        listCms(listQuery),
        // The same filters the list is using — the tabs must count the rows
        // the table would show, not a different set.
        cmsCounts({
          platform,
          ...(activeStatus === 'All' ? {} : { status: activeStatus }),
          ...(search.trim() ? { search: search.trim() } : {}),
          ...range
        })
      ]),
    [listQuery, platform, activeStatus, search, range]
  )

  const apply = useCallback(
    ([listed, counted]: Awaited<ReturnType<typeof fetchPage>>) => {
      if (!listed.success) {
        setError(listed.error.message)

        return
      }
      setError(null)
      setRows(listed.data.rows)
      // A reload makes the later pages loaded for the header filters stale.
      setExtra(NO_EXTRA_PAGES)
      setTotal(listed.data.total)
      // Selection is per page of results; keeping ids across a filter change
      // would let Create Ticket act on rows no longer on screen.
      setSelected(new Set())

      if (counted.success) setCounts(counted.data)
    },
    []
  )

  /** Refresh, with the button's spinner. */
  /**
   * Re-asks which platforms this machine may file for.
   *
   * Called on mount AND from Refresh. Refresh matters: the answer decides
   * whether Create Ticket is clickable, and when the lookup fails the button
   * tells the operator to press Refresh — so it has to actually retry, not just
   * reload the table underneath an unchanged button.
   */
  const loadSupport = useCallback(async () => {
    setSupport(toSupport(await supportedPlatforms()))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [result] = await Promise.all([fetchPage(), loadSupport()])
    setLoading(false)
    apply(result)
  }, [fetchPage, apply, loadSupport])

  // Every setState happens after the await, so unmounting mid-flight cannot
  // write to a dead component and the effect stays free of synchronous state.
  // Sync's page tier — see refreshRegistry.
  const runDownload = useCallback(
    async (row: CmsRow, video: VideoSizeChoice) => {
      setDownloadingIds(current => new Set(current).add(row.id))

      const result = await downloadClaimResources({
        cmsId: row.id,
        platform: row.platform,
        awbNumber: row.returnAwb,
        video
      })

      setDownloadingIds(current => {
        const next = new Set(current)
        next.delete(row.id)

        return next
      })

      if (!result.success) {
        // Closing the save dialog is a choice, not a failure.
        if (result.error.message !== 'Cancelled') toast.error(result.error.message)

        return
      }

      const name = result.data.path.split(/[\\/]/).pop() ?? result.data.path
      const { missing, video: fitted } = result.data

      // Said out loud, because the operator asked for a file that uploads and
      // a re-encode that could not get under the cap is exactly the case where
      // they would otherwise find out at the claim form.
      if (fitted?.reason) {
        toast.error(
          `Saved ${name}, but the video could not be shrunk — ${fitted.reason}. It will be refused by the portal.`
        )

        return
      }

      if (missing.length > 0) {
        toast.error(
          `Saved ${name}, but ${missing.length} file${missing.length === 1 ? '' : 's'} could not be downloaded — see MISSING.txt inside`
        )
      } else {
        toast.success(`Saved ${name}`)
      }
    },
    [toast]
  )

  /**
   * The row waiting on an answer about its video; null when nothing is.
   *
   * Only a platform that has STATED an upload cap is asked about — Meesho is
   * the one that has, by refusing an attachment over 25MB with a bare HTTP 400.
   * Everywhere else the question has no answer this app could act on, so the
   * download starts straight away and the file is left exactly as the row holds
   * it.
   */
  const [videoChoiceRow, setVideoChoiceRow] = useState<CmsRow | null>(null)

  const downloadResources = useCallback(
    async (row: CmsRow) => {
      if (hasUploadLimit(row.platform)) {
        setVideoChoiceRow(row)

        return
      }

      await runDownload(row, 'original')
    },
    [runDownload]
  )

  /**
   * Re-queues one claim's failed Drive conversion.
   *
   * On success the row is shown as Preparing at once — the server has already
   * set it so — rather than waiting for a reload. The conversion itself takes
   * minutes, so Refresh is what shows it landing.
   */
  const retryDrive = useCallback(
    async (row: CmsRow) => {
      setRetryingDriveIds(current => new Set(current).add(row.id))

      const response = await retryDriveConversion(row.id)

      setRetryingDriveIds(current => {
        const next = new Set(current)

        next.delete(row.id)

        return next
      })

      if (!response.success) {
        toast.error(response.error.message)

        return
      }

      setRows(current =>
        current?.map(item => (item.id === row.id ? { ...item, driveStatus: 'pending' } : item)) ?? current
      )
      toast.success(`Drive upload queued again for ${row.returnAwb || 'this claim'}`)
    },
    [toast]
  )

  useEffect(() => registerPageRefresh(load), [load])

  /*
   * DRIVE STATUS, LIVE. The server announces when an AJIO claim's Drive
   * conversion settles; patching the row here is what lets a "Preparing…" row
   * turn Ready — and selectable for Create Ticket — without a reload. A row not
   * on screen is ignored: the next fetch reads it from the server anyway.
   */
  useEffect(
    () =>
      onDriveStatus(({ cmsId, driveStatus }) => {
        const patch = (list: CmsRow[]): CmsRow[] =>
          list.some(item => item.id === cmsId && item.driveStatus !== driveStatus)
            ? list.map(item => (item.id === cmsId ? { ...item, driveStatus } : item))
            : list

        setRows(current => (current ? patch(current) : current))
        setExtra(current => {
          const rows = patch(current.rows)

          return rows === current.rows ? current : { ...current, rows }
        })
      }),
    []
  )

  useEffect(() => {
    let cancelled = false

    void fetchPage().then(result => {
      if (!cancelled) apply(result)
    })

    return () => {
      cancelled = true
    }
  }, [fetchPage, apply])

  useEffect(() => {
    let cancelled = false

    void supportedPlatforms().then(response => {
      if (!cancelled) setSupport(toSupport(response))
    })

    // Fetched once for every platform rather than per tab switch: it is static
    // data from the core's registry, so re-asking on each click would be
    // latency with nothing to gain.
    void claimStatusTabs(PLATFORM_TABS.map(name => name.toLowerCase())).then(response => {
      if (!cancelled && response.success) setTabsByPlatform(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [])


  /**
   * How many claims on this platform still need an account.
   *
   * Read on a platform switch and again when a run finishes — so the run that
   * just filled fifty rows takes the button down with it — and NOT on every
   * list load. The count is a query over every unmapped claim on the platform,
   * and re-running it for each page, tab and keystroke would be a few hundred
   * rows scanned per keypress to answer a question that changes about twice an
   * hour.
   *
   * Deliberately not scoped to the status tab or the page either: the run works
   * on ALL of a platform's unmapped claims whatever is being looked at, so a
   * count of the current view would promise the wrong number.
   */

  /**
   * How many claims a bulk SKU sweep could ask about.
   *
   * Read on the same terms as the mapping count — platform switch and when a
   * sweep finishes, never per page or keystroke. It is narrower than the
   * mapping count by definition: a row needs an account AND a POB before AJIO
   * can be asked anything about it, which is what Map Username fills in.
   */
  useEffect(() => {
    if (!devMode || platform.toLowerCase() !== 'ajio' || sweeping) return undefined

    let cancelled = false

    void skuSweepPending(platform).then(response => {
      if (!cancelled && response.success) {
        setSweepCount({
          platform: platform.toLowerCase(),
          count: response.data.count,
          cmsIds: response.data.cmsIds
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [platform, sweeping, devMode])

  const sweepable = sweepCount.platform === platform.toLowerCase() ? sweepCount.count : 0

  /**
   * Every eligible claim the armed tool could touch, company-wide.
   *
   * The grid pages at 25 and these counts are for the whole company, so ticking
   * page by page would mean four passes over a list of eighty — four browser
   * sessions to do one job.
   */
  const allEligibleIds =
    armed === 'sku-sweep'
      ? (sweepCount.platform === platform.toLowerCase() ? sweepCount.cmsIds : [])
      : []

  // The corner panel is the only trace of a minimised run, and a bulk SKU sweep
  // ends holding a review nobody has saved — so the panel needs a way back into
  // the window. Keyed exactly as BackgroundWork keys its rows.
  useEffect(() => registerRestore('sku-sweep', () => setSweepOpen(true)), [])
  // A minimised bulk claim job: the corner panel's row reopens its window.
  useEffect(() => registerRestore('bulk-spf', () => setBulkOpen(true)), [])

  // platformKey, not toLowerCase: `supported` holds registry KEYS, and this
  // page holds the tab's display label — "Tata CliQ" never matched "tatacliq",
  // so Create Ticket stayed disabled for a platform with a working runner.
  const canProcess = support?.supported.includes(platformKey(platform)) ?? false
  // The column is shown where filing means anything — and wherever a bulk tool
  // is armed, since its rows are exactly the ones filing cannot select.
  //
  // Developer mode lifts the tab restriction, on the same theory as
  // `allowCappedRetry`: someone unlocking the console with five clicks on the
  // logo is a support user driving a re-file from an "All" or "In Review"
  // tab, and the per-row rules below still stop a claim that is running, over
  // the retry cap, or missing an account/POB/sub-order from being ticked.
  const canSelect = isSelectableStatus(activeStatus) || armed !== null || devMode

  /**
   * What a tick means right now.
   *
   * One column, three rules, because the three actions want different rows:
   * Create Ticket wants a claim that is ready to file, Map Username wants one
   * that is missing an identifier, and Bulk SKU wants one that has them all.
   * Switching the rule with the armed tool is what lets a single column serve
   * all three without any of them offering a row it cannot act on.
   */
  // An operator may re-file a claim that hit the retry cap — a Failed to
  // Proceed row is exactly the one somebody has fixed and wants to run again.
  // Only HERE, by hand: the scheduled Auto claim reads the same rule without
  // this option (pendingClaims.service), so a capped claim is never retried
  // unattended. Shared by the checkbox, its tooltip, select-all AND the
  // re-check inside Create Ticket — relaxing only the checkbox would let a row
  // be ticked and then silently dropped at submit.
  const selectionOptions = useMemo(() => ({ allowCappedRetry: true }), [])

  const rowEligible = useCallback(
    (row: CmsRow): boolean => {
      // Developer mode may re-check a row that already has everything — the
      // only way to correct a sub-order number that is filled and wrong.
      // Refill asks the marketplace about a row and fills its blanks, so any
      // row it can reach is fair game — the run itself decides what is missing.
      /*
        * ANY ROW, deliberately.
        *
        * The other tools ask a marketplace something and so need a row it can
        * answer about. This one CORRECTS the row — and the rows most in need
        * of correcting are exactly those the other gates turn away: no
        * account, no AWB, a status that should never have been set. Refusing
        * those here would lock the fix out of the rows that need it.
        */
       if (armed === 'bulk-edit') return true
       if (armed === 'refill') return Boolean(row.returnAwb)
       // A Pending row has no ticket yet, so there is no status to ask about.
       if (armed === 'status-change') return Boolean(row.returnAwb) && row.status !== 'Pending'
      if (armed === 'sku-sweep') return isSkuSweepEligible(row)

      return isRowSelectable(row, selectionOptions)
    },
    [armed, selectionOptions]
  )

  const armedLabel =
    armed === 'refill'
      ? 'Refill Data'
      : armed === 'status-change'
        ? 'Status Change'
        : armed === 'bulk-edit'
          ? 'Bulk Update'
          : 'Bulk SKU'

  /**
   * Why Create Ticket is disabled, in the operator's terms — null when it isn't.
   *
   * Four different situations used to share one message: "runs on the server —
   * turn on desktop execution in Monitor". That is only true for the last of
   * them, and it sent people to change a setting that was already correct.
   */
  const disabledReason = useMemo(() => {
    if (canProcess) return null

    const key = platform.toLowerCase()

    if (!support) return `Checking where ${platform} claims run…`

    if (!support.routingKnown) {
      return (
        `Could not check where ${platform} claims run — TrackVid was unreachable. ` +
        'Press Refresh to try again.'
      )
    }

    if (!support.runners.includes(key)) {
      return `This app has no ${platform} claim runner, so ${platform} claims can only be filed on the server.`
    }

    return `${platform} claims run on the server for this company. Turn on desktop execution for ${platform} in Monitor to file them here.`
  }, [canProcess, platform, support])
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  /**
   * What the table shows: this page's rows, narrowed by the column filters.
   * Everything below reads THIS rather than `rows`, so a filtered-out row
   * cannot be select-alled, counted or filed.
   */
  /*
   * THE PAGES AFTER THIS ONE, loaded on demand by a header value list.
   *
   * Scrolling to the bottom of a column's value list fetches the next page of
   * the SAME query, so its values join the list. Keyed by the query: a change
   * of tab, status, search or dates makes what was loaded belong to another
   * question, and it is ignored rather than cleared in an effect.
   */
  const listKey = JSON.stringify(listQuery)
  const extraCurrent = extra.key === listKey
  const extraRows = extraCurrent ? extra.rows : NO_EXTRA_PAGES.rows
  const lastLoadedPage = extraCurrent ? extra.lastPage : page
  const loadingMorePages = extraCurrent && extra.loading
  const hasMorePages = lastLoadedPage < totalPages

  /** This page and every page loaded after it — what a selection is looked up in. */
  const loadedRows = useMemo(() => [...(rows ?? []), ...extraRows], [rows, extraRows])

  const loadNextPage = async (): Promise<void> => {
    if (!hasMorePages || loadingMorePages) return

    const key = listKey
    const next = lastLoadedPage + 1

    setExtra(current =>
      current.key === key
        ? { ...current, loading: true }
        : { key, rows: [], lastPage: page, loading: true }
    )

    const response = await listCms({ ...listQuery, page: next })

    setExtra(current => {
      // The operator moved to another tab or filter while this was in flight.
      if (current.key !== key) return current
      if (!response.success) return { ...current, loading: false }

      const known = new Set([...(rows ?? []), ...current.rows].map(row => row.id))

      return {
        key,
        rows: [...current.rows, ...response.data.rows.filter(row => !known.has(row.id))],
        lastPage: next,
        loading: false
      }
    })

    if (!response.success) toast.error(response.error.message)
  }

  const columnFilterCount = Object.values(columnFilters).filter(isColumnFiltered).length

  // The Filter dialog first, then the header row — the header's value lists are
  // built from what the dialog lets through, so neither offers a dead value.
  const dialogRows = useMemo(() => applyFilters(rows ?? [], filters), [rows, filters])
  // Every loaded page, for the header filters: a value picked from page 3 has
  // to be able to show its row.
  const dialogLoadedRows = useMemo(() => applyFilters(loadedRows, filters), [loadedRows, filters])
  /**
   * Unfiltered, the table is this page — as the pager says. Once a header
   * filter narrows it, it is the matches across every page loaded so far.
   */
  const visibleRows = useMemo(
    () =>
      columnFilterCount > 0 ? applyColumnFilters(dialogLoadedRows, columnFilters) : dialogRows,
    [columnFilterCount, dialogLoadedRows, dialogRows, columnFilters]
  )

  /**
   * One header filter changed. A row it hides must not stay ticked: Create
   * Ticket would file it, and nobody can see it to untick it — the same rule
   * the Filter dialog applies on Apply.
   */
  const changeColumnFilter = (field: keyof CmsRow, next: ColumnFilter): void => {
    const updated = withColumnFilter(columnFilters, field, next)
    const narrowed = Object.values(updated).some(isColumnFiltered)
    const shown = new Set(
      (narrowed ? applyColumnFilters(dialogLoadedRows, updated) : dialogRows).map(row => row.id)
    )

    setColumnFilters(updated)
    setSelected(current =>
      [...current].every(id => shown.has(id))
        ? current
        : new Set([...current].filter(id => shown.has(id)))
    )
  }
  const filterCount = activeFilterCount(filters)
  const filterChips = useMemo(() => filterSummary(filters, rows ?? []), [filters, rows])

  /**
   * Export — the rows on screen, after the Filter modal's narrowing, to .xlsx.
   * One sheet per platform, columns from its Create Claim form, no images.
   */
  const [exporting, setExporting] = useState(false)

  const exportVisible = async (): Promise<void> => {
    if (visibleRows.length === 0) return

    setExporting(true)
    // This page and every later page the header filters loaded — a filtered
    // table can show rows from all of them.
    const pages = Array.from({ length: lastLoadedPage - page + 1 }, (_, index) => page + index)
    const response = await exportClaimsXlsx(
      listQuery,
      visibleRows.map(row => row.id),
      pages
    )
    setExporting(false)

    if (!response.success) {
      // Closing the save dialog is not a failure.
      if (response.error.message !== 'Cancelled') toast.error(response.error.message)

      return
    }

    const { rows: written, sheets, missing } = response.data

    toast.success(
      `Exported ${written} claim${written === 1 ? '' : 's'}` +
        (sheets > 1 ? ` on ${sheets} sheets` : '') +
        (missing > 0 ? ` — ${missing} had left this page, refresh to include them` : '')
    )
  }

  /**
   * The rows on this page that could actually be filed — see
   * `selectionBlockReason`. Select-all and the "all ticked?" state are both
   * measured against these rather than every row, so a page where half the
   * claims are missing a POB ID or an account still reports itself honestly
   * instead of never reaching a ticked select-all box.
   */
  const selectableRows = useMemo(() => visibleRows.filter(rowEligible), [visibleRows, rowEligible])

  /**
   * The AWBs the copy button would put on the clipboard.
   *
   * Ticked rows when there are any, otherwise everything on screen — the two
   * things "these" ever means while looking at this table. Filtered rows only:
   * copying what a filter is hiding would be copying what is not being looked
   * at.
   */
  const copyable = useMemo(
    () =>
      visibleRows
        .filter(row => (selected.size > 0 ? selected.has(row.id) : true))
        .map(row => row.returnAwb)
        .filter(Boolean),
    [visibleRows, selected]
  )
  const [copied, setCopied] = useState(false)

  const copyAwbs = useCallback(async () => {
    if (copyable.length === 0) return

    // Through the MAIN process: `navigator.clipboard` is refused here — this
    // renderer is not a secure context in the browser's sense, so the write
    // permission is denied and the only sign of it is the failure itself.
    const response = await copyToClipboard(copyable.join(','))

    if (!response.success) {
      toast.error(`Could not copy: ${response.error.message}`)

      return
    }

    setCopied(true)
    toast.success(`${copyable.length} AWB(s) copied`)
    // Long enough to register as a confirmation, short enough that the icon is
    // back to its normal self before the next glance.
    setTimeout(() => setCopied(false), 1500)
  }, [copyable, toast])

  const allOnPageSelected = useMemo(
    () => selectableRows.length > 0 && selectableRows.every(row => selected.has(row.id)),
    [selectableRows, selected]
  )

  const toggleAll = (): void => {
    setSelected(allOnPageSelected ? new Set() : new Set(selectableRows.map(row => row.id)))
  }

  const toggleOne = (id: string): void => {
    setSelected(current => {
      const next = new Set(current)

      if (next.has(id)) next.delete(id)
      else next.add(id)

      return next
    })
  }

  /**
   * Works out which marketplace login each unmapped claim belongs to.
   *
   * Takes NO selection, deliberately. Its input is every Pending or Failed to
   * Proceed claim on this platform that names no account — and a claim with no
   * account is not selectable in the first place, so a checkbox-driven version
   * of this could never reach a single row it is for. The backend decides the
   * set; this only says which platform.
   */
  /**
   * MAPPING IS NOT A SEPARATE ERRAND ANY MORE.
   *
   * "Map Username" ran its own sweep, wrote the account and discarded the POB
   * the sweep had just found — which is half of what an AJIO claim needs. The
   * same question is now Refill Data's Account field, and its "Use APIs"
   * toggle runs the same probe and writes both.
   */
  /**
   * Reads every eligible claim's articles from AJIO in one pass.
   *
   * Takes no selection either — its input is every AJIO claim carrying an
   * account and a POB, which the backend decides. It WRITES NOTHING: what comes
   * back is a review the operator saves, because a return with several articles
   * has no automatic right answer.
   */
  const sweepSkus = useCallback(async () => {
    if (sweeping) {
      setSweepOpen(true)

      return
    }

    // The sweep reads articles through the accounts' own sessions, one page per
    // account, so it is gated on all of them like the mapping run.
    if (!(await ensureLiveSessions({ platform }, 'SKU sweep'))) return

    setSweepOpen(true)
    setSweeping(true)

    const response = await runSkuSweep(platform, [...selected])

    setSweeping(false)
    setArmed(null)
    setSelected(new Set())

    // Only the failure is toasted — the result is a table in the window, which
    // is where the operator now is.
    if (!response.success) {
      setSweepOpen(false)
      toast.error(response.error.message)
    }
  }, [platform, sweeping, selected, toast, ensureLiveSessions])

  /**
   * Arms the SKU sweep — or reopens the last one, if it is still unsaved.
   *
   * A finished sweep holds a review nobody has stored, and re-running would
   * spend another browser session rebuilding rows the main process still has,
   * throwing away every choice already made on the multi-article ones. So the
   * button goes back to that window rather than starting over; Cancel in the
   * window is how an operator says they are done with it.
   */
  const armSweep = useCallback(async () => {
    const existing = await skuSweepStatus()

    if (
      existing.success &&
      existing.data.progress?.running !== true &&
      existing.data.result?.platform === platform.toLowerCase() &&
      existing.data.result.rows.length > 0
    ) {
      setSweepOpen(true)

      return
    }

    setSelected(new Set())
    setArmed('sku-sweep')
  }, [platform])

  /**
   * Check TAT — ask the marketplace whether the ticked claims can still be
   * filed, and move the ones that cannot to Failed to Proceed.
   *
   * A read for most rows and a write for the dead ones, so it acts only on what
   * was ticked. The list is reloaded afterwards because the rows it moved have
   * left this tab.
   */
  const runTatCheck = useCallback(async () => {
    const claims = [...selected]
      .map(id => loadedRows.find(row => row.id === id))
      .filter((row): row is CmsRow => Boolean(row?.returnAwb))
      .map(row => ({ cmsId: row.id, awb: row.returnAwb }))

    if (claims.length === 0) return

    // The rows' own accounts: the check is put to the account each claim names.
    const accounts = [...selected].flatMap(id => {
      const row = loadedRows.find(entry => entry.id === id)

      return row?.username ? [{ platform: row.platform, username: row.username }] : []
    })

    if (!(await ensureLiveSessions({ accounts }, 'Check TAT'))) return

    setTatTotal(claims.length)
    setTatRun(run => run + 1)
    setTatOpen(true)
    setCheckingTat(true)

    const response = await checkClaimTat(platform, claims)

    setCheckingTat(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { checked, expired, within, unknown, moved } = response.data

    // Said plainly, including the rows nothing was written for — "could not
    // tell" is the answer an operator most needs to see, because those claims
    // are still sitting in Pending.
    if (expired > 0) {
      toast.success(
        `TAT checked on ${checked} claim${checked === 1 ? '' : 's'}: ` +
          `${moved} moved to Failed to Proceed, ${within} still claimable` +
          (unknown > 0 ? `, ${unknown} could not be checked` : '')
      )
    } else {
      toast.success(
        `TAT checked on ${checked} claim${checked === 1 ? '' : 's'}: all still claimable` +
          (unknown > 0 ? ` (${unknown} could not be checked)` : '')
      )
    }

    setSelected(new Set())
    await load()
  }, [platform, loadedRows, selected, load, toast, ensureLiveSessions])

  /**
   * Refill Data — asks the marketplace for the blanks on the ticked rows.
   *
   * Fills what is missing and reports what it kept; only the claim status
   * overrides a value already there. The rows go with the call, because the
   * operator ticked what is on screen.
   */
  const refillData = useCallback(async (statusOnly = false) => {
    // Status Change is the same run asking one question: where the filed
    // ticket stands. It never spends a row's refill budget — "still In Review"
    // is an answer, not a failed ask — and "Use APIs" is AJIO's blanks switch.
    const fields: RefillField[] = statusOnly ? ['statusChange'] : refillFields
    const label = statusOnly ? 'Status Change' : 'Refill Data'
    const claims = [...selected]
      .map(id => loadedRows.find(row => row.id === id))
      .filter((row): row is CmsRow => Boolean(row?.returnAwb))
      .map(row => ({ cmsId: row.id, awb: row.returnAwb }))

    if (claims.length === 0 || fields.length === 0) return

    // EVERY login on the platform, not the rows' accounts: a refill asks each
    // account in turn which one owns the AWB, so one dead session among them
    // stalls the sweep however healthy the row's own account is.
    if (!(await ensureLiveSessions({ platform }, label))) return

    setRefillTotal(claims.length)
    setRefillRun(run => run + 1)
    setRefillOpen(true)
    setRefilling(true)

    const response = statusOnly
      ? await runRefill(platform, claims, fields, false, false)
      : await runRefill(platform, claims, fields, refillUseApis)

    setRefilling(false)
    setArmed(null)
    setSelected(new Set())

    if (!response.success) {
      setRefillOpen(false)
      toast.error(response.error.message)

      return
    }

    const { filled, untouched, notFound, failed, shortcut } = response.data

    const outcome =
      `${statusOnly ? 'Status updated on' : 'Refilled'} ${filled} claim${filled === 1 ? '' : 's'}` +
      (untouched > 0 ? `, ${untouched} already had what the marketplace says` : '') +
      // Said separately from "unchanged", and said first among the bad news: a
      // row no account admits to is the one somebody has to look at.
      (notFound > 0 ? `, ${notFound} not found on any account` : '') +
      (failed > 0 ? `, ${failed} failed` : '') +
      // Worth saying: nothing was asked, so nothing was verified.
      (shortcut ? ' — one login on this platform, so the account was written without asking' : '')

    // A run that wrote nothing and found nothing is not a success.
    if (filled === 0 && (notFound > 0 || failed > 0)) toast.error(outcome)
    else toast.success(outcome)

    await load()
  }, [platform, loadedRows, selected, refillFields, refillUseApis, load, toast, ensureLiveSessions])

  /**
   * Writes one field to one value across every ticked row.
   *
   * THE SERVER DECIDES WHAT `field` MEANS. It is an allowlist key, not a
   * document path, so this cannot name a column the backend did not agree to
   * expose — and the value is validated there too, against the same vocabulary
   * the dialog offered.
   *
   * The selection is CLEARED and the tool disarmed on success: leaving forty
   * rows ticked under a tool that has just rewritten them invites a second
   * pass nobody meant.
   */
  /**
   * AJIO's six-side rebuild, offered in the same dialog but run HERE: each row
   * downloads screenshots, draws a PDF and uploads it, which the server's
   * one-field bulk write cannot do. Three at a time — every row is several
   * image downloads plus an upload, and forty at once would starve the list's
   * own refresh.
   */
  const rebuildSixSide = useCallback(async () => {
    const targets = loadedRows.filter(
      row => selected.has(row.id) && row.platform.toLowerCase() === 'ajio'
    )

    if (targets.length === 0) {
      toast.error('None of the selected claims is an AJIO claim.')

      return
    }

    setBulkEditing(true)

    const results: SixSideRebuildResult[] = []

    let next = 0

    const worker = async (): Promise<void> => {
      while (next < targets.length) {
        const row = targets[next++] as CmsRow

        results.push(await rebuildSixSidePdf(row))
      }
    }

    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()))

    setBulkEditing(false)

    const done = results.filter(result => result.ok).length
    const failed = results.filter(result => !result.ok)

    // Grouped by cause, the cause first — that is the part someone can act on.
    const byReason = new Map<string, number>()

    for (const result of failed) {
      const reason = result.reason ?? 'Unknown error'

      byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
    }

    const causes = [...byReason.entries()].sort((a, b) => b[1] - a[1])
    const headline = `Six-side PDF rebuilt on ${done} of ${targets.length} claim${targets.length === 1 ? '' : 's'}`

    if (failed.length === 0) {
      toast.success(headline)
    } else {
      const [topReason, topCount] = causes[0] as [string, number]

      ;(done === 0 ? toast.error : toast.info)(`${headline} · ${topCount}× ${topReason}`)
      notifications.add(
        'error',
        `Six-side PDF: ${failed.length} claim${failed.length === 1 ? '' : 's'} not rebuilt`,
        causes.map(([reason, count]) => `${count}× ${reason}`).join('\n')
      )
    }

    setBulkEditOpen(false)
    setSelected(new Set())
    setArmed(null)
    await load()
  }, [loadedRows, selected, toast, notifications, load])

  const applyBulkEdit = useCallback(
    async (field: string, value: string) => {
      if (field === SIX_SIDE_REBUILD_FIELD) {
        await rebuildSixSide()

        return
      }

      setBulkEditing(true)

      const response = await bulkUpdateClaims([...selected], field, value)

      setBulkEditing(false)

      if (!response.success) {
        toast.error(response.error.message)

        return
      }

      const { modified, matched, skipped } = response.data

      // "12 of 40" rather than "12": the other 28 already held the value, and
      // an operator who selected 40 deserves to know that rather than wonder
      // what was dropped.
      toast.success(
        `Updated ${modified} of ${matched} claim${matched === 1 ? '' : 's'}` +
          (skipped.length > 0 ? ` · skipped ${skipped.join(', ')}` : '')
      )

      setBulkEditOpen(false)
      setSelected(new Set())
      setArmed(null)
      await load()
    },
    [selected, toast, load, rebuildSixSide]
  )

  const createTickets = useCallback(async () => {
    // The checkbox already refuses these, but a row can change underneath a
    // selection — the list refetches every 30s, and a claim another operator
    // started is "Running" by the time this fires. Filtering again here is the
    // difference between dropping it and filing a duplicate ticket.
    const ids = [...selected].filter(id => {
      const row = loadedRows.find(entry => entry.id === id)

      return row === undefined || isRowSelectable(row, selectionOptions)
    })

    if (ids.length === 0) return
    setWorking(true)

    // Every account the selection files from must have a live session BEFORE
    // anything starts — the rows' own accounts, since that is what each claim
    // files through. `directApiCall: false` because a claim is the one action
    // here whose flow might sign in by itself; see the registry.
    const accounts = ids.flatMap(id => {
      const row = loadedRows.find(entry => entry.id === id)

      return row ? [{ platform: row.platform, username: row.username }] : []
    })

    if (!(await ensureLiveSessions({ accounts }, 'Create Ticket', { directApiCall: false }))) {
      setWorking(false)

      return
    }

    // ONE call for the whole selection. The loop used to live here, which meant
    // it ran outside the automation lock — a Create Ticket pressed during a
    // bulk run opened a second marketplace browser — and every claim launched
    // its own Chrome. Both are properties of the batch, so the batch belongs in
    // the main process. Progress arrives on claim-queue:batch-progress.
    const response = await processClaims(
      ids.map(id => {
        const row = loadedRows.find(entry => entry.id === id)

        return {
          cmsId: id,
          ...(row?.platform ? { platform: row.platform } : {}),
          ...(row?.returnAwb ? { awbNumber: row.returnAwb } : {}),
          // Lets the main process group the batch by account, so one
          // browser covers every claim for the same login.
          ...(row?.username ? { username: row.username } : {})
        }
      })
    )

    setWorking(false)

    if (!response.success) {
      toast.error(response.error.message)
    } else {
      const { done, failed, failures } = response.data

      if (done > 0) toast.success(`Created ${done} ticket${done === 1 ? '' : 's'}`)
      if (failed > 0) toast.error(`${failed} failed — ${failures[0] ?? ''}`)
    }

    await load()
  }, [selected, loadedRows, load, toast, selectionOptions, ensureLiveSessions])

  return (
    <>
      {/* The run belongs to the main process, so this window only watches it.
          Minimising hands it to the background panel in the corner — the same
          place a Create Ticket batch lives — and the run never notices. */}
      {/* Opened from the icon in the Seller SKU cell. Reads the return's
          articles off AJIO and lets the operator pick the right one. */}
      <SkuPickerModal row={skuRow} onClose={() => setSkuRow(null)} onApplied={() => void load()} />
      <TicketEditModal
        key={ticketEditRow?.id ?? 'closed'}
        row={ticketEditRow}
        onClose={() => setTicketEditRow(null)}
        onSaved={ticket => {
          toast.success(`Ticket ${ticket} saved — the claim is In Review`)
          setTicketEditRow(null)
          // The row leaves Pending / Failed to Proceed, so the tab counts move too.
          void load()
        }}
      />
      <TicketThreadModal
        key={ticketTarget ? `${ticketTarget.platform}:${ticketTarget.username}:${ticketTarget.ticket}` : 'closed'}
        target={ticketTarget}
        onClose={() => setTicketTarget(null)}
      />

      {/* The bulk counterpart: one pass over every eligible claim, then a
          review. Minimising hands it to the corner panel like the others. */}
      {/* AJIO's own View Reports screen, in front of the claims it explains. */}
      <MasterDataModal open={masterOpen} onClose={() => setMasterOpen(false)} />

      {/* A rejection export, worked down one ticket at a time. */}
      <RefillFieldsModal
        key={`refill-fields-${platform}`}
        open={refillFieldsOpen}
        platform={platform}
        onStart={(fields, useApis) => {
          setRefillFields(fields)
          setRefillUseApis(useApis)
          setRefillFieldsOpen(false)
          setSelected(new Set())
          setArmed('refill')
        }}
        onClose={() => setRefillFieldsOpen(false)}
      />

      <RefillProgressModal
        key={refillRun}
        open={refillOpen}
        total={refillTotal}
        onClose={() => setRefillOpen(false)}
      />

      <ClaimFilterModal
        key={filterRun}
        open={filterOpen}
        rows={rows ?? []}
        filters={filters}
        onApply={next => {
          setFilters(next)
          setFilterOpen(false)
          // A row that is no longer on screen must not stay ticked: Create
          // Ticket would file it, and nobody can see it to untick it.
          const visible = new Set(applyFilters(rows ?? [], next).map(row => row.id))

          setSelected(current => new Set([...current].filter(id => visible.has(id))))
        }}
        onClose={() => setFilterOpen(false)}
      />

      <TatCheckModal key={tatRun} open={tatOpen} total={tatTotal} onClose={() => setTatOpen(false)} />

      <ReClaimModal open={reClaimOpen} onClose={() => setReClaimOpen(false)} />
      <BulkEditModal
        open={bulkEditOpen}
        count={selected.size}
        platform={platform}
        saving={bulkEditing}
        onSubmit={(field, value) => void applyBulkEdit(field, value)}
        onClose={() => setBulkEditOpen(false)}
      />

      <SkuSweepModal
        open={sweepOpen}
        platform={platform}
        onMinimise={() => setSweepOpen(false)}
        onClose={() => setSweepOpen(false)}
        onSaved={() => void load()}
      />

      {/* One column with one rhythm, like every other migrated screen. The
          modals above render nothing inline, so they stay outside it.
          gap-4 rather than gap-6: the standalone header row this used to
          separate is gone — see the filter panel. */}
      {/* `trackvid-table-fill` makes this column exactly as tall as the
          content area and gives every pixel the controls above do not use to
          the table, which then scrolls under a heading that stays put. The
          shared class and the reason are in styles/behaviour.css. */}
      <div className='ts-layout-content-height-fixed trackvid-table-fill flex flex-col gap-4'>
      <div className="trackvid-table-scroll-host flex min-is-0 flex-col gap-4">
        {/* One filter panel instead of four loose bands.
            Search, dates and the action are one row because they are one
            question — "which claims, and do something with them". The two tab
            rows are the same question at a coarser grain, so they sit in the
            same surface, separated by a rule rather than by empty space. */}
        {/*
          ONE CONTROL HEIGHT ACROSS THE ROW. Search, dates and every button
          are the small size — the same box, the same 13px text — so the row
          reads as one toolbar rather than a tall field beside short buttons.
        */}
        {/* shrink-0: this column is exactly the window's height and a flex
            item shrinks by default, so a tall table would squeeze this card
            and clip its tab rows. It keeps its size; the table takes the rest. */}
        <Card className='flex shrink-0 flex-col gap-3 p-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              size='sm'
              value={search}
              placeholder='Search AWB, ticket or order…'
              className='min-w-56 flex-1'
              onChange={event => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />

            {/* The same control the admin panel filters by — presets on the
                left, one grid on the right — so an operator comparing the two
                screens is not translating between two different widgets. */}
            <DateRangePicker
              size='sm'
              className='shrink-0'
              value={range}
              onChange={next => {
                setRange(next)
                setPage(1)
              }}
            />

            {/* Shown whenever this platform has a claim with no account, on
                every tab, with no selection involved — the rows it works on are
                precisely the ones that CANNOT be selected, so putting it behind
                a selection would hide it from its own job. It carries the count
                because that is the reason to press it, and it goes away at zero
                rather than sitting there offering to do nothing. */}
            {/* A READ, so no arming and no selection: it answers "what does
                AJIO actually hold for this window", which is the question
                behind most failed-claim investigations and the one that
                otherwise means leaving for the seller portal. */}
            {devMode && armed === null && platform.toLowerCase() === 'ajio' && (
              <Button size='sm' variant="secondary" onClick={() => setMasterOpen(true)}>
                Check master data
              </Button>
            )}

            {/* ARMED, then run. The first press does not start anything: it
                switches the checkbox column to this tool's eligibility and
                turns the button into "Run …". Selecting nothing and pressing
                Run does nothing, which is the point — a bulk write over every
                eligible row is still one Select-all away, but it is now a
                decision somebody made rather than a side effect of a click. */}
            {/* THE "Map Username" BUTTON STOOD HERE.
                Mapping is not a separate errand any more: it is what Refill
                Data does for the Account field, and doing it from two places
                meant two ways to answer one question — one of which wrote the
                account and threw away the POB it had just found. Refill Data's
                "Use APIs" toggle is the same sweep, and it writes both. */}

            {/* AJIO only, and only when there is something to read. A row needs
                an account and a POB before AJIO can be asked anything about it,
                so this button follows Map Username rather than competing with
                it. */}
            {devMode && armed === null && (sweepable > 0 || sweeping) && (
              <Button size='sm'
                variant="secondary"
                loading={sweeping}
                onClick={() => void armSweep()}
              >
                Bulk SKU{sweepable > 0 ? ` (${sweepable})` : ''}
              </Button>
            )}

            {armed !== null && (
              <>
                <Button size='sm'
                  variant="ghost"
                  onClick={() => {
                    setArmed(null)
                    setSelected(new Set())
                  }}
                >
                  Cancel
                </Button>

                {/* The grid shows 25 rows; the eligible set is company-wide.
                    Without this, "all of them" means paging through the company
                    and running a separate pass per page. */}
                {allEligibleIds.length > selected.size && (
                  <Button size='sm'
                    variant="ghost"
                    onClick={() => setSelected(new Set(allEligibleIds))}
                  >
                    Select all {allEligibleIds.length}
                  </Button>
                )}

                <Button size='sm'
                  loading={armed === 'refill' || armed === 'status-change' ? refilling : sweeping}
                  disabled={selected.size === 0}
                  onClick={() => {
                    if (armed === 'refill') void refillData()
                    else if (armed === 'status-change') void refillData(true)
                    else void sweepSkus()
                  }}
                >
                  Run {armedLabel} ({selected.size})
                </Button>
              </>
            )}

            {/* One action, shown only when rows are selected — and only on a tab
                where selecting means anything. Selection is cleared on every
                refetch, but a tab switch and its fetch are not simultaneous, and
                for that moment the button would offer to file rows that are
                already at the marketplace and no longer on screen. */}
            {/* Check TAT — only where the marketplace answers the question
                (Meesho), and only with rows ticked: it moves what it finds
                expired to Failed to Proceed, which is a write. It sits beside
                Create Ticket because it answers the question that decides
                whether pressing that is worth anything. */}
            {armed === null && canSelect && selected.size > 0 && hasTatCheck(platform) && (
              <Tooltip label="Ask the marketplace whether these claims are still inside their claim window. Expired ones move to Failed to Proceed.">
                <Button size='sm'
                  variant="secondary"
                  loading={checkingTat}
                  onClick={() => void runTatCheck()}
                >
                  Check TAT ({selected.size})
                </Button>
              </Tooltip>
            )}

            {armed === null && canSelect && selected.size > 0 && (
              // Wrapped rather than given a `title`: a disabled button receives
              // no pointer events, so the explanation never appeared at the one
              // moment it was needed.
              <Tooltip label={disabledReason}>
                <Button size='sm'
                  loading={working}
                  disabled={!canProcess}
                  onClick={() => void createTickets()}
                >
                  Create Ticket ({selected.size})
                </Button>
              </Tooltip>
            )}

            <div className='flex flex-wrap items-center gap-2'>

              <>
                {/* AJIO only. It is the one marketplace whose SPF claims are raised
                    in bulk from a spreadsheet — the others are filed per claim from
                    the table below, and offering this there would promise something
                    that does not exist. */}
                {/* Myntra's, because `createFwTicket` is Myntra's — a rejected SPF
                    claim there can be reopened with an argument and the same
                    proofs, and no other platform here exposes anything like it. */}
                {platform === 'Myntra' && (
                  <Button size='sm' variant="secondary" onClick={() => setReClaimOpen(true)}>
                    Re-Claim
                  </Button>
                )}
                {/* Refill Data. In the header rather than the filter row because it
                    starts with a QUESTION — which fields — and only then touches the
                    table; the filter row's controls all act on what is already
                    ticked. Hidden on platforms with nothing to refill — Nykaa has
                    no per-claim account. On AJIO it reads this machine's master
                    data backup rather than the seller portal. */}
                {devMode && canRefillBlanks(platform) && (
                  <Button size='sm' variant="secondary" onClick={() => setRefillFieldsOpen(true)}>
                    Refill Data
                  </Button>
                )}
                {/* Status Change — where each filed ticket now stands. Its own
                    button rather than a box in Refill Data's dialog: it asks
                    about different rows (filed, not Pending) and has only one
                    question, so it arms the table straight away. */}
                {canRefillStatus(platform) && (
                  <Button size='sm'
                    variant={armed === 'status-change' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setArmed(armed === 'status-change' ? null : 'status-change')
                      setSelected(new Set())
                    }}
                  >
                    {armed === 'status-change' ? 'Cancel status change' : 'Status Change'}
                  </Button>
                )}
                {/* Bulk Update — set one field to one value across the ticked rows.
                    ARMS the table rather than opening a dialog: the rows are chosen
                    first, so the dialog can say how many it is about to rewrite,
                    which is the number worth reading twice. Offered without
                    developer mode, like Status Change. */}
                <Button size='sm'
                  variant={armed === 'bulk-edit' ? 'primary' : 'secondary'}
                  onClick={() => {
                    setArmed(armed === 'bulk-edit' ? null : 'bulk-edit')
                    setSelected(new Set())
                  }}
                >
                  {armed === 'bulk-edit' ? 'Cancel update' : 'Bulk Update'}
                </Button>
                {armed === 'bulk-edit' && selected.size > 0 && (
                  <Button size='sm' onClick={() => setBulkEditOpen(true)}>
                    Edit {selected.size} selected
                  </Button>
                )}
                {platform === 'Ajio' && (
                  <Button size='sm' variant="secondary" onClick={() => setBulkOpen(true)}>
                    NDR/DDR Bulk Claim
                  </Button>
                )}
                {platform === 'Nykaa' && (
                  <Button size='sm' variant="secondary" onClick={() => setNykaaDdrOpen(true)}>
                    DDR Bulk Claim
                  </Button>
                )}
                <Button
                  size='sm'
                  variant='secondary'
                  loading={loading}
                  icon={<i className='tabler-refresh' />}
                  onClick={() => void load()}
                >
                  Refresh
                </Button>
              </>
                    </div>
          </div>

          <Divider />

          {/* Platform chips wrap; Export stays at the right of the first line. */}
          <div className='flex items-start gap-3'>
          <div className='flex min-is-0 flex-1 flex-wrap gap-1.5'>
            {PLATFORM_TABS.map(name => (
              <FilterTab
                key={name}
                label={name}
                logo
                count={counts?.platformCounts[name]}
                active={platform === name}
                onClick={() => {
                  setPlatform(name)
                  // Each platform has its own columns; a filter on one that
                  // the next tab does not show would hide rows invisibly.
                  setColumnFilters({})
                  // The status tab is NOT reset. An operator working through
                  // Pending claims keeps their place when they move between
                  // marketplaces; `resolveActiveStatus` shows "All" only if the
                  // new platform has no such tab, and remembers the choice for
                  // when they switch back.
                  //
                  // The PAGE is reset: page 2 of one platform says nothing
                  // about another, and staying there shows an empty table.
                  setPage(1)
                }}
              />
            ))}
          </div>

            <Tooltip label='Export the claims on screen to Excel — no images' className='shrink-0'>
              <Button
                size='sm'
                variant='secondary'
                loading={exporting}
                disabled={visibleRows.length === 0}
                icon={<i className='tabler-file-spreadsheet' />}
                onClick={() => void exportVisible()}
              >
                Export
              </Button>
            </Tooltip>
          </div>

          <Divider />

          {/* Two parts: the status chips, which may wrap, and the filter
              controls, which stay at the right of the first line instead of
              wrapping onto a line of their own. */}
          <div className='flex items-start gap-3'>
          <div className='flex min-is-0 flex-1 flex-wrap items-center gap-1.5'>
            {statusTabs.map(({ value, label, dot }) => (
              <FilterTab
                key={value}
                label={label}
                dot={dot}
                count={counts?.statusCounts[value]}
                active={activeStatus === value}
                onClick={() => {
                  setStatus(value)
                  setPage(1)
                }}
              />
            ))}
          </div>

            {/* Column filters over the rows already on screen. Developer mode,
                like the other tools on this page: it narrows what is displayed
                without changing the tab counts, and the two can disagree —
                fine when you know why, confusing when you do not. */}
            {devMode && (
              <div className='flex shrink-0 items-center gap-1.5'>
                {filterChips.map(chip => (
                  <Chip key={chip} size='small' variant='outlined' label={chip} />
                ))}

                {filterCount > 0 && (
                  <Chip
                    size='small'
                    variant='tonal'
                    color='secondary'
                    clickable
                    label='Clear filter'
                    onClick={() => setFilters({})}
                    sx={{ blockSize: TAB_BLOCK_SIZE }}
                  />
                )}

                {/* A chip, not a button: it sits in the row of status chips and
                    has to be their height, not a toolbar button's. */}
                <Chip
                  size='small'
                  variant='tonal'
                  color='secondary'
                  clickable
                  icon={<i className='tabler-filter text-base' />}
                  label={`Filter${filterCount > 0 ? ` (${filterCount})` : ''}`}
                  disabled={(rows?.length ?? 0) === 0}
                  onClick={() => {
                    setFilterRun(run => run + 1)
                    setFilterOpen(true)
                  }}
                  sx={{ blockSize: TAB_BLOCK_SIZE }}
                />
              </div>
            )}
          </div>
        </Card>

        {error && (
          <Alert severity='error' role='alert'>
            {error}
          </Alert>
        )}

        {/*
          A CARD THAT SCROLLS SIDEWAYS, and the page scrolls down.

          This was one box owning both axes, because the old shell pinned the
          window and gave each screen its own scrolling area. The ported shell
          scrolls the document instead, so a `flex-1` box here has no height to
          fill and the table's own width would push the whole window out.
        */}
        <Card className="trackvid-table-scroll">
          {/* The tick box and the platform stay put while the other twenty
              columns scroll under them — see styles/table-chrome.css. The
              attribute says whether there is a tick box, because that decides
              which column the identity is and how far in it sits. */}
          <table
            className={`${tableStyles.table} pinned-start`}
            data-has-select={canSelect ? 'true' : 'false'}
          >
            {/* z-10 is not decoration. A sticky header has `z-index: auto`, so
                anything POSITIONED in the body paints over it as it scrolls
                past — and every row's checkbox is a `relative` span (see
                Checkbox), which is why ticked rows slid over the header row.
                The background is repeated on each cell because a `thead`
                background does not reliably paint under a sticky `th` with
                `border-collapse`, leaving the text to scroll through. */}
            {/* NOT STICKY ANY MORE. A sticky head sticks to its nearest
                scrolling ancestor; with the document scrolling that is the
                window, where it would collide with the navbar that is already
                pinned there. Monitor's tables do not stick either. */}
            <thead>
              <tr>
                {canSelect && (
                  <th>
                    <Checkbox
                      ariaLabel="Select all fileable claims on this page"
                      disabled={selectableRows.length === 0}
                      checked={allOnPageSelected}
                      // Some but not all: a plain box here would claim the page
                      // is untouched when rows are already ticked.
                      indeterminate={selected.size > 0 && !allOnPageSelected}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                {columns.map(column => (
                  <th
                    key={column.key}
                    align={column.align}
                    className='whitespace-nowrap'
                  >
                    {/* `align` does nothing to a flex row, so a right-aligned
                        column also justifies its heading to the end. */}
                    <span className={classNames('flex items-center gap-1', column.align === 'right' && 'justify-end')}>
                      {column.label}
                      {/* The AWBs of what is on screen, as one comma-separated
                          string — which is what every other tool here takes:
                          the backup's look-up box, a spreadsheet filter, a
                          message to somebody asking "which ones". Ticked rows
                          when there are any, the whole page when there are not,
                          because those are the two things "these" ever means. */}
                      {devMode && column.key === 'returnAwb' && visibleRows.length > 0 && (
                        <Tooltip label={`Copy ${copyable.length} AWB(s)`}>
                          <IconButton
                            size='small'
                            aria-label='Copy these AWB numbers'
                            onClick={() => void copyAwbs()}
                            className='-mlb-1'
                          >
                            <i className={classNames(copied ? 'tabler-check' : 'tabler-copy', 'text-base')} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
              {/* Search and value filter under every heading — over the rows on
                  this page, not the server. Resources holds buttons, not data. */}
              <tr>
                {canSelect && (
                  <th>
                    {columnFilterCount > 0 && (
                      <Tooltip label='Clear column filters'>
                        <IconButton
                          size='small'
                          aria-label='Clear column filters'
                          onClick={() => setColumnFilters({})}
                        >
                          <i className='tabler-filter-off text-base' />
                        </IconButton>
                      </Tooltip>
                    )}
                  </th>
                )}
                {columns.map(column => (
                  <th key={column.key} className='font-normal'>
                    {column.key === 'resources' ? null : (
                      <ColumnFilterCell
                        field={column.key}
                        label={column.label}
                        rows={dialogLoadedRows}
                        filters={columnFilters}
                        more={{
                          loadedPages: lastLoadedPage,
                          totalPages,
                          hasMore: hasMorePages,
                          loading: loadingMorePages,
                          onLoadMore: () => void loadNextPage()
                        }}
                        onChange={next => changeColumnFilter(column.key as keyof CmsRow, next)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => (
                <tr
                  key={row.id}
                  /* The pinned cells cannot inherit a translucent row tint, so
                     they re-apply it over an opaque base and read the state
                     from here rather than from the class list. */
                  data-selected={selected.has(row.id) ? 'true' : 'false'}
                  className={selected.has(row.id) ? 'bg-primaryLighter' : 'hover:bg-actionHover'}
                >
                  {canSelect && (
                    <td>
                      {/* Wrapped, not given a `title`: a disabled input receives
                          no pointer events, so the one moment the operator needs
                          to know why the box is dead is the moment nothing
                          explains it. */}
                      <Tooltip label={armed ? null : selectionBlockReason(row, selectionOptions)}>
                        <Checkbox
                          ariaLabel={`Select ${row.returnAwb || row.id}`}
                          disabled={!rowEligible(row)}
                          checked={selected.has(row.id)}
                          onChange={() => toggleOne(row.id)}
                        />
                      </Tooltip>
                    </td>
                  )}
                  {columns.map(column => (
                    <td
                      key={column.key}
                      align={column.align}
                      className={classNames('whitespace-nowrap', column.width)}
                    >
                      <Cell
                        row={row}
                        column={column}
                        onPickSku={canPickSku(row) ? () => setSkuRow(row) : null}
                        onDownload={() => void downloadResources(row)}
                        onEdit={
                          onEditClaim && row.returnAwb
                            ? () => onEditClaim({ awb: row.returnAwb, platform: row.platform })
                            : null
                        }
                        onViewTicket={
                          hasTicketThread(row.platform) && row.ticket && row.username
                            ? () =>
                                setTicketTarget({
                                  platform: row.platform,
                                  username: row.username,
                                  ticket: row.ticket
                                })
                            : null
                        }
                        onEditTicket={canEditTicket(row.status) ? () => setTicketEditRow(row) : null}
                        onRetryDrive={() => void retryDrive(row)}
                        retryingDrive={retryingDriveIds.has(row.id)}
                        downloading={downloadingIds.has(row.id)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {rows !== null && visibleRows.length === 0 && (
            <EmptyState
              icon={<i className='tabler-inbox text-3xl' />}
              title={rows.length === 0 ? 'Nothing on this tab' : 'Every row is filtered out'}
              message={
                rows.length === 0
                  ? 'No claim on this marketplace has that status in the selected date range. Widen the dates, or try another status.'
                  : `This page has ${rows.length} claim${rows.length === 1 ? '' : 's'}, and the column filter hides ${rows.length === 1 ? 'it' : 'them all'}. Clear the filter to see them.`
              }
            />
          )}
          {rows === null && !error && <LoadingState label="Reading claims from TrackVid…" />}
        </Card>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <Typography variant='body2' color='text.secondary'>
              <span className="tabular-nums">{total}</span> claim{total === 1 ? '' : 's'} · page{' '}
              <span className="tabular-nums">{page}</span> of{' '}
              <span className="tabular-nums">{totalPages}</span>
            </Typography>
            <label className="flex items-center gap-2">
              <Typography variant='body2' color='text.secondary'>
                Rows per page
              </Typography>
              <Select
                size="sm"
                aria-label="Rows per page"
                options={PAGE_SIZE_OPTIONS}
                value={String(pageSize)}
                disabled={loading}
                onChange={event => {
                  setPageSize(Number(event.target.value))
                  // Back to the first page: page 3 of 25 and page 3 of 200 are
                  // different rows, and a page past the new last one is empty.
                  setPage(1)
                }}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage(current => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(current => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
      </div>

      <SessionGateModal
        accounts={sessionGate?.accounts ?? null}
        action={sessionGate?.action ?? 'Create Ticket'}
        onClose={closeGate}
        onRecheck={recheckGate}
      />

      {/* Asked before the save dialog, so a cancelled answer costs nothing —
          and before the download, so nobody waits on a re-encode they did not
          want. */}
      <VideoSizeModal
        platform={videoChoiceRow?.platform ?? null}
        limitBytes={videoChoiceRow ? uploadLimitFor(videoChoiceRow.platform) : null}
        onChoose={choice => {
          const row = videoChoiceRow

          setVideoChoiceRow(null)

          if (row) void runDownload(row, choice)
        }}
        onClose={() => setVideoChoiceRow(null)}
      />
      <NykaaDdrBulkModal open={nykaaDdrOpen} onClose={() => setNykaaDdrOpen(false)} />
      <BulkClaimModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onMinimise={() => setBulkOpen(false)}
        // History closes the window and shows the Jobs page. A run already in
        // flight keeps going — it is not owned by this window.
        onOpenJobs={
          onOpenJobs
            ? () => {
                setBulkOpen(false)
                onOpenJobs()
              }
            : undefined
        }
      />
    </>
  )
}
