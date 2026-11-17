"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { AppDialog } from "@/components/ui/app-dialog";
import { TextField } from "@/components/ui/form-field";
import { cmsValidation, firstError } from "@/features/cms/cms-validation";
import { copyText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { CmsService } from "@/services/cms-service";
import type { IEmailTemplate } from "@/types/cms";

/**
 * TrackVid `common/TextEditor/EditorModal`: claim email preview / editor. Without `cms::edit` the subject and
 * editor are read-only and Save is hidden; "Copy Email" copies the plain text (copyTrigger).
 * The body is server-generated HTML; the Tiptap schema drops scripts, handlers and unsafe links.
 */
export function EmailEditorDialog({
  awb,
  template,
  canEdit,
  onClose,
  onSaved,
}: {
  awb: string;
  template: IEmailTemplate;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body ?? "");
  const [copyTrigger, setCopyTrigger] = useState(0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = touched ? firstError(cmsValidation, { subject, body: body.replace(/<[^>]*>/g, " ") }) : {};

  const save = async () => {
    setTouched(true);
    const errs = firstError(cmsValidation, { subject, body: body.replace(/<[^>]*>/g, " ") });
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await CmsService.updateMailTemplate(template._id, { subject, body });
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
      title={
        <span className="tv-row">
          <span className="tv-small tv-muted">AWB Number</span>
          <span className="tv-cms-awb-chip">
            <span className="tv-mono">{awb}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Copy AWB number"
              title="Copy"
              onClick={() => {
                void copyText(awb).then((done) => (done ? toast.success("AWB number copied") : toast.error("Could not copy")));
              }}
            >
              <Icon name="copy" />
            </button>
          </span>
        </span>
      }
      onClose={onClose}
      size="wide"
      locked={busy}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={() => setCopyTrigger((n) => n + 1)}>
            <Icon name="copy" /> Copy Email
          </button>
          {canEdit ? (
            <button type="button" className="primary-button" onClick={() => void save()} disabled={busy}>
              {busy ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="floppy-disk" />}
              Save
            </button>
          ) : null}
        </>
      }
    >
      <div className="tv-stack">
        <TextField label="Subject" value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.currentTarget.value)} error={errors.subject} />
        <RichTextEditor value={body} onChange={setBody} copyTrigger={copyTrigger} readOnly={!canEdit} label="Email body" />
        {errors.body ? <span className="tv-field-error">{errors.body}</span> : null}
      </div>
    </AppDialog>
  );
}
