"use client";

import { useState, type FormEvent } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { PasswordField } from "@/components/ui/form-field";
import { toast } from "@/lib/events";
import { MailboxService } from "@/services/mailbox-service";

/** TrackVid `UpdatePasswordModal.tsx`. Mount only while open. */
export function UpdatePasswordModal({
  mailboxId,
  mailboxEmail,
  onClose,
  onSuccess,
}: {
  mailboxId: string;
  mailboxEmail: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!password.trim()) {
      setError("Password is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await MailboxService.updateMailboxPassword(mailboxId, { password: password.trim() });
      if (res.success) {
        toast.success("Password updated successfully");
        setPassword("");
        onSuccess();
        onClose();
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Failed to update password";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppDialog
      title="Update App Password"
      size="sm"
      onClose={onClose}
      locked={loading}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void handleSubmit()} disabled={loading || !password.trim()}>
            {loading ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {loading ? "Updating..." : "Update Password"}
          </button>
        </>
      }
    >
      <form className="tv-stack" onSubmit={(e) => void handleSubmit(e)}>
        <p className="tv-muted">
          Update the app password for <strong>{mailboxEmail}</strong>
        </p>
        <PasswordField
          label="New App Password"
          required
          autoFocus
          autoComplete="new-password"
          placeholder="Enter your new app password"
          value={password}
          onChange={(e) => {
            setPassword(e.currentTarget.value);
            setError(null);
          }}
        />
        {error ? (
          <Banner tone="error" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        ) : null}
      </form>
    </AppDialog>
  );
}
