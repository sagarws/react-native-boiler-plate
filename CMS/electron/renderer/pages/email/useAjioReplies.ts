import { useCallback, useEffect, useRef, useState } from 'react'

import type { AjioEmailRow, AjioReplyOutcome, AjioReplyResult, MailboxSummary } from '@shared/types/emailReply'
import type { Result } from '@shared/types/result'
import { listAjioEmails, replyToAjioEmail } from '@renderer/services/emailReply.service'
import { useToast } from '@renderer/hooks/useToast'
import { requestIds } from '@shared/utils/ajioSubject'
import { desktopUnsupported } from './emailReplyFormat'

/** One Reply, as its row shows it: sending, or how the last attempt ended. */
export interface ReplyState {
  busy: boolean
  result: AjioReplyResult | null
}

/** What Reply all found, before anything is sent. */
export interface ReplyAllPlan {
  targets: AjioEmailRow[]
  /** Pending, but not answerable from this computer (no mailbox, OAuth, Outlook…). */
  skipped: number
}

export interface ReplyAllProgress {
  done: number
  total: number
}

/** Rows per list request while collecting, and the most one Reply all will send. */
const COLLECT_PAGE_SIZE = 100
const REPLY_ALL_MAX = 1000

/** Sent, or sent and not recorded: either way it has gone, and must not go twice. */
const isGone = (outcome: AjioReplyOutcome | undefined): boolean =>
  outcome === 'replied' || outcome === 'sent-unrecorded'

const labelOf = (row: AjioEmailRow): string => requestIds(row.subject)[0] ?? row.subject

/**
 * Reply and Reply all — owned by the page, not the emails tab, so a Reply all
 * keeps its progress on screen when the operator switches tabs and back.
 *
 * REPLY ALL SENDS ONE AT A TIME. A burst of SMTP sessions is what Gmail
 * throttles and flags; each send also waits on TrackVid's claim, which is what
 * stops this app and TrackVid's own worker from answering the same request
 * twice. It stops when asked, and when the page is left — mail keeps going out
 * only while someone can see it going.
 */
export const useAjioReplies = () => {
  const [replies, setReplies] = useState<Record<string, ReplyState>>({})
  // Bumped when a reply has gone out, so the Pending/Replied counts reload.
  const [revision, setRevision] = useState(0)
  const [progress, setProgress] = useState<ReplyAllProgress | null>(null)
  const stopRequested = useRef(false)
  const repliesRef = useRef(replies)
  const toast = useToast()

  // The loop reads the latest outcomes between sends, not the ones it started with.
  useEffect(() => {
    repliesRef.current = replies
  }, [replies])

  // Leaving the page stops a Reply all after the send in flight.
  useEffect(
    () => () => {
      stopRequested.current = true
    },
    []
  )

  const runReply = useCallback(
    async (row: AjioEmailRow, quiet = false): Promise<AjioReplyResult> => {
      const label = labelOf(row)

      setReplies(current => ({ ...current, [row.id]: { busy: true, result: current[row.id]?.result ?? null } }))

      const response = row.mailboxId
        ? await replyToAjioEmail(row.id, row.mailboxId)
        : ({ success: false, error: { code: 'VALIDATION_ERROR', message: 'This email has no mailbox' } } as const)

      const result: AjioReplyResult = response.success
        ? response.data
        : {
            emailId: row.id,
            outcome: 'failed',
            message: response.error.message,
            replyId: null,
            at: new Date().toISOString()
          }

      setReplies(current => ({ ...current, [row.id]: { busy: false, result } }))

      if (isGone(result.outcome)) setRevision(count => count + 1)

      if (!quiet) {
        if (result.outcome === 'replied') toast.success(`${label}: reply sent`)
        else if (result.outcome === 'refused') toast.info(`${label}: not sent — ${result.message}`)
        else toast.error(`${label}: ${result.message}`)
      }

      return result
    },
    [toast]
  )

  const startReply = useCallback((row: AjioEmailRow): void => void runReply(row), [runReply])

  /**
   * Every pending email this computer can answer, across every page. Read
   * first and confirmed before anything is sent — the count on screen is what
   * the operator agrees to.
   */
  const collect = useCallback(async (mailboxes: MailboxSummary[]): Promise<Result<ReplyAllPlan>> => {
    const byId = new Map(mailboxes.map(mailbox => [mailbox.id, mailbox]))
    const targets: AjioEmailRow[] = []
    let skipped = 0

    for (let page = 1; targets.length < REPLY_ALL_MAX; page += 1) {
      const response = await listAjioEmails({ status: 'pending', page, pageSize: COLLECT_PAGE_SIZE })

      if (!response.success) return response

      for (const row of response.data.items) {
        if (isGone(repliesRef.current[row.id]?.result?.outcome)) continue

        const mailbox = row.mailboxId ? byId.get(row.mailboxId) : undefined

        if (mailbox && desktopUnsupported(mailbox) === null) targets.push(row)
        else skipped += 1
      }

      if (!response.data.hasMore) break
    }

    return { success: true, data: { targets: targets.slice(0, REPLY_ALL_MAX), skipped } }
  }, [])

  const replyAll = useCallback(
    async (targets: AjioEmailRow[]): Promise<void> => {
      stopRequested.current = false
      setProgress({ done: 0, total: targets.length })

      const tally: Record<AjioReplyOutcome, number> = { replied: 0, refused: 0, failed: 0, 'sent-unrecorded': 0 }
      // The reasons, grouped: forty identical refusals are one cause.
      const reasons = new Map<string, number>()
      let done = 0

      try {
        for (const row of targets) {
          if (stopRequested.current) break
          if (isGone(repliesRef.current[row.id]?.result?.outcome)) continue

          const result = await runReply(row, true)

          tally[result.outcome] += 1
          if (result.outcome !== 'replied') reasons.set(result.message, (reasons.get(result.message) ?? 0) + 1)
          done += 1
          setProgress({ done, total: targets.length })
        }
      } finally {
        setProgress(null)
      }

      const stopped = done < targets.length ? ` — stopped after ${done} of ${targets.length}` : ''
      const summary = `Reply all: ${tally.replied} sent, ${tally.refused} not sent, ${tally.failed + tally['sent-unrecorded']} failed${stopped}`
      const topReason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]
      const line = topReason ? `${summary}. Most common: ${topReason[0]} (${topReason[1]})` : summary

      if (tally.failed + tally['sent-unrecorded'] > 0) toast.error(line)
      else if (tally.refused > 0) toast.info(line)
      else toast.success(line)
    },
    [runReply, toast]
  )

  const stop = useCallback((): void => {
    stopRequested.current = true
  }, [])

  return { replies, revision, progress, startReply, collect, replyAll, stop }
}
