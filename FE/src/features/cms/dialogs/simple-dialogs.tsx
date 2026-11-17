"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { TextField } from "@/components/ui/form-field";
import { cmsReasonValidation, cmsTicketValidation, firstError } from "@/features/cms/cms-validation";
import { errorMessage, toast } from "@/lib/events";
import { CmsService } from "@/services/cms-service";
import { useSelector } from "@/store";
import { CMS_STATUS } from "@/config/constant";

/** TrackVid `AddTicketTicketModal` ("Add / Edit Ticket"). */
export function TicketDialog({ cms, onClose, onSaved }: { cms: { _id: string; ticket: string }; onClose: () => void; onSaved: () => void }) {
  const [ticket, setTicket] = useState(cms.ticket);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = firstError(cmsTicketValidation, { ticket });

  const submit = async () => {
    setTouched(true);
    if (errors.ticket) return;
    setBusy(true);
    try {
      const res = await CmsService.editCmsTicket({ _id: cms._id, ticket: ticket.trim() });
      toast.success(res.displayMessage);
      onClose();
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AppDialog
      title="Add / Edit Ticket"
      onClose={onClose}
      size="sm"
      locked={busy}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="cms-ticket-form" className="primary-button" disabled={busy}>
            {busy ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            Submit
          </button>
        </>
      }
    >
      <form
        id="cms-ticket-form"
        className="tv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField label="Ticket" value={ticket} autoFocus onChange={(e) => setTicket(e.currentTarget.value)} onBlur={() => setTouched(true)} error={touched && errors.ticket} />
      </form>
    </AppDialog>
  );
}

/** TrackVid `UpdateStatusToRejectModal` ("Add Reason"). */
export function RejectReasonDialog({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = firstError(cmsReasonValidation, { reason });

  const submit = async () => {
    setTouched(true);
    if (errors.reason) return;
    setBusy(true);
    try {
      const res = await CmsService.updateCmsStatus({ _id: id, status: CMS_STATUS.REJECTED, reason: reason.trim() });
      toast.success(res.displayMessage);
      onClose();
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AppDialog
      title="Add Reason"
      onClose={onClose}
      size="sm"
      locked={busy}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="cms-reject-form" className="primary-button" disabled={busy}>
            {busy ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            Submit
          </button>
        </>
      }
    >
      <form
        id="cms-reject-form"
        className="tv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField label="Reason" value={reason} autoFocus onChange={(e) => setReason(e.currentTarget.value)} onBlur={() => setTouched(true)} error={touched && errors.reason} />
      </form>
    </AppDialog>
  );
}

/** TrackVid `DeleteCmsConfirmModal`: type "Delete <id>" to confirm. */
export function DeleteClaimDialog({ cmsId, onClose, onDeleted }: { cmsId: string; onClose: () => void; onDeleted: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const expected = `Delete ${cmsId}`;
  const matched = value === expected;

  const confirm = async () => {
    if (!matched) return;
    setBusy(true);
    try {
      const res = await CmsService.deleteCMS(cmsId);
      toast.success(res.displayMessage || "Claim deleted successfully");
      onDeleted();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete claim"));
      setBusy(false);
    }
  };

  return (
    <AppDialog
      title={
        <span className="tv-row">
          <span className="tv-cms-danger-icon">
            <Icon name="trash" />
          </span>
          Delete {cmsId}
        </span>
      }
      onClose={onClose}
      size="sm"
      locked={busy}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={() => void confirm()} disabled={busy || !matched}>
            {busy ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            Delete
          </button>
        </>
      }
    >
      <div className="tv-stack">
        <p className="tv-muted">
          This action cannot be undone. To confirm, type <strong className="tv-mono">{expected}</strong> in the field below.
        </p>
        <TextField label={`Type "${expected}" to confirm`} value={value} autoFocus disabled={busy} onChange={(e) => setValue(e.currentTarget.value)} />
      </div>
    </AppDialog>
  );
}

/** Seller-portal credentials saved under Settings for one platform. */
export function useCredentialsFor(platform: string | undefined): { username: string }[] {
  const user = useSelector((s) => s.profile.userProfile);
  const p = (platform ?? "").toLowerCase().trim();
  if (!p) return [];
  return user?.company?.settings?.eCommercePlatformLoginInfo?.find((e) => e.eComPlatform?.toLowerCase() === p)?.info ?? [];
}

/** TrackVid `EditUsernameModal` ("Select Username"). */
export function EditUsernameDialog({ cms, onClose, onSaved }: { cms: { _id: string; eCommercePlatform: string }; onClose: () => void; onSaved: () => void }) {
  const credentials = useCredentialsFor(cms.eCommercePlatform);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!selected) {
      toast.error("Please select a credential");
      return;
    }
    setBusy(true);
    try {
      const res = await CmsService.updateCMS({ cmsId: cms._id, eCommercePlatform: cms.eCommercePlatform, username: selected });
      toast.success(res.displayMessage || "Username updated successfully");
      onClose();
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update username"));
      setBusy(false);
    }
  };

  return (
    <AppDialog
      title="Select Username"
      onClose={onClose}
      size="sm"
      locked={busy}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy || !selected || credentials.length === 0}>
            {busy ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            Submit
          </button>
        </>
      }
    >
      {credentials.length === 0 ? (
        <p className="tv-muted">No credentials found for {cms.eCommercePlatform || "this platform"}. Add credentials in Settings first.</p>
      ) : (
        <div className="tv-cms-choice-list" role="radiogroup" aria-label="Credentials">
          {credentials.map((cred) => (
            <label key={cred.username} className={`tv-cms-choice ${selected === cred.username ? "is-selected" : ""}`.trim()}>
              <input type="checkbox" checked={selected === cred.username} onChange={() => setSelected(cred.username)} />
              <span>{cred.username}</span>
            </label>
          ))}
        </div>
      )}
    </AppDialog>
  );
}
