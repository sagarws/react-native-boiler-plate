"use client";

import type { ReactNode } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { TEMP_PERMIT } from "@/config/constant";
import { SessionChip } from "@/features/integrations/session-chip";
import { describeSessionAge } from "@/features/integrations/session-state";
import type { CredentialSession } from "@/types/integrations";

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/**
 * The `</>` dialog: what the automation stored for one account's login session. Metadata only. Sellers
 * see the two dates; the plumbing (source, IP, profile, cookies) is TEMP_PERMIT-only, like TrackVid.
 */
export function SessionDetailsDialog({
  platformLabel,
  username,
  session,
  onClose,
}: {
  platformLabel: string;
  username: string;
  session: CredentialSession | null;
  onClose: () => void;
}) {
  return (
    <AppDialog
      title={
        <span className="tv-int-dialog-title">
          {platformLabel} session
          <small>{username}</small>
        </span>
      }
      onClose={onClose}
      footer={
        <button type="button" className="primary-button" onClick={onClose}>
          Close
        </button>
      }
    >
      {!session ? (
        <p className="tv-muted">
          No session stored for this account yet. Press Renew to log in and cache one — the automation needs it to file claims without a fresh
          login on every run.
        </p>
      ) : (
        <div className="tv-stack">
          <div>
            <SessionChip session={session} />
          </div>
          <dl className="tv-kv">
            <Row label="Expires" value={describeSessionAge(session.expiresAt)} />
            <Row label="Saved" value={describeSessionAge(session.savedAt)} />
            {TEMP_PERMIT && session.source ? <Row label="Source" value={session.source} /> : null}
            {TEMP_PERMIT && session.ip ? <Row label="Captured from" value={session.ip} /> : null}
            {TEMP_PERMIT && session.userId ? <Row label="Seller profile" value={session.userId} /> : null}
            {TEMP_PERMIT && typeof session.pobCount === "number" && session.pobCount > 0 ? <Row label="POB IDs" value={`${session.pobCount} resolved`} /> : null}
          </dl>
          {TEMP_PERMIT ? (
            <>
              <hr className="tv-divider" />
              <strong className="tv-small tv-muted">Cookies ({session.cookieNames?.length ?? 0})</strong>
              {(session.cookieNames ?? []).length === 0 ? (
                <p className="tv-small tv-muted">This platform stores a token rather than cookies.</p>
              ) : (
                <div className="tv-chips">
                  {(session.cookieNames ?? []).map((name) => (
                    <span key={name} className="tv-chip tv-mono">
                      {name}
                    </span>
                  ))}
                </div>
              )}
              <p className="tv-small tv-muted">Cookie values are never sent to the browser — only their names.</p>
            </>
          ) : null}
        </div>
      )}
    </AppDialog>
  );
}
