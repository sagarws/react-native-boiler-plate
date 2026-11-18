import { useCallback, useEffect, useRef, useState } from 'react'

// MUI Imports
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'

import type { MailboxSummary } from '@shared/types/emailReply'
import { listMailboxes, refetchMailbox } from '@renderer/services/emailReply.service'
import { registerPageRefresh } from '@renderer/services/refreshRegistry'
import { useToast } from '@renderer/hooks/useToast'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { MailboxesTab, type RefetchState } from './MailboxesTab'
import { desktopUnsupported } from './emailReplyFormat'
import { AjioEmailsTab } from './AjioEmailsTab'
import { useAjioReplies, type ReplyAllPlan } from './useAjioReplies'

/**
 * The AJIO email auto-reply, from this machine.
 *
 * TWO TABS, the two screens an operator would otherwise open a browser for:
 * the mailboxes connected to the auto-reply (Settings → Integrations there),
 * and the AJIO footage requests with whether each has been answered (AJIO
 * Emails there).
 *
 * TWO ACTIONS, both performed here rather than on TrackVid's server: Refetch
 * reads a mailbox now, and Reply answers one request now — neither waits for
 * the server's polling cycle. TrackVid still decides what counts, builds the
 * reply and records the outcome. Adding a mailbox and editing the template
 * stay in the web admin.
 *
 * The mailbox list is loaded here rather than in its tab, because the emails
 * tab needs it too — to name the mailbox each email arrived in, and to filter
 * by one.
 */

type TabId = 'mailboxes' | 'emails'

