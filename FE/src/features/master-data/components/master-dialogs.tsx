"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { TextField, TextareaField } from "@/components/ui/form-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { MASTER_DATA } from "@/config/constant";
import { errorMessage, toast } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { MasterData, getMasterOrderHistory } from "@/services/masterData-service";
import type { IMasterHistoryData, MasterHistoryEvent } from "@/types/master-data";

// ---------- Add / Edit Ticket (TrackVid AddMasterTicketModal, cmsTicketValidation) ----------

export function MasterTicketDialog({ masterData, onClose, onSaved }: { masterData: { _id: string; ticket: string }; onClose: () => void; onSaved: () => void }) {
  const [ticket, setTicket] = useState(masterData.ticket);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const error = touched && !ticket.trim() ? "Ticket is required" : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!ticket.trim()) return;
    setSaving(true);
    try {
      const res = await MasterData.editMasterTicket({ _id: masterData._id, ticket: ticket.trim() });
      toast.success(res.displayMessage);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      title="Add / Edit Ticket"
      onClose={onClose}
      size="sm"
      locked={saving}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="master-ticket-form" className="primary-button" disabled={saving}>
            {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            Submit
          </button>
        </>
      }
    >
      <form id="master-ticket-form" className="tv-stack" onSubmit={(e) => void submit(e)} noValidate>
        <TextField label="Ticket" name="ticket" value={ticket} autoFocus error={error} onBlur={() => setTouched(true)} onChange={(e) => setTicket(e.currentTarget.value)} />
      </form>
    </AppDialog>
  );
}

// ---------- Reject with reason (TrackVid UpdateStatusMasterRejectModel, cmsReasonValidation) ----------

export function MasterRejectDialog({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const error = touched && !reason.trim() ? "Reason is required" : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!reason.trim()) return;
    setSaving(true);
    try {
      const res = await MasterData.updateMasterStatus({ _id: id, status: MASTER_DATA.REJECTED, reason: reason.trim() });
      toast.success(res.displayMessage);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      title="Add Reason"
      onClose={onClose}
      size="sm"
      locked={saving}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="master-reject-form" className="danger-button" disabled={saving}>
            {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            Submit
          </button>
        </>
      }
    >
      <form id="master-reject-form" className="tv-stack" onSubmit={(e) => void submit(e)} noValidate>
        <TextareaField label="Reason" name="reason" value={reason} autoFocus rows={4} error={error} onBlur={() => setTouched(true)} onChange={(e) => setReason(e.currentTarget.value)} />
      </form>
    </AppDialog>
  );
}

// ---------- View reject reason (TrackVid MasterViewReason) ----------

export function MasterViewReasonDialog({ data, onClose }: { data: { returnAWB: string | null; forwardAWB: string | null; reason: string }; onClose: () => void }) {
  return (
    <AppDialog title="Reject Reason" onClose={onClose} size="md">
      <div className="tv-stack">
        {data.returnAWB || data.forwardAWB ? (
          <div className="tv-row">
            {data.returnAWB ? <span className="tv-history-awb">Return AWB <strong>{data.returnAWB}</strong></span> : null}
            {data.forwardAWB ? <span className="tv-history-awb">Forward AWB <strong>{data.forwardAWB}</strong></span> : null}
          </div>
        ) : null}
        <p className="tv-master-reason">{data.reason || "No reason was recorded."}</p>
      </div>
    </AppDialog>
  );
}

// ---------- Order history (TrackVid HistoryModal, HISTORY_TYPE_ENUM.MASTER_ORDER) ----------

const ACTION_ICON: Record<MasterHistoryEvent["action_type"], IconName> = {
  IMPORT: "upload",
  SCAN: "qr-code",
  STATUS: "check-circle",
  TICKET: "tag",
  CLAIM: "file-text",
};

export function MasterHistoryDialog({ historyId, returnAWB, forwardAWB, onClose }: { historyId: string; returnAWB: string; forwardAWB: string; onClose: () => void }) {
  const [data, setData] = useState<IMasterHistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    getMasterOrderHistory(historyId)
      .then((res) => {
        if (active) setData({ ...res, returnAWB, forwardAWB });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const msg = errorMessage(err);
        setError(msg);
        toast.error(msg);
      });
    return () => {
      active = false;
    };
  }, [historyId, returnAWB, forwardAWB, tick]);

  const retry = () => {
    setError(null);
    setData(null);
    setTick((t) => t + 1);
  };

  const events = data?.history ?? [];
  return (
    <AppDialog title="Order History" onClose={onClose} size="md">
      <div className="tv-stack">
        <div className="tv-row">
          {returnAWB ? <span className="tv-history-awb">Return AWB <strong>{returnAWB}</strong></span> : null}
          {forwardAWB ? <span className="tv-history-awb">Forward AWB <strong>{forwardAWB}</strong></span> : null}
        </div>
        {error ? (
          <ErrorState message={error} onRetry={retry} />
        ) : !data ? (
          <LoadingState label="Loading history…" />
        ) : !events.length ? (
          <EmptyState icon="history" title="No history yet" message="Changes to this order will appear here." />
        ) : (
          <ol className="tv-history-list">
            {events.map((h) => (
              <li key={h._id}>
                <time dateTime={h.date}>
                  <strong>{formatDate(h.date, "dd MMM yyyy")}</strong>
                  <small>{formatDate(h.date, "hh:mm a")}</small>
                </time>
                <span className="tv-history-dot">
                  <Icon name={ACTION_ICON[h.action_type]} />
                </span>
                <div>
                  <strong>{h.description}</strong>
                  <small>By {h.by}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </AppDialog>
  );
}
