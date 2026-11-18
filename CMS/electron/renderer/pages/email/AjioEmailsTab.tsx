import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import { useTheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'

import type {
  AjioEmailCounts,
  AjioEmailDetails,
  AjioEmailPage,
  AjioEmailRow,
  AjioEmailTab,
  EmailBody,
  MailboxSummary
} from '@shared/types/emailReply'
import { AJIO_EMAIL_PAGE_SIZES } from '@shared/types/emailReply'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { FilterTab } from '@renderer/components/ui/FilterTab'
import { Select } from '@renderer/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@renderer/components/data/StateBlocks'
import { ajioEmailCounts, ajioEmailDetails, listAjioEmails } from '@renderer/services/emailReply.service'
import { formatDate, formatDateTime } from '@renderer/utils/format'
import tableStyles from '@core/styles/table.module.css'
import { requestIds } from '@shared/utils/ajioSubject'
import { conversationStamp, desktopUnsupported, emailStatus, repliedBy, replyOutcome, timeOf } from './emailReplyFormat'
import type { ReplyState } from './useAjioReplies'


/**
 * AJIO's "CCTV FOOTAGE REQUIRED" emails, and whether each has been answered.
 *
 * Pending includes the emails whose send FAILED — a reply that did not go out
 * is still owed — and those show their reason, which is usually the one thing
 * somebody can act on (no order found, no video recorded).
 *
 * REPLY answers one request from this machine, now: TrackVid builds the reply
 * and locks the email while it is sent, so its own worker cannot answer the
 * same request at the same moment. The outcome stays on the row — sent, not
 * sent and why, or the mail server's refusal.
 *
 * LOADING IS SHOWN AS LOADING. The admin page renders "No emails available
 * yet." while its first request is still running, beside a count that already
 * says 98. Here a query with no answer yet is a spinner, and an empty list
 * means the server said so.
 */

/**
 * A real value rather than '': MUI's select shows nothing for an empty-string
 * value, which left the filter looking blank until something was picked.
 */
const ALL_MAILBOXES = 'all'

const mailboxParam = (value: string): string | null => (value === ALL_MAILBOXES ? null : value)

export const AjioEmailsTab = ({
  mailboxes,
  refreshKey,
  replies,
  onReply,
  replyRevision
}: {
  mailboxes: MailboxSummary[]
  /** Changes when the page is refreshed from the navbar. */
  refreshKey: number
  /** Each row's Reply, held by the page so Reply all can drive the same rows. */
  replies: Record<string, ReplyState>
  onReply: (row: AjioEmailRow) => void
  /** Bumped when a reply has gone out: the counts reload, the rows stay put. */
  replyRevision: number
}) => {
  const [status, setStatus] = useState<AjioEmailTab>('pending')
  const [mailboxId, setMailboxId] = useState(ALL_MAILBOXES)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(AJIO_EMAIL_PAGE_SIZES[0])
  const [counts, setCounts] = useState<AjioEmailCounts | null>(null)
  const [result, setResult] = useState<AjioEmailPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  // Rows opened to read the conversation. Several may be open at once.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  /*
   * WHICH QUERY HAS BEEN ANSWERED, rather than a loading flag set before each
   * request: loading is simply "the query on screen is not the one answered".
   * It cannot be left stuck on by a request that was superseded, and nothing
   * is set synchronously inside the effect that asks.
   */
  const [answeredKey, setAnsweredKey] = useState<string | null>(null)
  const listSeq = useRef(0)
  const countSeq = useRef(0)

  const mailboxName = useMemo(
    () => new Map(mailboxes.map(mailbox => [mailbox.id, mailbox.email])),
    [mailboxes]
  )

  const mailboxOptions = useMemo(
    () => [
      { value: ALL_MAILBOXES, label: 'All mailboxes' },
      ...mailboxes.map(mailbox => ({ value: mailbox.id, label: mailbox.email }))
    ],
    [mailboxes]
  )

  // The counts follow the mailbox only; switching Pending/Replied or paging
  // does not change them.
  useEffect(() => {
    const mine = ++countSeq.current

    void ajioEmailCounts(mailboxParam(mailboxId)).then(response => {
      if (mine === countSeq.current && response.success) setCounts(response.data)
    })
  // After a reply, the counts alone: the row keeps its outcome on screen
  // rather than vanishing into the Replied tab mid-glance.
  }, [mailboxId, refreshKey, reloads, replyRevision])

  const queryKey = `${status}|${page}|${pageSize}|${mailboxId}|${refreshKey}|${reloads}`
  const loading = answeredKey !== queryKey

  useEffect(() => {
    // Out-of-order answers are dropped: a slow page 1 must not land on top of
    // the page 2 asked for after it.
    const mine = ++listSeq.current

    void listAjioEmails({ status, page, pageSize, mailboxId: mailboxParam(mailboxId) }).then(response => {
      if (mine !== listSeq.current) return

      setAnsweredKey(queryKey)

      if (response.success) {
        setResult(response.data)
        setError(null)
      } else {
        setError(response.error.message)
      }
    })
  }, [queryKey, status, page, pageSize, mailboxId])

  // Leaving the page while a request is out: nothing should land afterwards.
  useEffect(
    () => () => {
      listSeq.current += 1
      countSeq.current += 1
    },
    []
  )

  const reload = useCallback(() => setReloads(count => count + 1), [])

  const toggleExpanded = useCallback((id: string): void => {
    setExpanded(current => {
      const next = new Set(current)

      if (next.has(id)) next.delete(id)
      else next.add(id)

      return next
    })
  }, [])

  const mailboxById = useMemo(() => new Map(mailboxes.map(mailbox => [mailbox.id, mailbox])), [mailboxes])

  const changeStatus = (next: AjioEmailTab): void => {
    if (next === status) return

    setStatus(next)
    setPage(1)
    // The other tab's rows are not this tab's; show loading, not them.
    setResult(null)
    setError(null)
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1

  const body = (() => {
    if (error && !result) return <ErrorState message={error} onRetry={reload} />
    if (!result) return <LoadingState label='Loading AJIO emails…' />

    if (result.items.length === 0) {
      return (
        <EmptyState
          title={status === 'pending' ? 'Nothing waiting for a reply' : 'No replies yet'}
          message={
            status === 'pending'
              ? 'Every AJIO footage request found in the connected mailboxes has been answered.'
              : 'No AJIO footage request has been answered from these mailboxes yet.'
          }
        />
      )
    }

    return (
      /* THE ONE SCROLLING AREA. The page is fitted to the window (see
         EmailReplyPage), so this box takes the height that is left and
         scrolls inside it — both ways — with its heading held at the top. */
      <Box
        className='trackvid-table-scroll rounded'
        sx={{ border: 1, borderColor: 'divider', opacity: loading ? 0.6 : 1 }}
      >
        <table className={tableStyles.table}>
          <thead className='sticky top-0 z-10 bg-backgroundPaper'>
            <tr>
              <th aria-label='Expand' style={{ inlineSize: 1 }} />
              <th>Received</th>
              <th>Request</th>
              <th>Mailbox</th>
              <th>Status</th>
              <th>{status === 'pending' ? 'Last error' : 'Replied'}</th>
              {status === 'pending' ? <th className='min-w-72'>Reply</th> : <th>Replied by</th>}
            </tr>
          </thead>
          <tbody>
            {result.items.map(row => {
              const state = emailStatus(row.status)
              const ids = requestIds(row.subject)
              const open = expanded.has(row.id)

              return (
                <Fragment key={row.id}>
                  <tr>
                    <td>
                      <IconButton
                        size='small'
                        aria-label={open ? 'Hide the email' : 'Show the email'}
                        aria-expanded={open}
                        title={open ? 'Hide the email' : 'Show the email'}
                        onClick={() => toggleExpanded(row.id)}
                      >
                        <i className={open ? 'tabler-chevron-down' : 'tabler-chevron-right'} />
                      </IconButton>
                    </td>
                    <td>
                      {row.receivedAt ? (
                        <div className='flex flex-col'>
                          <Typography variant='body2' color='text.primary'>
                            {formatDate(row.receivedAt)}
                          </Typography>
                          <Typography variant='caption' color='text.secondary'>
                            {timeOf(row.receivedAt)}
                          </Typography>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    {/* The subject is "CCTV FOOTAGE REQUIRED||INC…||RT…||DV…" on
                        every row; the identifiers are the part that differs, so
                        they lead and the full subject is on hover. */}
                    <td style={{ whiteSpace: 'normal' }} title={row.subject}>
                      <div className='flex min-is-0 max-w-md flex-col gap-0.5'>
                        <div className='flex flex-wrap gap-x-2 gap-y-0.5'>
                          {ids.map(id => (
                            <Typography
                              key={id}
                              variant='body2'
                              color='text.primary'
                              className='font-mono font-medium'
                            >
                              {id}
                            </Typography>
                          ))}
                        </div>
                        {row.snippet && (
                          <Typography variant='caption' color='text.secondary' className='truncate'>
                            {row.snippet}
                          </Typography>
                        )}
                      </div>
                    </td>
                    <td>
                      {(() => {
                        const mailbox = mailboxAddress(row, mailboxName)

                        return (
                          <Typography
                            variant='body2'
                            color={mailbox.listed ? 'text.primary' : 'text.secondary'}
                            title={
                              mailbox.listed || !mailbox.address
                                ? undefined
                                : 'The address this email was sent to. Its mailbox record was removed from TrackVid.'
                            }
                          >
                            {mailbox.address ?? '—'}
                          </Typography>
                        )
                      })()}
                      <Typography variant='caption' color='text.secondary'>
                        from {row.senderName ?? row.senderEmail ?? 'unknown sender'}
                      </Typography>
                    </td>
                    <td>
                      <div className='flex flex-col items-start gap-1'>
                        <Badge tone={state.tone}>{state.label}</Badge>
                        {row.acknowledged && <Badge tone='success'>AJIO acknowledged</Badge>}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {status === 'pending' ? (
                        row.replyError ? (
                          <Typography variant='caption' color='error' className='block max-w-60'>
                            {row.replyError}
                            {row.retryAttempts > 0 ? ` (${row.retryAttempts} attempt(s))` : ''}
                          </Typography>
                        ) : (
                          '—'
                        )
                      ) : row.repliedAt ? (
                        <div className='flex flex-col'>
                          <Typography variant='body2' color='text.primary'>
                            {formatDate(row.repliedAt)}
                          </Typography>
                          <Typography variant='caption' color='text.secondary' title={formatDateTime(row.repliedAt)}>
                            {timeOf(row.repliedAt)}
                          </Typography>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    {status === 'pending' ? (
                      <td style={{ whiteSpace: 'normal' }}>
                        <ReplyCell
                          row={row}
                          mailbox={row.mailboxId ? mailboxById.get(row.mailboxId) : undefined}
                          state={replies[row.id]}
                          onReply={onReply}
                        />
                      </td>
                    ) : (
                      <td>
                        {/* "—" is a reply sent before TrackVid recorded who sent it. */}
                        {(() => {
                          const sender = repliedBy(row.repliedBy)

                          return sender ? <Badge tone={sender.tone}>{sender.label}</Badge> : '—'
                        })()}
                      </td>
                    )}
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={7} style={{ whiteSpace: 'normal' }}>
                        <EmailConversation row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </Box>
    )
  })()

  return (
    // Passes the fitted height down to the table, so the toolbar and the
    // pager stay put and only the rows scroll.
    <div className='trackvid-table-scroll-host flex flex-col gap-4'>
      <div className='flex shrink-0 flex-wrap items-center gap-3'>
        <div className='flex gap-2'>
          <FilterTab
            label='Pending'
            count={counts?.pending}
            active={status === 'pending'}
            onClick={() => changeStatus('pending')}
          />
          <FilterTab
            label='Replied'
            count={counts?.replied}
            active={status === 'replied'}
            onClick={() => changeStatus('replied')}
          />
        </div>

        <div className='flex flex-1 flex-wrap items-center justify-end gap-3'>
          <Select
            size='sm'
            aria-label='Mailbox'
            className='min-is-60'
            options={mailboxOptions}
            value={mailboxId}
            onChange={event => {
              setMailboxId(event.target.value)
              setPage(1)
            }}
          />
          <Button
            variant='secondary'
            size='sm'
            loading={loading}
            icon={<i className='tabler-refresh' />}
            onClick={reload}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* A refresh that failed keeps the rows it had, and says so. */}
      {error && result && (
        <Typography variant='body2' color='error' className='shrink-0'>
          Could not refresh: {error}
        </Typography>
      )}

      {body}

      {result && result.total > 0 && (
        <div className='flex shrink-0 flex-wrap items-center justify-between gap-3'>
          <Typography variant='body2' color='text.secondary'>
            {`${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} of ${result.total.toLocaleString()}`}
          </Typography>
          <div className='flex items-center gap-2'>
            <Select
              size='sm'
              aria-label='Rows per page'
              options={AJIO_EMAIL_PAGE_SIZES.map(size => ({ value: String(size), label: `${size} / page` }))}
              value={String(pageSize)}
              onChange={event => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            />
            <Button
              variant='ghost'
              size='sm'
              disabled={loading || page <= 1}
              icon={<i className='tabler-chevron-left' />}
              onClick={() => setPage(current => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Typography variant='body2' color='text.secondary'>
              {`Page ${page} of ${pages}`}
            </Typography>
            <Button
              variant='ghost'
              size='sm'
              disabled={loading || !result.hasMore}
              icon={<i className='tabler-chevron-right' />}
              onClick={() => setPage(current => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The mailbox to name on a row. Its own record when it is still listed;
 * otherwise the address the email was sent to — preferring one a listed
 * mailbox has, since a removed-and-re-added mailbox keeps its address but not
 * its id. `listed` says which, so the row can show the difference.
 */
const mailboxAddress = (
  row: AjioEmailRow,
  mailboxName: Map<string, string>
): { address: string | null; listed: boolean } => {
  const own = row.mailboxId ? mailboxName.get(row.mailboxId) : undefined

  if (own) return { address: own, listed: true }

  const known = new Set([...mailboxName.values()].map(email => email.toLowerCase()))

  return {
    address: row.recipients.find(email => known.has(email)) ?? row.recipients[0] ?? null,
    listed: false
  }
}

const ReplyCell = ({
  row,
  mailbox,
  state,
  onReply
}: {
  row: AjioEmailRow
  mailbox: MailboxSummary | undefined
  state: ReplyState | undefined
  onReply: (row: AjioEmailRow) => void
}) => {
  // No mailbox id, or one that matches no listed mailbox — say which. Removing a
  // mailbox deletes it, and re-adding the same address creates a NEW id, so the
  // emails fetched before it still point at the old one. The backend refuses
  // both cases too, so the button stays off.
  const unsupported = !row.mailboxId
    ? 'TrackVid has no mailbox recorded for this email, so it cannot be replied to from here'
    : !mailbox
      ? 'This email belongs to a mailbox that was removed from TrackVid. Re-adding the address does not re-link emails fetched before it'
      : desktopUnsupported(mailbox)
  // Once it has gone out, it must not be offered again from this row: a second
  // press would be refused by TrackVid, but "Sent, not recorded" would not be.
  const done = state?.result?.outcome === 'replied' || state?.result?.outcome === 'sent-unrecorded'
  const outcome = state?.result ? replyOutcome(state.result.outcome) : null

  return (
    <div className='flex min-is-0 flex-col items-start gap-1'>
      {!done && (
        <span title={unsupported ?? undefined}>
          <Button
            variant='primary'
            size='sm'
            loading={state?.busy === true}
            disabled={unsupported !== null || state?.busy === true}
            icon={<i className='tabler-send' />}
            onClick={() => onReply(row)}
          >
            {state?.busy ? 'Sending…' : state?.result ? 'Try again' : 'Reply'}
          </Button>
        </span>
      )}
      {/* A disabled button explains nothing on its own; the reason sits under it. */}
      {!done && unsupported && !state?.result && (
        <Typography variant='caption' color='text.secondary' className='block min-w-64 max-w-72'>
          {unsupported}
        </Typography>
      )}
      {outcome && state?.result && !state.busy && (
        <div className='flex max-w-60 flex-col items-start gap-0.5'>
          <Badge tone={outcome.tone}>{outcome.label}</Badge>
          <Typography
            variant='caption'
            color={state.result.outcome === 'replied' ? 'text.secondary' : 'error'}
            title={state.result.message}
            className='line-clamp-2'
          >
            {state.result.outcome === 'replied' ? timeOf(state.result.at) : state.result.message}
          </Typography>
        </div>
      )}
    </div>
  )
}

/**
 * One email opened under its row, laid out as the web admin lays it out: what
 * AJIO sent beside what went back. Fetched when opened, not with the page —
 * bodies are the heavy part, and the list leaves them out on purpose.
 */
const EmailConversation = ({ row }: { row: AjioEmailRow }) => {
  const [details, setDetails] = useState<AjioEmailDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true

    void ajioEmailDetails(row.id).then(response => {
      if (!live) return

      if (response.success) {
        setDetails(response.data)
        setError(null)
      } else {
        setError(response.error.message)
      }
    })

    return () => {
      live = false
    }
  }, [row.id, attempt])

  if (error && !details) {
    return <ErrorState message={error} onRetry={() => setAttempt(count => count + 1)} />
  }

  if (!details) return <LoadingState label='Loading the email…' />

  const reply = details.reply

  return (
    <div className='flex flex-col gap-4 pli-6 plb-6'>
      <Typography variant='subtitle2' color='text.primary' className='font-semibold'>
        Conversation
      </Typography>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
        <ConversationPane
          title='Received email'
          lines={[row.receivedAt ? conversationStamp(row.receivedAt) : null]}
          subject={row.subject}
          body={details.body}
          empty='No email body available.'
        />
        <ConversationPane
          title='Reply'
          lines={[
            row.replyTo ? `To: ${row.replyTo}` : null,
            row.replyCc ? `CC: ${row.replyCc}` : null,
            reply?.repliedAt ? conversationStamp(reply.repliedAt) : null
          ]}
          subject={reply ? row.replySubject : null}
          body={reply?.body ?? null}
          error={reply?.errorMessage ?? null}
          empty='No reply content captured yet.'
        />
      </div>
    </div>
  )
}

const ConversationPane = ({
  title,
  lines,
  subject,
  body,
  error,
  empty
}: {
  title: string
  lines: (string | null)[]
  subject: string | null
  body: EmailBody | null
  error?: string | null
  empty: string
}) => (
  <Paper variant='outlined' className='flex min-is-0 flex-col gap-2 rounded-lg p-4'>
    <Typography variant='subtitle2' color='text.primary' className='font-semibold'>
      {title}
    </Typography>
    {lines.map(
      line =>
        line && (
          <Typography key={line} variant='caption' color='text.secondary' className='break-words'>
            {line}
          </Typography>
        )
    )}
    {subject && (
      <Typography variant='body2' color='text.primary' className='font-medium break-words'>
        {subject}
      </Typography>
    )}
    {error && (
      <Typography variant='caption' color='error'>
        {error}
      </Typography>
    )}
    {body?.html ? (
      <MailFrame html={body.html} title={title} />
    ) : body?.text ? (
      <Typography
        variant='body2'
        color='text.primary'
        className='mbs-2 max-h-80 overflow-auto break-words'
        sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
      >
        {body.text}
      </Typography>
    ) : (
      <Typography variant='body2' color='text.secondary'>
        {empty}
      </Typography>
    )}
  </Paper>
)

/**
 * A mail's own HTML — tables, colours, layout — exactly as it was sent, as the
 * web admin shows it.
 *
 * THE ADMIN PUTS THIS HTML STRAIGHT INTO ITS PAGE. Here it goes into a frame
 * with an empty `sandbox`: no scripts, no forms, no popups, no navigation of
 * this window, and an origin of its own, so nothing in a mail — AJIO's or a
 * forged one — can reach this window or the bridge to the main process. A
 * clicked link goes nowhere: the frame may not open a window, and the app's
 * CSP refuses to load another page into it.
 *
 * The frame cannot report its height across that boundary, so it has a fixed
 * one and scrolls inside, as the admin's pane does at 360px. Text colour and
 * font come from the theme, so the mail reads in both schemes; the mail's own
 * colours, where it sets them, win — as they do in the admin.
 */
const MailFrame = ({ html, title }: { html: string; title: string }) => {
  const theme = useTheme()
  const color = theme.palette.text.primary
  const font = theme.typography.fontFamily ?? 'sans-serif'

  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><style>` +
      `html,body{margin:0;background:transparent;color:${color};font-family:${font};` +
      `font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;}` +
      `img{max-width:100%;height:auto;}table{border-collapse:collapse;}` +
      `</style></head><body>${html}</body></html>`,
    [html, color, font]
  )

  return (
    <iframe
      title={title}
      sandbox=''
      referrerPolicy='no-referrer'
      srcDoc={srcDoc}
      className='mbs-2 is-full border-0'
      style={{ blockSize: 360, colorScheme: 'normal' }}
    />
  )
}