export const EmailReplyPage = () => {
  const [tab, setTab] = useState<TabId>('mailboxes')
  const [mailboxes, setMailboxes] = useState<MailboxSummary[] | null>(null)
  const [mailboxError, setMailboxError] = useState<string | null>(null)
  /*
   * Bumped by the navbar's refresh and by Try again. The emails tab reloads on
   * it too, so one refresh brings both lists up to date.
   */
  const [refreshKey, setRefreshKey] = useState(0)
  const [refetch, setRefetch] = useState<Record<string, RefetchState>>({})
  const [refetchingAll, setRefetchingAll] = useState(false)
  const toast = useToast()
  const { replies, revision, progress, startReply, collect, replyAll, stop } = useAjioReplies()
  // Reply all: reading every pending page, then the count awaiting a yes.
  const [collecting, setCollecting] = useState(false)
  const [plan, setPlan] = useState<ReplyAllPlan | null>(null)
  const replyingAll = progress !== null
  // Which refresh the list on screen answers; loading is "not this one yet".
  const [answeredKey, setAnsweredKey] = useState(-1)
  const seq = useRef(0)
  const loadingMailboxes = answeredKey !== refreshKey

  useEffect(() => {
    // Only the latest answer lands: a slow first load must not overwrite the
    // refresh pressed after it.
    const mine = ++seq.current

    void listMailboxes().then(response => {
      if (mine !== seq.current) return

      setAnsweredKey(refreshKey)

      if (response.success) {
        setMailboxes(response.data)
        setMailboxError(null)
      } else {
        setMailboxError(response.error.message)
      }
    })

    // Unmounted, or superseded: the answer is for a page nobody is looking at.
    return () => {
      seq.current += 1
    }
  }, [refreshKey])

  /*
   * A refetch belongs to the page, not the tab: it outlives switching tabs,
   * and when it stores something both lists are out of date.
   *
   * `quiet` is for Refetch all, which says one thing at the end instead of one
   * toast per mailbox — six toasts is the stack that covers the window.
   */
  const runRefetch = useCallback(
    async (mailboxId: string, quiet = false): Promise<{ found: number; stored: number } | null> => {
      const email = mailboxes?.find(mailbox => mailbox.id === mailboxId)?.email ?? 'the mailbox'

      setRefetch(current => ({
        ...current,
        [mailboxId]: { busy: true, result: current[mailboxId]?.result ?? null, error: null }
      }))

      const response = await refetchMailbox(mailboxId)

      if (response.success) {
        const { found, stored } = response.data

        setRefetch(current => ({ ...current, [mailboxId]: { busy: false, result: response.data, error: null } }))

        if (!quiet) {
          toast.success(`${email}: ${found} AJIO request(s) found, ${stored} stored`)
          // New rows, and a new "last synced" — both lists move.
          setRefreshKey(key => key + 1)
        }

        return { found, stored }
      }

      setRefetch(current => ({
        ...current,
        [mailboxId]: { busy: false, result: current[mailboxId]?.result ?? null, error: response.error.message }
      }))
      if (!quiet) toast.error(`Refetch failed for ${email}: ${response.error.message}`)

      return null
    },
    [mailboxes, toast]
  )

  const startRefetch = useCallback((mailboxId: string): void => void runRefetch(mailboxId), [runRefetch])

  /*
   * Every mailbox this app can read, ONE AT A TIME — six IMAP sessions opened at
   * once is the pattern a provider rate-limits, and each upload already waits on
   * the server. Every row shows its own result as it lands; the summary and the
   * reload come once, at the end.
   */
  const refetchAll = useCallback(async (): Promise<void> => {
    const targets = (mailboxes ?? []).filter(
      mailbox => desktopUnsupported(mailbox) === null && refetch[mailbox.id]?.busy !== true
    )

    if (targets.length === 0) {
      toast.info('No mailbox here can be refetched from this computer')

      return
    }

    setRefetchingAll(true)

    let found = 0
    let stored = 0
    let failed = 0

    try {
      for (const mailbox of targets) {
        const outcome = await runRefetch(mailbox.id, true)

        if (outcome) {
          found += outcome.found
          stored += outcome.stored
        } else {
          failed += 1
        }
      }
    } finally {
      setRefetchingAll(false)
      setRefreshKey(key => key + 1)
    }

    const summary = `${targets.length - failed} of ${targets.length} mailbox(es) refetched: ${found} found, ${stored} stored`

    if (failed > 0) toast.error(`${summary} — ${failed} failed, see the rows`)
    else toast.success(summary)
  }, [mailboxes, refetch, runRefetch, toast])

  /*
   * REPLY ALL, IN TWO STEPS. Read every pending page first and say how many
   * would go — these are real emails to AJIO, and the number is what the
   * operator agrees to. Only then send, one at a time.
   */
  const planReplyAll = useCallback(async (): Promise<void> => {
    setCollecting(true)

    const response = await collect(mailboxes ?? [])

    setCollecting(false)

    if (!response.success) {
      toast.error(`Could not read the pending emails: ${response.error.message}`)

      return
    }

    if (response.data.targets.length === 0) {
      toast.info(
        response.data.skipped > 0
          ? `None of the ${response.data.skipped} pending email(s) can be answered from this computer`
          : 'Nothing is waiting for a reply'
      )

      return
    }

    setPlan(response.data)
  }, [collect, mailboxes, toast])

  const confirmReplyAll = useCallback((): void => {
    if (!plan) return

    const { targets } = plan

    setPlan(null)
    setTab('emails')
    void replyAll(targets).finally(() => setRefreshKey(key => key + 1))
  }, [plan, replyAll])

  useEffect(
    () =>
      registerPageRefresh(() => {
        setRefreshKey(key => key + 1)
      }),
    []
  )

  return (
    /*
     * FITTED TO THE WINDOW, the way Claims and Background Process are: the
     * shell sizes a `ts-layout-content-height-fixed` page to the window below
     * the navbar, and each `trackvid-table-scroll-host` passes that height on,
     * so the table is the only thing that scrolls — the tabs, the filters and
     * the pager stay where they are. See styles/behaviour.css.
     */
    <div className='ts-layout-content-height-fixed trackvid-table-fill flex flex-col gap-4'>
      <Typography color='text.secondary' className='shrink-0'>
        The AJIO email auto-reply. Refetch and Reply run from this computer, straight away; TrackVid
        builds the reply and records the result. Mailboxes and the reply template are changed in the
        TrackVid web admin.
      </Typography>

      <Card className='trackvid-table-scroll-host flex flex-col'>
        {/* The tabs, and the one action that spans every mailbox at their right. */}
        <Box
          className='flex shrink-0 items-center justify-between gap-4 pe-6'
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tabs
            value={tab}
            onChange={(_event, next: TabId) => setTab(next)}
            aria-label='Email reply sections'
            sx={{ paddingInline: 4 }}
          >
            <Tab value='mailboxes' label={`Mailboxes${mailboxes ? ` (${mailboxes.length})` : ''}`} />
            <Tab value='emails' label='AJIO Emails' />
          </Tabs>
          <div className='flex items-center gap-2'>
            {tab === 'emails' &&
              (replyingAll ? (
                <Button variant='secondary' size='sm' icon={<i className='tabler-player-stop' />} onClick={stop}>
                  {`Stop · ${progress.done} of ${progress.total} sent`}
                </Button>
              ) : (
                <Button
                  variant='primary'
                  size='sm'
                  loading={collecting}
                  disabled={collecting || !mailboxes || mailboxes.length === 0}
                  icon={<i className='tabler-send' />}
                  onClick={() => void planReplyAll()}
                >
                  {collecting ? 'Reading pending…' : 'Reply all pending'}
                </Button>
              ))}
            <Button
              variant='secondary'
              size='sm'
              loading={refetchingAll}
              disabled={refetchingAll || !mailboxes || mailboxes.length === 0}
              icon={<i className='tabler-mail-down' />}
              onClick={() => void refetchAll()}
            >
              {refetchingAll ? 'Refetching all…' : 'Refetch all'}
            </Button>
          </div>
        </Box>

        {/* Padding on every side, so nothing in a tab meets the card's edge. */}
        <div className='trackvid-table-scroll-host flex flex-col p-6'>
          {tab === 'mailboxes' ? (
            <MailboxesTab
              mailboxes={mailboxes}
              error={mailboxError}
              loading={loadingMailboxes}
              onReload={() => setRefreshKey(key => key + 1)}
              refetch={refetch}
              onRefetch={startRefetch}
              refetchLocked={refetchingAll}
            />
          ) : (
            <AjioEmailsTab
              mailboxes={mailboxes ?? []}
              refreshKey={refreshKey}
              replies={replies}
              onReply={startReply}
              replyRevision={revision}
            />
          )}
        </div>
      </Card>

      <Modal
        open={plan !== null}
        title='Reply to all pending AJIO emails?'
        onClose={() => setPlan(null)}
        footer={
          <div className='flex justify-end gap-2'>
            <Button variant='secondary' size='sm' onClick={() => setPlan(null)}>
              Cancel
            </Button>
            <Button variant='primary' size='sm' icon={<i className='tabler-send' />} onClick={confirmReplyAll}>
              {`Send ${plan?.targets.length ?? 0} replies`}
            </Button>
          </div>
        }
      >
        <div className='flex flex-col gap-3'>
          <Typography variant='body2' color='text.primary'>
            {`${plan?.targets.length ?? 0} pending email(s) will be answered from this computer, one at a time, with the reply TrackVid builds for each.`}
          </Typography>
          {plan && plan.skipped > 0 && (
            <Typography variant='body2' color='text.secondary'>
              {`${plan.skipped} more are pending but cannot be answered from here (no mailbox on record, or a mailbox this app cannot send from). They are left as they are.`}
            </Typography>
          )}
          <Typography variant='body2' color='text.secondary'>
            TrackVid still refuses any it should not send — already replied, no order found, no video — and
            those are listed on their rows. You can stop at any time; replies already sent stay sent.
          </Typography>
        </div>
      </Modal>
    </div>
  )
}
