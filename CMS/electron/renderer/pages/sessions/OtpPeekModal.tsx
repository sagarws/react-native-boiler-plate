import { useCallback, useEffect, useState } from 'react'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import type { PeekedOtp } from '@shared/types/platformSession'
import { relativeTime } from '@shared/utils/sessionHealth'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useToast } from '@renderer/hooks/useToast'
import { copyToClipboard } from '@renderer/services/clipboard.service'
import { peekOtp } from '@renderer/services/platformSession.service'

/**
 * "Get OTP" — the newest code in the mailbox for one account, read on demand.
 *
 * For a person signing in by hand: they press "send code" on the marketplace,
 * then read it here instead of asking whoever has the mailbox.
 *
 * THE ARRIVAL TIME IS THE POINT, not decoration. The newest code in the
 * mailbox is often yesterday's — a forward that stopped, or a portal that sent
 * this one somewhere else — and a code typed without its time is a "wrong OTP"
 * nobody can explain. A code older than `STALE_AFTER_MS` says so in words.
 */

/** One code an account can be sent, and the mailbox reader key that reads it. */
export interface OtpSource {
  /** The reader key the main process knows — a platform, or e.g. `tatacliq-cloudflare`. */
  key: string
  label: string
  /** One line under the choice: when this code is the one being asked for. */
  hint: string
}

/** Marketplace codes expire in about ten minutes; older than that is not this login's. */
const STALE_AFTER_MS = 10 * 60_000

/**
 * Mounted only while open (the caller renders it conditionally), so every
 * opening starts from a clean state and reads the mailbox once.
 */
export const OtpPeekModal = ({
  onClose,
  platform,
  username,
  sources
}: {
  onClose: () => void
  /** Lower-cased platform key. */
  platform: string
  username: string
  /**
   * When an account can be sent more than one code (Tata CliQ: Cloudflare Access
   * and the seller zone's own), which one is read is ASKED first — reading the
   * wrong mailbox shows a real code for the wrong screen.
   */
  sources?: OtpSource[]
}) => {
  const toast = useToast()
  const choices = sources && sources.length > 1 ? sources : null
  // The reader key: the platform itself, or the operator's pick when there is a choice.
  const [source, setSource] = useState<string | null>(choices ? null : (sources?.[0]?.key ?? platform))
  const [loading, setLoading] = useState(source !== null)
  const [result, setResult] = useState<PeekedOtp | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Judged when the answer arrives, not while rendering — "is it old" needs
  // the clock, and a render must not read one.
  const [stale, setStale] = useState(false)

  const settle = useCallback((response: Awaited<ReturnType<typeof peekOtp>>): void => {
    setLoading(false)

    if (!response.success) {
      setResult(null)
      setError(response.error.message)

      return
    }

    const at = response.data.receivedAt ? Date.parse(response.data.receivedAt) : NaN

    setError(null)
    setResult(response.data)
    setStale(!Number.isNaN(at) && Date.now() - at > STALE_AFTER_MS)
  }, [])

  useEffect(() => {
    if (source === null) return

    let cancelled = false

    void peekOtp({ platform: source, username }).then(response => {
      if (!cancelled) settle(response)
    })

    return () => {
      cancelled = true
    }
  }, [source, username, settle])

  const load = async (): Promise<void> => {
    if (source === null) return
    setLoading(true)
    settle(await peekOtp({ platform: source, username }))
  }

  const choose = (key: string): void => {
    setResult(null)
    setError(null)
    setLoading(true)
    setSource(key)
  }

  const chosenLabel = choices?.find(choice => choice.key === source)?.label

  const copy = async (otp: string): Promise<void> => {
    const response = await copyToClipboard(otp)

    if (response.success) toast.success('Code copied')
    else toast.error(response.error.message)
  }

  const receivedAt = result?.receivedAt ? new Date(result.receivedAt) : null

  return (
    <Modal
      open
      title={chosenLabel ? `One-time code — ${chosenLabel}` : 'One-time code'}
      description={
        source === null
          ? `Which code do you need for ${username}?`
          : `The newest code in the mailbox for ${result?.address ?? username}.`
      }
      onClose={onClose}
      footer={
        <>
          {choices && source !== null && (
            <Button variant='secondary' disabled={loading} onClick={() => setSource(null)}>
              Other code
            </Button>
          )}
          {source !== null && (
            <Button
              variant='secondary'
              icon={<i className='tabler-refresh' />}
              disabled={loading}
              onClick={() => void load()}
            >
              Fetch again
            </Button>
          )}
          <Button variant='secondary' onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className='flex min-bs-32 flex-col items-center justify-center gap-3 text-center'>
        {source === null && choices ? (
          <div className='flex is-full flex-col gap-2'>
            {choices.map(choice => (
              <Button key={choice.key} variant='secondary' onClick={() => choose(choice.key)}>
                <span className='flex flex-col items-start text-start'>
                  <span className='font-medium'>{choice.label}</span>
                  <Typography component='span' variant='caption' color='text.secondary'>
                    {choice.hint}
                  </Typography>
                </span>
              </Button>
            ))}
          </div>
        ) : loading ? (
          <>
            <CircularProgress size={22} />
            <Typography variant='body2' color='text.secondary'>
              Reading the mailbox…
            </Typography>
          </>
        ) : error ? (
          <Typography variant='body2' color='error.main'>
            {error}
          </Typography>
        ) : result && !result.otp ? (
          <Typography variant='body2' color='text.secondary'>
            No code in the mailbox for {result.address}. Send one from the marketplace, then fetch again.
          </Typography>
        ) : result?.otp ? (
          <>
            <button
              type='button'
              title='Copy'
              onClick={() => void copy(result.otp!)}
              className='rounded-md plb-2 pli-4 font-mono text-4xl font-semibold tracking-widest text-textPrimary ring-1 ring-subtle hover:bg-surface-hover'
            >
              {result.otp}
            </button>
            <Typography variant='body2' color={stale ? 'warning.main' : 'text.secondary'}>
              {receivedAt
                ? `Mail received ${receivedAt.toLocaleString()} (${relativeTime(receivedAt.toISOString())})`
                : 'Arrival time unknown'}
            </Typography>
            {stale && (
              <Typography variant='caption' color='warning.main'>
                Older than ten minutes — probably not the code for a login you just started.
              </Typography>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  )
}
