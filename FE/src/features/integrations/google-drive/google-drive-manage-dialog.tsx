"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { platformLogoUrl } from "@/components/ui/platform-logo";
import { GOOGLE_DRIVE_DISCONNECTED_MESSAGE, GOOGLE_DRIVE_RETENTION_TEXT } from "@/config/app-constant";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/events";
import type { GoogleDriveStatus } from "@/types/integrations";

/** TrackVid `GoogleDriveManageDialog`: account details + reconnect / switch account / disconnect. */
export function GoogleDriveManageDialog({
  status,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
  onClose,
}: {
  status: GoogleDriveStatus | null;
  connecting: boolean;
  disconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const expired = status?.status === "token_expired";
  const logo = platformLogoUrl("google-drive");

  const handleDisconnect = async () => {
    const ok = await onDisconnect();
    if (ok) {
      toast.success(GOOGLE_DRIVE_DISCONNECTED_MESSAGE);
      setConfirmOpen(false);
      onClose();
    }
  };

  return (
    <>
      <AppDialog
        title={
          <span className="tv-int-dialog-head">
            {logo ? <img src={logo} alt="" width={28} height={28} /> : <Icon name="folder" />}
            Google Drive
          </span>
        }
        onClose={onClose}
        footer={
          <>
            <button type="button" className="danger-button tv-int-footer-start" onClick={() => setConfirmOpen(true)} disabled={disconnecting}>
              <Icon name="x-circle" /> Disconnect
            </button>
            <button type="button" className={expired ? "primary-button" : "secondary-button"} onClick={onConnect} disabled={connecting}>
              {connecting ? <span className="tv-spinner small" aria-hidden="true" /> : null}
              {expired ? "Reconnect" : "Switch account"}
            </button>
          </>
        }
      >
        <div className="tv-stack">
          <p className="tv-muted tv-small">
            Scan and Pack saves label and invoice PDFs in this Drive, inside a <b>{status?.rootFolderName}</b> folder with one sub-folder per week.{" "}
            {GOOGLE_DRIVE_RETENTION_TEXT}
          </p>
          <hr className="tv-divider" />
          <dl className="tv-kv">
            <dt>Account</dt>
            <dd>{status?.email ?? "—"}</dd>
            <dt>Name</dt>
            <dd>{status?.name ?? "—"}</dd>
            <dt>Status</dt>
            <dd>
              <span className={`c-status ${expired ? "amber" : "green"}`}>{expired ? "Access expired — reconnect" : "Connected"}</span>
            </dd>
            <dt>Connected on</dt>
            <dd>{status?.connectedAt ? formatDateTime(status.connectedAt) : "—"}</dd>
            {status?.rootFolderUrl ? (
              <>
                <dt>Folder</dt>
                <dd>
                  <a className="tv-link" href={status.rootFolderUrl} target="_blank" rel="noopener noreferrer">
                    Open in Google Drive
                  </a>
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      </AppDialog>

      {confirmOpen ? (
        <ConfirmDialog
          title="Disconnect Google Drive?"
          message="Scan and Pack will be unavailable until a Google Drive is connected again. Files already in your Drive stay there."
          confirmLabel="Disconnect"
          danger
          busy={disconnecting}
          onConfirm={() => void handleDisconnect()}
          onClose={() => setConfirmOpen(false)}
        />
      ) : null}
    </>
  );
}
