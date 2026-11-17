"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FileDrop } from "@/components/ui/file-drop";
import { TextareaField, TextField } from "@/components/ui/form-field";
import { errorMessage, toast } from "@/lib/events";
import { SUPPORT_MAX_FILES, SupportChatService } from "@/services/supportChat-service";
import type { SupportTicket } from "@/types/support";
import { PendingFileChip } from "./support-attachments";
import { pickValidFiles, SUPPORT_ACCEPT } from "./support-helpers";

/** TrackVid "New ticket / Start a conversation" dialog: subject (required), description, attachments. */
export function NewTicketDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (ticket: SupportTicket) => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!subject.trim()) return;
    setCreating(true);
    const fd = new FormData();
    fd.append("subject", subject.trim());
    if (body.trim()) fd.append("body", body.trim());
    files.forEach((f) => fd.append("attachments", f));
    try {
      const res = await SupportChatService.createTicket(fd);
      toast.success("Ticket created");
      onCreated(res.data);
    } catch (err) {
      toast.error(errorMessage(err, "Could not create ticket"));
      setCreating(false);
    }
  };

  return (
    <AppDialog
      title="Start a conversation"
      onClose={onClose}
      locked={creating}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button type="submit" form="tv-support-new-ticket" className="primary-button" disabled={creating || !subject.trim()}>
            <Icon name="paper-plane" /> {creating ? "Sending…" : "Send"}
          </button>
        </>
      }
    >
      <form
        id="tv-support-new-ticket"
        className="tv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <p className="tv-muted tv-small">New ticket</p>
        <TextField
          label="Subject"
          required
          autoFocus
          value={subject}
          maxLength={200}
          onChange={(e) => setSubject(e.currentTarget.value)}
          placeholder="What can we help with?"
        />
        <TextareaField
          label="Describe your issue"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          placeholder="The more context you give, the faster we can help."
        />
        {files.length > 0 ? (
          <div className="tv-support-file-list">
            {files.map((f, idx) => (
              <PendingFileChip key={`${f.name}-${f.size}-${idx}`} file={f} disabled={creating} onRemove={() => setFiles((prev) => prev.filter((_, i) => i !== idx))} />
            ))}
          </div>
        ) : null}
        <FileDrop
          accept={SUPPORT_ACCEPT}
          multiple
          disabled={creating || files.length >= SUPPORT_MAX_FILES}
          title="Attach files"
          hint={`PNG, JPG, WEBP or PDF · up to 10 MB each · max ${SUPPORT_MAX_FILES} files`}
          onFiles={(picked) => setFiles((prev) => pickValidFiles(picked, prev))}
        />
      </form>
    </AppDialog>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="tv-support-rating" role="radiogroup" aria-label="Rate your experience">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={n <= value ? "is-on" : ""}
          // Clicking the current rating clears it (MUI Rating behaviour).
          onClick={() => onChange(value === n ? 0 : n)}
        >
          <Icon name="star" />
        </button>
      ))}
    </div>
  );
}

/** TrackVid "Resolution / Mark as resolved?" dialog with optional rating and comment. */
export function ResolveDialog({ ticketId, onClose, onResolved }: { ticketId: string; onClose: () => void; onResolved: (ticket: SupportTicket) => void }) {
  const [point, setPoint] = useState(0);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const handleResolve = async () => {
    setSaving(true);
    try {
      const res = await SupportChatService.resolve(ticketId, { feedbackPoint: point || undefined, feedback: text.trim() || undefined });
      toast.success("Ticket resolved");
      onResolved(res.data);
    } catch (err) {
      toast.error(errorMessage(err, "Could not resolve ticket"));
      setSaving(false);
    }
  };

  return (
    <AppDialog
      title="Mark as resolved?"
      size="sm"
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void handleResolve()} disabled={saving}>
            <Icon name="check-circle" /> {saving ? "Resolving…" : "Resolve"}
          </button>
        </>
      }
    >
      <div className="tv-stack">
        <p className="tv-muted">Optionally rate your experience and leave a note.</p>
        <StarRating value={point} onChange={setPoint} />
        <TextareaField label="Comment (optional)" rows={3} value={text} onChange={(e) => setText(e.currentTarget.value)} />
      </div>
    </AppDialog>
  );
}
