import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@renderer/components/ui/Button'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { Modal } from '@renderer/components/ui/Modal'
import { acceptTerms, declineTerms, termsStatus } from '@renderer/services/terms.service'
import { useAuth } from '@renderer/hooks/useAuth'

/**
 * The responsible-use notice, once per company, before the app is usable.
 *
 * AFTER SIGN-IN, NOT BEFORE. The answer lives on the company record, so there
 * is nothing to read until somebody is signed in — and asking first is how this
 * went wrong on the first build: the check ran with no token, failed closed,
 * and the notice then sat over the app for the whole session no matter what the
 * database said. The login screen renders untouched, and the question is asked
 * once the token exists.
 *
 * ASKED AGAIN WHEN THE USER CHANGES, because the company might have: signing
 * out and in as somebody else is a different company record, with its own
 * answer.
 *
 * SHOWN ON DOUBT. The status read fails closed — offline, or a backend that
 * cannot answer, means the notice appears. Accepting again costs a moment;
 * assuming an agreement because a request timed out is the failure that cannot
 * be undone.
 *
 * EXCEPT A DEAD TOKEN. A 401 on the stored token (logged out elsewhere,
 * password changed, expired) is not doubt — neither the read nor the write can
 * ever succeed with it, and the token survives a restart. Showing the notice
 * then left Exit as the only working button, on every launch. That case signs
 * out to the login screen instead.
 *
 * NOT DISMISSIBLE. No Escape, no backdrop click, no close button: an agreement
 * somebody got past by pressing Escape is not one. The way out is Exit, which
 * records the refusal and closes the app.
 *
 * THE CHECKBOX IS NOT DECORATION — the button stays disabled until it is
 * ticked, so accepting is an act rather than the fastest way to make a dialog
 * go away.
 *
 * WORDING. Short enough to be read, and it says the four things that matter:
 * the operator decides how the app is used, marketplace terms and the law
 * apply, not every platform formally supports automated access, and TrackVid is
 * not answerable for what a marketplace does about an account. It does not
 * claim any endorsement by those platforms, because there is none.
 */

interface Props {
  /** Rendered once the company has agreed. */
  children: React.ReactNode
}

type Phase = 'checking' | 'asking' | 'agreed'

export const TermsGate = ({ children }: Props) => {
  const auth = useAuth()
  const signedIn = auth.status === 'authenticated'
  /** Re-asked when the ACCOUNT changes: another user may be another company. */
  const userId = auth.user?.id ?? null
  const { signOut } = auth
  /**
   * Who the answer on screen belongs to.
   *
   * Kept beside the phase rather than reset in an effect: setting state
   * synchronously as an effect runs cascades a render, and the thing being
   * expressed is simply "this answer is for that user". Another user — another
   * company — makes it stale, and the render below treats it as unanswered.
   */
  const [answeredFor, setAnsweredFor] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('checking')
  const [ticked, setTicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // Nothing to ask about until there is a company to ask about. The login
    // screen is `children`, and it renders untouched.
    if (!signedIn) return

    void termsStatus().then(response => {
      if (cancelled) return

      // A dead token — revoked, expired, or ended by a password change. Asking
      // would trap the operator: Agree is refused with the same token, and
      // reopening the app restores it. Back to the login screen instead.
      if (!response.success && response.error.sessionEnded) {
        void signOut()

        return
      }

      // A failed read is not an agreement.
      setPhase(response.success && response.data.agreed ? 'agreed' : 'asking')
      setAnsweredFor(userId)
      setTicked(false)
    })

    return () => {
      cancelled = true
    }
  }, [signedIn, userId, signOut])

  const agree = useCallback(async () => {
    setBusy(true)
    setError(null)

    const response = await acceptTerms()

    setBusy(false)

    // Same dead token, met on the write instead of the read (the session ended
    // while the notice was open). Retrying cannot succeed — sign in again.
    if (!response.success && response.error.sessionEnded) {
      void signOut()

      return
    }

    if (!response.success) {
      // Said here rather than swallowed: letting somebody in on an agreement
      // that was never written down means being asked again tomorrow with no
      // explanation.
      setError(`That did not save — ${response.error.message}`)

      return
    }

    setPhase('agreed')
  }, [signOut])

  const exit = useCallback(() => {
    setBusy(true)
    void declineTerms()
  }, [])

  // Signed out — the login screen, and no question to put yet.
  if (!signedIn) return <>{children}</>
  // Signed in, and the answer is either not back or belongs to whoever was
  // signed in before. Nothing is rendered rather than the app for a moment:
  // showing it and then covering it reveals what the notice is meant to gate.
  if (phase === 'checking' || answeredFor !== userId) return null
  if (phase === 'agreed') return <>{children}</>

  return (
    <Modal
      open
      title="Responsible Use & Agreement"
      // Not dismissible — see the header. Escape and the backdrop do nothing.
      onClose={() => undefined}
      busy
      footer={
        <>
          <Button variant="secondary" onClick={exit} disabled={busy}>
            Exit
          </Button>
          <Button icon={<ShieldCheck size={16} />} disabled={!ticked || busy} loading={busy} onClick={() => void agree()}>
            Agree &amp; Continue
          </Button>
        </>
      }
    >
      <div className="flex max-w-prose flex-col gap-4">
        <p className="text-sm leading-relaxed text-body">
          TrackVid CMS helps you manage and automate your claim work across marketplaces. How it is
          used stays in your hands, so please follow each marketplace&rsquo;s terms and any laws that
          apply to your business. Some platforms limit or do not formally support automated access —
          it is worth checking what applies to your accounts. TrackVid is not responsible for how the
          application is used, or for actions a marketplace may take on an account.
        </p>

        <Checkbox
          checked={ticked}
          onChange={() => setTicked(current => !current)}
          disabled={busy}
          ariaLabel="Agree to use this application responsibly"
          label="I understand and agree to use this application responsibly and in accordance with applicable platform rules and laws."
        />

        {error && (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
