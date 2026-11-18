import { useState } from 'react'

import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'

import type { MailboxRefetchResult, MailboxSummary } from '@shared/types/emailReply'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@renderer/components/data/StateBlocks'
import { formatDate, formatDateTime } from '@renderer/utils/format'
import tableStyles from '@core/styles/table.module.css'
import { ago, desktopUnsupported, mailboxStatus, providerLabel } from './emailReplyFormat'
import { LastSyncDialog } from './LastSyncDialog'

/** One Refetch, as its row shows it: running, or what the last one did. */
export interface RefetchState {
  busy: boolean
  result: MailboxRefetchResult | null
  error: string | null
}

/**
 * The mailboxes connected to the AJIO auto-reply, one row each.
 *
 * No Add, no password update, no delete: those are in the web admin's
 * Settings → Integrations, and a second place to do them would be a second
 * place for them to go wrong.
 *
 * REFETCH is the one action: this app reads the mailbox itself, now, and hands
 * the AJIO requests it finds to TrackVid — instead of waiting for the server's
 * next pass. What it did stays on the row.
 */
export const MailboxesTab = ({
  mailboxes,
  error,
  loading,
  onReload,
  refetch,
  onRefetch,
  refetchLocked = false
}: {
  mailboxes: MailboxSummary[] | null
  error: string | null
  loading: boolean
  onReload: () => void
  refetch: Readonly<Record<string, RefetchState>>
  onRefetch: (mailboxId: string) => void
  /** Refetch all is working through the list; one row at a time is its job. */
  refetchLocked?: boolean
}) => {
  // The mailbox whose last-sync date is being edited, if any.
  const [editing, setEditing] = useState<MailboxSummary | null>(null)

  if (mailboxes === null) {
    return error ? <ErrorState message={error} onRetry={onReload} /> : <LoadingState label='Loading mailboxes…' />
  }

  if (mailboxes.length === 0) {
    return (
      <EmptyState
        title='No mailboxes connected'
        message='Mailboxes are connected in the TrackVid web admin, under Settings → Integrations → AJIO Email Auto Reply.'
      />
    )
  }

  return (
    <div className='trackvid-table-scroll-host flex flex-col gap-3'>
      {/* A refresh that failed keeps the list it had, and says so. */}
      {error && (
        <Typography variant='body2' color='error' className='shrink-0'>
          Could not refresh: {error}
        </Typography>
      )}

      {/* The only thing that scrolls, with its heading held at the top. */}
      <Box
        className='trackvid-table-scroll rounded'
        sx={{ border: 1, borderColor: 'divider', opacity: loading ? 0.6 : 1 }}
      >
        <table className={tableStyles.table}>
          <thead className='sticky top-0 z-10 bg-backgroundPaper'>
            <tr>
              <th>Mailbox</th>
              <th>Provider</th>
              <th>Sign-in</th>
              <th>Status</th>
              <th>Last synced</th>
              <th>Added</th>
              <th>Refetch</th>
            </tr>
          </thead>
          <tbody>
            {mailboxes.map(mailbox => {
              const status = mailboxStatus(mailbox.status)

              return (
                <tr key={mailbox.id}>
                  <td>
                    <div className='flex min-is-0 flex-col'>
                      <Typography variant='body2' color='text.primary' className='font-medium'>
                        {mailbox.displayName ?? mailbox.email}
                      </Typography>
                      {mailbox.displayName && mailbox.displayName !== mailbox.email && (
                        <Typography variant='caption' color='text.secondary'>
                          {mailbox.email}
                        </Typography>
                      )}
                    </div>
                  </td>
                  <td>{providerLabel(mailbox.provider)}</td>
                  <td>
                    {/* Password is an app password over IMAP/SMTP; OAuth a provider sign-in. */}
                    <Badge tone='info'>{mailbox.authType === 'oauth' ? 'OAuth' : 'Password'}</Badge>
                  </td>
                  <td>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td title={mailbox.lastSyncedAt ? formatDateTime(mailbox.lastSyncedAt) : undefined}>
                    <div className='flex items-center gap-1'>
                      <span>{ago(mailbox.lastSyncedAt)}</span>
                      <IconButton
                        size='small'
                        aria-label={`Edit last sync date for ${mailbox.email}`}
                        title='Edit last sync date'
                        // Not while a refetch is reading from the current date.
                        disabled={refetch[mailbox.id]?.busy === true}
                        onClick={() => setEditing(mailbox)}
                      >
                        <i className='tabler-pencil text-base' />
                      </IconButton>
                    </div>
                  </td>
                  <td>{mailbox.createdAt ? formatDateTime(mailbox.createdAt) : '—'}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    <RefetchCell
                      mailbox={mailbox}
                      state={refetch[mailbox.id]}
                      locked={refetchLocked}
                      onRefetch={onRefetch}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Box>

      {editing && <LastSyncDialog mailbox={editing} onClose={() => setEditing(null)} onSaved={onReload} />}
    </div>
  )
}

const RefetchCell = ({
  mailbox,
  state,
  locked,
  onRefetch
}: {
  mailbox: MailboxSummary
  state: RefetchState | undefined
  locked: boolean
  onRefetch: (mailboxId: string) => void
}) => {
  const unsupported = desktopUnsupported(mailbox)

  return (
    <div className='flex min-is-0 flex-col items-start gap-1'>
      {/* The reason is on hover: a disabled button that says nothing is the
          one an operator presses five times. */}
      <span title={unsupported ?? undefined}>
        <Button
          variant='secondary'
          size='sm'
          loading={state?.busy === true}
          disabled={unsupported !== null || state?.busy === true || locked}
          icon={<i className='tabler-mail-down' />}
          onClick={() => onRefetch(mailbox.id)}
        >
          {state?.busy ? 'Fetching…' : 'Refetch'}
        </Button>
      </span>
      {state?.error && !state.busy && (
        <Typography variant='caption' color='error' className='max-w-60'>
          {state.error}
        </Typography>
      )}
      {state?.result && !state.busy && !state.error && (
        <div className='flex max-w-72 flex-col'>
          <Typography variant='caption' color='text.secondary' title={formatDateTime(state.result.at)}>
            {`${state.result.found} found · ${state.result.stored} stored`}
            {state.result.skipped > 0 ? ` · ${state.result.skipped} skipped` : ''}
          </Typography>
          {/* Where it looked. A 0 from INBOX is most often a Gmail filter that
              archives AJIO mail — it never reaches INBOX, and nothing errors. */}
          <Typography variant='caption' color='text.secondary'>
            {`in ${state.result.folder || 'INBOX'} since ${formatDate(state.result.since)}`}
          </Typography>
          {state.result.found === 0 && (state.result.folder || 'INBOX').toUpperCase() === 'INBOX' && (
            <Typography variant='caption' color='warning.main'>
              Only the Inbox was searched. If a Gmail filter archives AJIO mail, set the mail folder to All Mail
              in the web admin (Settings → Integrations).
            </Typography>
          )}
        </div>
      )}
    </div>
  )
}
