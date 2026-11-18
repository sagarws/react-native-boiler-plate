import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'

// Icon Imports — the shared Tabler set, bundled; see scripts/build-icon-subset.
import { Badge, type BadgeTone } from '@renderer/components/ui/Badge'
import { Modal } from '@renderer/components/ui/Modal'
import { Button } from '@renderer/components/ui/Button'
import { Select } from '@renderer/components/ui/Select'
import { useToast } from '@renderer/hooks/useToast'
import {
  applySkuSelections,
  onSkuSweepProgress,
  skuSweepStatus
} from '@renderer/services/skuLookup.service'
import type { SkuSweepProgress, SkuSweepResult, SkuSweepRow } from '@shared/types/skuLookup'

// Style Imports
import tableStyles from '@core/styles/table.module.css'

/**
 * Bulk SKU: ask AJIO about every eligible claim, then confirm what to store.
 *
 * TWO PHASES, and the split is the whole design. The sweep reads — one browser
 * per seller account, one search per claim — and writes nothing. What comes
 * back is a REVIEW: a return with several articles has no automatic right
 * answer, and a sweep that saved as it went would replace SKUs across dozens of
 * claims on the strength of one bad search.
 *
 * Most rows need no decision. A single-article return is pre-selected, and so is
 * a row whose stored SKU already matches one of the articles — re-picking a
 * correct answer only invites someone to change it. What is left is the short
 * list that genuinely needs a person: several articles and nothing to go on, or
 * a stored SKU that is on NONE of them.
 *
 * Minimising leaves the sweep running and hands it to the corner panel, exactly
 * as the account mapping does.
 */

/** A count with its icon, in the app's status chip. */
const Pill = ({
  tone,
  icon,
  children
}: {
  tone: BadgeTone
  icon: ReactNode
  children: ReactNode
}) => (
  <Badge tone={tone}>
    <span className="inline-flex items-center gap-1 tabular-nums">
      {icon}
      {children}
    </span>
  </Badge>
)

/**
 * What choosing this article would actually store.
 *
 * `article.storable` — resolved by the core when the return was read, and the
 * SAME value the auto-selection uses. Not re-derived here: `storableSku` also
 * refuses an identifier that a SIBLING article on the return carries, and a
 * dropdown built from a plainer rule would offer two options with one value,
 * which a <select> cannot tell apart and which would file the claim against
 * whichever article came first.
 *
 * Null means the article carries nothing storable at all; those are left out.
 */
const valueOf = (article: SkuSweepRow['articles'][number]): string =>
  article.storable?.value ?? ''

const describe = (article: SkuSweepRow['articles'][number]): string => {
  const id = valueOf(article)

  return article.productName ? `${id} — ${article.productName}` : id
}

