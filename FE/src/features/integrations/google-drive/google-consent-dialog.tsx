"use client";

import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { platformLogoUrl } from "@/components/ui/platform-logo";
import { sampleGoogleAccounts } from "@/mocks/integrations";
import type { GoogleConsentResult } from "@/types/integrations";

/**
 * Stand-in for Google's consent screen (no OAuth in this UI). Same outcomes as the real flow:
 * Allow with Drive ticked → connected; Drive unticked → `drive_scope_not_granted`; Cancel → `access_denied`.
 */
export function GoogleConsentDialog({
  busy,
  onAnswer,
  onClose,
}: {
  busy: boolean;
  onAnswer: (result: GoogleConsentResult | null) => void;
  onClose: () => void;
}) {
  const [account, setAccount] = useState(sampleGoogleAccounts[0]);
  const [allowDrive, setAllowDrive] = useState(true);
  const logo = platformLogoUrl("google-drive");

  return (
    <AppDialog
      title="Sign in with Google"
      onClose={onClose}
      size="sm"
      locked={busy}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={() => onAnswer(null)} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => onAnswer({ account, allowDrive })} disabled={busy}>
            {busy ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            Allow
          </button>
        </>
      }
    >
      <div className="tv-stack">
        <div className="tv-row">
          {logo ? <img src={logo} alt="" width={32} height={32} /> : null}
          <p className="tv-small">
            <strong>TrackVid</strong> wants to access your Google Account
          </p>
        </div>
        <fieldset className="tv-int-consent-accounts">
          <legend className="tv-small tv-muted">Choose an account</legend>
          {sampleGoogleAccounts.map((email) => (
            <label key={email} className="tv-check">
              <input type="radio" name="google-account" value={email} checked={account === email} onChange={() => setAccount(email)} disabled={busy} />
              {email}
            </label>
          ))}
        </fieldset>
        <hr className="tv-divider" />
        <p className="tv-small tv-muted">Select what TrackVid can access</p>
        <label className="tv-check">
          <input type="checkbox" checked={allowDrive} onChange={(e) => setAllowDrive(e.currentTarget.checked)} disabled={busy} />
          See, edit, create and delete only the specific Google Drive files you use with this app.
        </label>
        <p className="tv-small tv-muted">This is a demo consent screen: no Google account is contacted.</p>
      </div>
    </AppDialog>
  );
}
