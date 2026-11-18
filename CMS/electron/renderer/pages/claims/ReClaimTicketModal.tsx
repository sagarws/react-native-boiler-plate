import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { Modal } from '@renderer/components/ui/Modal'
import { Button } from '@renderer/components/ui/Button'
import type { ReClaimTicket } from '@shared/types/reClaim'

/**
 * What Myntra says about a ticket.
 *
 * Opened two ways, and the difference is only whether anything was CHANGED
 * first. After a dispute it reports the outcome and then the ticket's new
 * state, because the reply to `createFwTicket` says only "dispute raised" and
 * the answer an operator needs is what Myntra now holds. From the eye beside a
 * ticket id it is a plain read — the same window, no banner, nothing sent.
 *
 * `validationReason` is usually the whole story either way:
 * "VMS_Footage_Not_Available_FWRD" says what to fix before disputing.
 *
 * A child window rather than a panel in the table: it belongs to one row, and
 * the table behind it is where the operator carries on.
 */

export interface TicketView {
  ticketId: string
  /** Null while the read is still in flight. */
  ticket: ReClaimTicket | null
  loading: boolean
  /** Present only when this window was opened by a dispute. */
  outcome: { ok: boolean; message: string } | null
  /**
   * What was sent to Myntra, and what went wrong.
   *
   * A refused dispute is nearly always a payload question — the wrong issue
   * category, an attachment Myntra will not take, a ticket on another account
   * — and a sentence on its own cannot say which. Shown on success too: "what
   * did we actually send" is the first question when a dispute lands and then
   * goes nowhere.
   */
  payload?: Record<string, unknown> | null
  error?: string | null
}

/** The fields worth reading first. The rest are below, verbatim. */
const SUMMARY: { key: string; label: string }[] = [
  { key: 'ticketId', label: 'Ticket' },
  { key: 'status', label: 'Status' },
  { key: 'originalStatus', label: 'Original status' },
  { key: 'validationReason', label: 'Validation reason' },
  { key: 'issueCategory', label: 'Issue category' },
  { key: 'returnReason', label: 'Return reason' },
  { key: 'trackingId', label: 'Tracking id' },
  { key: 'orderId', label: 'Order' },
  { key: 'returnId', label: 'Return' },
  { key: 'skuId', label: 'SKU' },
  { key: 'styleId', label: 'Style' },
  { key: 'compensationAmount', label: 'Compensation' },
  { key: 'lastModifiedOn', label: 'Last modified' }
]

const cell = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  try {
    return JSON.stringify(value)
  } catch {
    return '—'
  }
}

export const ReClaimTicketModal = ({
  view,
  onClose
}: {
  /** Null when the child window is shut. */
  view: TicketView | null
  onClose: () => void
}) => {
  const row = view?.ticket?.row ?? null
  // Everything Myntra returned that the summary above does not name. Shown
  // because a claim this app cannot fully read is still the operator's to see.
  const rest = row
    ? Object.entries(row).filter(([key]) => !SUMMARY.some(field => field.key === key))
    : []

  return (
    <Modal
      size="lg"
      open={view !== null}
      title={`Ticket ${view?.ticketId ?? ''}`}
      description={
        view?.outcome?.message ?? (view?.loading ? 'Reading it from Myntra…' : 'Read from Myntra.')
      }
      onClose={onClose}
      footer={
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      {view && (
        <div className="flex flex-col gap-4">
          {/* Only when something was SENT. A plain look at a ticket has no
              outcome to report, and a green bar over one would suggest it did. */}
          {view.outcome && (
            <Alert severity={view.outcome.ok ? 'success' : 'error'}>{view.outcome.message}</Alert>
          )}

          {view.loading && (
            <Typography
              variant="body2"
              color="text.secondary"
              className="flex items-center gap-2 plb-6"
            >
              <CircularProgress size={16} color="inherit" />
              Reading ticket {view.ticketId} from Myntra…
            </Typography>
          )}

          {!view.loading && !view.ticket?.found && (
            <Alert severity="warning">
              {view.outcome
                ? 'Myntra returned no ticket when it was read back. The dispute may still have landed — check the portal before sending it again.'
                : // A plain read that found nothing is about the account or the
                  // sheet, not about a dispute that may or may not have worked.
                  'Myntra has no such ticket on this account. Check the account, or the ticket id in the sheet.'}
            </Alert>
          )}

          {/* Open by default when something went wrong, shut when it did not:
              the payload is the answer to a failure and clutter beside a
              success. */}
          {(view.payload || view.error) && (
            <Paper variant="outlined">
              <details open={view.outcome?.ok === false}>
                <summary className="cursor-pointer pli-3 plb-2">
                  <Typography component="span" variant="subtitle2" className="font-semibold">
                    What was sent, and what came back
                  </Typography>
                </summary>

                <div className="flex flex-col gap-3 pli-3 pbe-3">
                  {view.error && (
                    <div className="flex flex-col gap-1">
                      <Typography variant="caption" color="text.secondary" className="font-medium">
                        Myntra&rsquo;s answer
                      </Typography>
                      <Alert severity="error" icon={false}>
                        <span className="select-text break-all">{view.error}</span>
                      </Alert>
                    </div>
                  )}

                  {view.payload && (
                    <div className="flex flex-col gap-1">
                      <Typography variant="caption" color="text.secondary" className="font-medium">
                        Payload sent to createFwTicket
                      </Typography>
                      {/* Selectable and whole: the point of showing it is to copy
                          it into a bug report or replay it by hand. */}
                      <Typography
                        component="pre"
                        variant="caption"
                        color="text.primary"
                        className="max-h-64 select-text overflow-auto rounded bg-actionHover p-2 font-mono leading-relaxed"
                      >
                        {JSON.stringify(view.payload, null, 2)}
                      </Typography>
                    </div>
                  )}
                </div>
              </details>
            </Paper>
          )}

          {row && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {SUMMARY.map(field => (
                  <div key={field.key} className="min-w-0">
                    <Typography component="dt" variant="caption" color="text.secondary">
                      {field.label}
                    </Typography>
                    <Typography
                      component="dd"
                      variant="body2"
                      color="text.primary"
                      className="select-text truncate"
                      title={cell(row[field.key])}
                    >
                      {cell(row[field.key])}
                    </Typography>
                  </div>
                ))}
              </dl>

              {rest.length > 0 && (
                <Paper variant="outlined">
                  <details>
                    <summary className="cursor-pointer pli-3 plb-2">
                      <Typography component="span" variant="subtitle2" className="font-semibold">
                        Everything else Myntra returned ({rest.length} fields)
                      </Typography>
                    </summary>

                    <dl className="flex max-h-64 flex-col gap-1 overflow-y-auto pli-3 pbe-3">
                      {rest.map(([key, value]) => (
                        <div key={key} className="min-w-0">
                          <Typography component="dt" variant="caption" color="text.secondary">
                            {key}
                          </Typography>
                          <Typography
                            component="dd"
                            variant="body2"
                            color="text.primary"
                            className="select-text break-all"
                          >
                            {cell(value)}
                          </Typography>
                        </div>
                      ))}
                    </dl>
                  </details>
                </Paper>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
