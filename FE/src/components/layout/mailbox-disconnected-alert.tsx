"use client";

import { useRouter } from "next/navigation";
import { AppDialog } from "@/components/ui/app-dialog";
import ROUTE_URLS from "@/config/route";

const GMAIL_GUIDE_URL = "https://support.google.com/mail/answer/185833";
const OUTLOOK_GUIDE_URL = "https://support.microsoft.com/account-billing/how-to-get-and-use-app-passwords-5896ed9b-4263-e681-128a-a6f2979a7944";

/** TrackVid `MailboxDisconnectedAlert`. */
export function MailboxDisconnectedAlert({ disconnectedCount, totalCount, onClose }: { disconnectedCount: number; totalCount: number; onClose: () => void }) {
  const router = useRouter();
  return (
    <AppDialog
      title="Email Connection Issue"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              onClose();
              router.push(`${ROUTE_URLS.EMAILS}?tab=mailboxes`);
            }}
          >
            Reconnect email
          </button>
        </>
      }
    >
      <div className="tv-stack">
        <p>
          <strong>{disconnectedCount}</strong> of your <strong>{totalCount}</strong> connected mailbox{totalCount > 1 ? "es are" : " is"} currently
          disconnected. Your auto-replies will not work until the connection is restored.
        </p>
        <p className="tv-muted">Please reconnect your email to resume auto-replies. If you need help, refer to the guides below or contact support.</p>
        <div className="glass-card tv-stack" style={{ padding: 14, gap: 6 }}>
          <strong className="tv-small">Setup Guides:</strong>
          <a className="tv-link" href={GMAIL_GUIDE_URL} target="_blank" rel="noopener noreferrer">
            Gmail / Google Email Setup Guide
          </a>
          <a className="tv-link" href={OUTLOOK_GUIDE_URL} target="_blank" rel="noopener noreferrer">
            Outlook / Microsoft Email Setup Guide
          </a>
        </div>
      </div>
    </AppDialog>
  );
}
