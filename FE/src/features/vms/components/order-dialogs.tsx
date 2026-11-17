"use client";

import { useState, type FormEvent } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { TextField, TextareaField } from "@/components/ui/form-field";
import { errorMessage, toast } from "@/lib/events";
import { VmsService } from "@/services/vms-service";
import type { VmsOrder } from "@/types/vms";

/** TrackVid `AddComment`: one multiline comment per order; "Update" when a comment exists. */
export function AddCommentDialog({ order, onClose, onSaved }: { order: VmsOrder; onClose: () => void; onSaved: (comment: string) => void }) {
  const existing = order.comment ?? "";
  const [comment, setComment] = useState(existing);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await VmsService.addComment({ _id: order._id, comment });
      toast.success(res.displayMessage);
      onSaved(res.comment);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      title="Add Comment"
      onClose={onClose}
      size="sm"
      locked={saving}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="vms-comment-form" className="primary-button" disabled={saving}>
            {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {existing ? "Update" : "Submit"}
          </button>
        </>
      }
    >
      <form id="vms-comment-form" className="tv-stack" onSubmit={(e) => void submit(e)}>
        <p className="tv-muted tv-small">
          Scanned number <span className="tv-mono">{order.trackingId}</span>
        </p>
        <TextareaField label="Comment" name="comment" rows={4} value={comment} autoFocus onChange={(e) => setComment(e.currentTarget.value)} />
      </form>
    </AppDialog>
  );
}

/** TrackVid `EditTrackingIdModal` validation: required, trimmed, at most 100 characters. */
function validateTrackingId(value: string): string | null {
  const v = value.trim();
  if (!v) return "Tracking ID is required";
  if (v.length > 100) return "Tracking ID is too long";
  return null;
}

/** TrackVid `EditTrackingIdModal`. An unchanged value just closes the dialog. */
export function EditTrackingIdDialog({ order, onClose, onSaved }: { order: VmsOrder; onClose: () => void; onSaved: (updated: VmsOrder) => void }) {
  const [trackingId, setTrackingId] = useState(order.trackingId);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const error = touched ? validateTrackingId(trackingId) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (validateTrackingId(trackingId)) return;
    if (trackingId.trim() === order.trackingId) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const res = await VmsService.updateTrackingId({ orderId: order._id, trackingId: trackingId.trim() });
      toast.success(res.displayMessage || "Tracking ID updated successfully");
      onSaved(res.data);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update tracking ID"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      title="Edit Tracking ID"
      onClose={onClose}
      size="sm"
      locked={saving}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="vms-tracking-form" className="primary-button" disabled={saving}>
            {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            Update
          </button>
        </>
      }
    >
      <form id="vms-tracking-form" className="tv-stack" onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          label="Tracking ID"
          name="trackingId"
          value={trackingId}
          autoFocus
          required
          maxLength={120}
          error={error}
          onBlur={() => setTouched(true)}
          onChange={(e) => setTrackingId(e.currentTarget.value)}
        />
      </form>
    </AppDialog>
  );
}