export const SkuSweepModal = ({
  open,
  platform,
  onMinimise,
  onClose,
  onSaved
}: {
  open: boolean
  platform: string
  onMinimise: () => void
  onClose: () => void
  onSaved: () => void
}) => {
  const toast = useToast()
  const [latest, setLatest] = useState<SkuSweepProgress | null>(null)
  const [result, setResult] = useState<SkuSweepResult | null>(null)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Only ever this platform's sweep — the status channel answers with the last
  // one whatever it was for.
  const run = latest && latest.platform === platform.toLowerCase().trim() ? latest : null
  const review = result && result.platform === platform.toLowerCase().trim() ? result : null

  useEffect(() => onSkuSweepProgress(setLatest), [])

  const running = run?.running ?? true

  /**
   * Asks for the sweep's state — on open, and again the moment it finishes.
   *
   * The progress push carries counts, not rows: sending the whole review on
   * every tick would put seventy claims and their articles through IPC once per
   * claim. So the window asks for it, and the two moments it needs to are
   * exactly these — opened mid-run or after one, and the run ending while it
   * watches. Without the second, a sweep completed with the modal open showed
   * its totals and no table, and Save had nothing to enable for.
   */
  useEffect(() => {
    if (!open) return undefined

    let cancelled = false

    void skuSweepStatus().then(response => {
      if (cancelled || !response.success) return

      if (response.data.progress) setLatest(response.data.progress)
      if (response.data.result) setResult(response.data.result)
    })

    return () => {
      cancelled = true
    }
  }, [open, running])
  const total = run?.total ?? 0
  const done = run?.done ?? 0
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  /** What each row will store: the operator's pick, else the suggestion. */
  const selections = useMemo(() => {
    if (!review) return []

    return review.rows
      .map(row => ({
        row,
        sellerSku: chosen[row.cmsId] ?? row.suggested ?? ''
      }))
      .filter(entry => entry.sellerSku.length > 0)
      // Nothing to write when the value is already what the claim says. Saving
      // it would burn a request per row to store what is already there.
      .filter(entry => entry.sellerSku !== entry.row.currentSku)
  }, [review, chosen])

  const undecided = review?.rows.filter(
    row => row.error === null && !chosen[row.cmsId] && !row.suggested
  ).length

  /** Rows AJIO answered for whose SKU is already right — nothing to write. */
  const unchanged = review?.rows.filter(
    row =>
      row.error === null &&
      row.currentSku.length > 0 &&
      (chosen[row.cmsId] ?? row.suggested ?? '') === row.currentSku
  ).length

  const save = async (): Promise<void> => {
    setSaving(true)

    const response = await applySkuSelections(
      selections.map(entry => ({
        cmsId: entry.row.cmsId,
        awbNumber: entry.row.awbNumber,
        sellerSku: entry.sellerSku
      }))
    )

    setSaving(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    const { saved, failed } = response.data

    if (saved > 0) toast.success(`Stored ${saved} SKU${saved === 1 ? '' : 's'}`)
    if (failed > 0) toast.error(`${failed} could not be saved`)

    onSaved()
    onClose()
  }

  return (
    <Modal
      size="lg"
      open={open}
      title={`Bulk SKU · ${platform}`}
      description={
        running
          ? 'Reading each return from AJIO. Nothing is saved until you press Save.'
          : review
            ? 'Check what will be stored, then save. Nothing has been written yet.'
            : 'Finished.'
      }
      onClose={running ? onMinimise : onClose}
      busy={saving}
      headerActions={
        <IconButton
          size="small"
          onClick={onMinimise}
          aria-label="Minimise"
          title="Minimise — the sweep carries on in the corner"
        >
          <i className="tabler-minimize text-lg" />
        </IconButton>
      }
      footer={
        running ? (
          <Button size="sm" variant="secondary" onClick={onMinimise}>
            Run in the background
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              loading={saving}
              disabled={selections.length === 0}
            >
              Save {selections.length > 0 ? `${selections.length} SKU${selections.length === 1 ? '' : 's'}` : ''}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <Typography variant="body2" color="text.primary" className="font-medium">
            {running ? 'Reading returns' : 'Read'}{' '}
            <Typography component="span" variant="body2" color="text.secondary" className="tabular-nums">
              {done} / {total}
            </Typography>
          </Typography>

          {running && (
            <Typography
              variant="caption"
              color="text.secondary"
              className="inline-flex items-center gap-2"
            >
              <CircularProgress size={16} color="inherit" />
              {run?.awbNumber || 'starting…'}
            </Typography>
          )}
        </div>

        <LinearProgress
          variant="determinate"
          value={percent}
          color={running ? 'primary' : 'success'}
        />

        <div className="flex flex-wrap gap-2">
          <Pill
            tone={(run?.resolved ?? 0) > 0 ? 'success' : 'neutral'}
            icon={<i className="tabler-check text-base" />}
          >
            Read {run?.resolved ?? 0}
          </Pill>
          <Pill
            tone={(run?.failed ?? 0) > 0 ? 'danger' : 'neutral'}
            icon={<i className="tabler-x text-base" />}
          >
            Failed {run?.failed ?? 0}
          </Pill>
          {running && (
            <Pill tone="neutral" icon={<CircularProgress size={12} color="inherit" />}>
              Remaining {Math.max(0, total - done)}
            </Pill>
          )}
          {!running && review && (
            <Pill
              tone={selections.length > 0 ? 'success' : 'neutral'}
              icon={<i className="tabler-check text-base" />}
            >
              Ready to save {selections.length}
            </Pill>
          )}
          {!running && undecided !== undefined && undecided > 0 && (
            <Pill tone="danger" icon={<i className="tabler-alert-triangle text-base" />}>
              Need a choice {undecided}
            </Pill>
          )}
          {/* Said out loud rather than left to be inferred from a Save button
              with no number on it: a row whose stored SKU is already one of the
              return's articles is a success, not a nothing. */}
          {!running && unchanged !== undefined && unchanged > 0 && (
            <Pill tone="neutral" icon={<i className="tabler-check text-base" />}>
              Already correct {unchanged}
            </Pill>
          )}
        </div>

        {/* NAMES THE ROUTE THAT EXISTS. This said "run Map Username first"
            until that tool was retired, which left the one screen that tells an
            operator they are blocked pointing at a button no longer on the
            page. Refill Data answers both halves — Account is the login the AWB
            belongs to, POB ID the place of business that owns it — and its
            "Use APIs" toggle is the sweep that finds them when the local backup
            has never held the row. */}
        {!running && review && review.total === 0 && (
          <Alert severity="info">
            No {platform} claim has both an account and a POB ID yet — run Refill Data with
            Account and POB ID ticked first. Turn on Use APIs there for rows the local backup
            has never held.
          </Alert>
        )}

        {!running && review && review.rows.length > 0 && (
          <Card variant="outlined" className="overflow-x-auto">
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th>Return AWB</th>
                  <th>Current SKU</th>
                  <th>Store</th>
                </tr>
              </thead>

              <tbody>
                {review.rows.map(row => {
                  const value = chosen[row.cmsId] ?? row.suggested ?? ''

                  return (
                    <tr key={row.cmsId} className="align-top">
                      <td>
                        <span className="select-text font-mono text-textPrimary">{row.awbNumber}</span>
                      </td>

                      <td>
                        {row.currentSku ? (
                          <span
                            className={
                              // The claim names an article that is not on this
                              // return: it would trip selectReturnItem's gate, or
                              // file against something else entirely.
                              row.mismatch
                                ? 'select-text font-mono text-error'
                                : 'select-text font-mono text-textPrimary'
                            }
                            title={row.mismatch ? 'Not one of this return’s articles' : undefined}
                          >
                            {row.currentSku}
                          </span>
                        ) : (
                          <span className="text-textDisabled">—</span>
                        )}

                        {row.mismatch && (
                          <Typography
                            variant="caption"
                            color="error.main"
                            className="mt-0.5 flex items-center gap-1"
                          >
                            <i className="tabler-alert-triangle text-base" />
                            Wrong SKU — not on this return
                          </Typography>
                        )}
                      </td>

                      <td>
                        {row.error ? (
                          <Typography variant="caption" color="error.main">
                            {row.error}
                          </Typography>
                        ) : row.articles.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">
                            AJIO returned no articles
                          </Typography>
                        ) : (
                          <>
                            <Select
                              aria-label={`SKU for ${row.awbNumber}`}
                              size="sm"
                              className="is-full"
                              value={value}
                              onChange={event =>
                                setChosen(current => ({
                                  ...current,
                                  [row.cmsId]: event.target.value
                                }))
                              }
                              options={[
                                // Skipping is a real answer, and it is the one
                                // offered by default when a return has several
                                // articles: nothing about it says which one the
                                // claim is for, and a guess files against the
                                // wrong item. A single-article return has one
                                // answer and gets no skip option, because there
                                // is nothing to decide and offering to undo it
                                // would only invite that.
                                ...(row.articles.length > 1
                                  ? [{ value: '', label: 'Skip this claim' }]
                                  : []),
                                ...row.articles
                                  .filter(article => valueOf(article).length > 0)
                                  .map(article => ({
                                    value: valueOf(article),
                                    label: describe(article)
                                  }))
                              ]}
                            />

                            {row.articles.length > 1 && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                className="mt-0.5 block"
                              >
                                {row.articles.length} articles on this return
                              </Typography>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </Modal>
  )
}
