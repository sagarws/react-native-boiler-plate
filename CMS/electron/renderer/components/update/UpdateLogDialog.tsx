import { useCallback, useEffect, useState } from 'react'
import { ClipboardCopy, ScrollText } from 'lucide-react'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { updateClient } from '@renderer/services/update.service'
import type { UpdateLogEntry } from '@shared/types/update'

/**
 * What the updater actually did, on the machine it failed on.
 *
 * WHY IT IS ON THE SCREEN AND NOT ONLY IN A LOG FILE. When an update fails the
 * card has room for one sentence, and the sentence is a summary: "could not
 * check for updates". What settles it is the feed that was used, the status the
 * host answered and the file that was asked for — three facts that lived in a
 * log file on an operator's machine, which is exactly the machine nobody can
 * reach. Diagnosing a release meant asking for screenshots.
 *
 * THE RAW ERROR IS SHOWN, deliberately. This is not for everyone; it is for the
 * person being asked "what does it say?" down a phone line, and a tidied-up
 * version of the failure is the half that has already been read out.
 *
 * Read when opened, not watched: nobody has this in front of them until
 * something has already gone wrong.
 */

const LEVEL_COLOUR: Record<UpdateLogEntry['level'], string> = {
  info: 'text-muted',
  warn: 'text-warning-fg',
  error: 'text-danger-fg'
}

const clock = (at: string): string => {
  const parsed = new Date(at)

  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleTimeString()
}

const asText = (entries: UpdateLogEntry[]): string =>
  entries
    .map(entry => `${entry.at} [${entry.level}] ${entry.message}${entry.detail ? `\n    ${entry.detail}` : ''}`)
    .join('\n')

export const UpdateLogDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [entries, setEntries] = useState<UpdateLogEntry[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return

    let cancelled = false

    void updateClient.log().then(response => {
      if (!cancelled && response.success) setEntries(response.data)
    })

    return () => {
      cancelled = true
    }
  }, [open])

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(asText(entries)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [entries])

  return (
    <Modal
      open={open}
      title="Update log"
      description="What this machine asked for, and what came back."
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            icon={<ClipboardCopy size={16} />}
            disabled={entries.length === 0}
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing recorded yet. The log fills as the app checks for an update — press Try again to
          make it do so now.
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex flex-col gap-0.5 text-left">
              <span className="flex items-baseline gap-2">
                <span className="shrink-0 font-mono text-xs text-faint">{clock(entry.at)}</span>
                <span className={`text-sm ${LEVEL_COLOUR[entry.level]}`}>{entry.message}</span>
              </span>

              {/* The URL, the status, the raw error — the part worth reading out. */}
              {entry.detail && (
                <span className="ml-14 break-all font-mono text-xs text-faint">{entry.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/** The button that opens it. Sized for a corner, not for a toolbar. */
export const UpdateLogButton = ({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label="Show the update log"
    title="Show the update log"
    className="absolute right-3 top-3 rounded-md p-1.5 text-faint transition-colors hover:bg-surface-hover hover:text-secondary"
  >
    <ScrollText size={16} />
  </button>
)
