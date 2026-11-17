"use client";

import type { ReactNode } from "react";
import { AppDialog } from "@/components/ui/app-dialog";

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <AppDialog
      title={title}
      onClose={onClose}
      size="sm"
      locked={busy}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={danger ? "danger-button" : "primary-button"} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="tv-muted" style={{ lineHeight: 1.6 }}>
        {message}
      </div>
    </AppDialog>
  );
}
