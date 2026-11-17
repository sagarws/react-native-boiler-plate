"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { AppDialog, type DialogSize } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { FileDrop } from "@/components/ui/file-drop";
import { errorMessage, toast } from "@/lib/events";
import { formatBytes, formatNumber } from "@/lib/format";
import type { ImportJobSummary } from "@/types/imports";

export const SHEET_ACCEPT = ".csv,.xlsx,.xls";

type Phase = "form" | "uploading" | "processing" | "done";

export interface SampleSheet {
  label: string;
  /** Static file under `public/` (downloaded with an <a download>). */
  href?: string;
  /** Or a handler that builds the file (e.g. a service blob). */
  onDownload?: () => void;
}

export interface ImportDialogShellProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  accept?: string;
  /** Single-file dialogs: pass both to render the drop area + selected file row. */
  file?: File | null;
  onFileChange?: (file: File | null) => void;
  /** Extra form fields above the file picker (platform selects, email, file tiles…). */
  extraBody?: ReactNode;
  /** Defaults to "a file is selected". */
  canUpload?: boolean;
  uploadLabel?: string;
  /** Runs before upload; return a message to block (shown as a toast, like TrackVid). */
  validate?: () => string | null;
  onUpload: () => Promise<ImportJobSummary>;
  sampleSheet?: SampleSheet;
  /** Toast once processing finishes (ignored when `onFinished` is passed). */
  successMessage?: string;
  onFinished?: (summary: ImportJobSummary) => void;
  /** Reset the form fields for "Upload another file". */
  onReset?: () => void;
  onClose: () => void;
  size?: DialogSize;
}

/**
 * TrackVid `ImportDialogShell` on the template dialog: file pick → mock parse/upload → background processing
 * progress (timer, cleared on unmount) → result summary.
 */
export function ImportDialogShell({
  title,
  subtitle,
  icon = "upload",
  accept = SHEET_ACCEPT,
  file,
  onFileChange,
  extraBody,
  canUpload,
  uploadLabel = "Upload File",
  validate,
  onUpload,
  sampleSheet,
  successMessage = "File uploaded successfully",
  onFinished,
  onReset,
  onClose,
  size = "md",
}: ImportDialogShellProps) {
  const [phase, setPhase] = useState<Phase>("form");
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ImportJobSummary | null>(null);
  const finishRef = useRef<{ onFinished?: (s: ImportJobSummary) => void; successMessage: string; summary: ImportJobSummary | null }>({ successMessage, summary: null });

  useEffect(() => {
    finishRef.current = { onFinished, successMessage, summary };
  });

  // Simulated background processing of the queued import job.
  useEffect(() => {
    if (phase !== "processing") return;
    let value = 0;
    const id = window.setInterval(() => {
      value = Math.min(100, value + 7 + Math.round(Math.random() * 9));
      setProgress(value);
      if (value >= 100) {
        window.clearInterval(id);
        setPhase("done");
        const { onFinished: finish, successMessage: msg, summary: result } = finishRef.current;
        if (result) {
          if (finish) finish(result);
          else if (result.queued) toast.success(result.message);
          else toast.success(msg);
        }
      }
    }, 170);
    return () => window.clearInterval(id);
  }, [phase]);

  const ready = canUpload ?? Boolean(file);
  const busy = phase === "uploading";

  const start = async () => {
    const problem = validate?.() ?? null;
    if (problem) {
      toast.error(problem);
      return;
    }
    setPhase("uploading");
    try {
      const result = await onUpload();
      setSummary(result);
      setProgress(0);
      setPhase("processing");
    } catch (err) {
      toast.error(errorMessage(err, "Upload failed"));
      setPhase("form");
    }
  };

  const close = () => {
    if (phase === "processing") toast("Import continues in the background. You will be notified when it finishes.");
    onClose();
  };

  const reset = () => {
    onFileChange?.(null);
    onReset?.();
    setSummary(null);
    setProgress(0);
    setPhase("form");
  };

  let footer: ReactNode;
  if (phase === "done") {
    footer = (
      <>
        <button type="button" className="secondary-button" onClick={reset}>
          Upload another file
        </button>
        <button type="button" className="primary-button" onClick={onClose}>
          Done
        </button>
      </>
    );
  } else if (phase === "processing") {
    footer = (
      <button type="button" className="secondary-button" onClick={close}>
        Run in background
      </button>
    );
  } else {
    footer = (
      <>
        <button type="button" className="secondary-button" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="primary-button" onClick={start} disabled={busy || !ready}>
          {busy ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="upload" />}
          {busy ? "Uploading…" : uploadLabel}
        </button>
      </>
    );
  }

  return (
    <AppDialog
      title={
        <span className="tv-import-title">
          <span className="tv-import-title-icon">
            <Icon name={icon} />
          </span>
          <span>
            {title}
            {subtitle ? <small>{subtitle}</small> : null}
          </span>
        </span>
      }
      onClose={close}
      size={size}
      locked={busy}
      className="product-import-dialog tv-import-dialog"
      footer={footer}
    >
      {phase === "processing" || phase === "done" ? (
        <ImportResult phase={phase} progress={progress} summary={summary} />
      ) : (
        <div className="tv-stack tv-import-body">
          {extraBody}
          {onFileChange ? (
            file ? (
              <SelectedFile file={file} onRemove={() => onFileChange(null)} disabled={busy} />
            ) : (
              <FileDrop
                accept={accept}
                disabled={busy}
                onFiles={(files) => onFileChange(files[0] ?? null)}
                title="Click to browse or drag-and-drop"
                hint={`Accepted formats: ${accept.split(",").join(", ").toUpperCase()}`}
              />
            )
          ) : null}
          {sampleSheet ? <SampleSheetLink sample={sampleSheet} /> : null}
        </div>
      )}
    </AppDialog>
  );
}

function ImportResult({ phase, progress, summary }: { phase: Phase; progress: number; summary: ImportJobSummary | null }) {
  if (!summary) return null;
  if (phase === "processing") {
    return (
      <div className="tv-import-progress" role="status" aria-live="polite">
        <div className="tv-row-between">
          <strong>{summary.queued ? "Queued — waiting for the current import" : "Processing records…"}</strong>
          <span className="tv-mono">{progress}%</span>
        </div>
        <div className="tv-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <p className="tv-muted tv-small">
          {summary.fileName} · {formatNumber(summary.totalRecords)} rows read. You can close this dialog; the import keeps running.
        </p>
      </div>
    );
  }
  return (
    <div className="tv-stack">
      <Banner tone={summary.failed ? "warning" : "success"} title={summary.queued ? "Import queued and processed" : "Import complete"}>
        {summary.message}
      </Banner>
      <div className="tv-import-summary">
        <div>
          <span>Total rows</span>
          <strong>{formatNumber(summary.totalRecords)}</strong>
        </div>
        <div>
          <span>Inserted</span>
          <strong className="is-green">{formatNumber(summary.inserted)}</strong>
        </div>
        <div>
          <span>Updated</span>
          <strong className="is-blue">{formatNumber(summary.updated)}</strong>
        </div>
        <div>
          <span>Failed</span>
          <strong className={summary.failed ? "is-red" : undefined}>{formatNumber(summary.failed)}</strong>
        </div>
      </div>
      <dl className="tv-kv">
        <dt>File</dt>
        <dd>{summary.fileName}</dd>
        <dt>Job ID</dt>
        <dd className="tv-mono">{summary.jobId}</dd>
      </dl>
      {summary.errors.length ? (
        <div className="tv-import-errors">
          <strong>Rows skipped</strong>
          <ul>
            {summary.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function SelectedFile({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled?: boolean }) {
  return (
    <div className="tv-import-file">
      <span className="tv-import-file-icon">
        <Icon name="file-text" />
      </span>
      <span className="tv-import-file-meta">
        <strong title={file.name}>{file.name}</strong>
        <small>{formatBytes(file.size)}</small>
      </span>
      <button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={onRemove} disabled={disabled}>
        <Icon name="x" />
      </button>
    </div>
  );
}

/** Dashed tile for one named report (TrackVid `FileTile` in MasterFilePickerModel). */
export function FileTile({
  label,
  hint = "Click to browse",
  help,
  file,
  onPick,
  onRemove,
  accept = SHEET_ACCEPT,
}: {
  label: string;
  hint?: string;
  /** Where to find the report (TrackVid shows it as a tooltip). */
  help?: string;
  file: File | null;
  onPick: (file: File) => void;
  onRemove: () => void;
  accept?: string;
}) {
  const id = useId();
  if (file) {
    return (
      <div className="tv-import-tile is-filled" title={help}>
        <SelectedFile file={file} onRemove={onRemove} />
      </div>
    );
  }
  return (
    <label htmlFor={id} className="tv-import-tile" title={help}>
      <span className="tv-import-file-icon">
        <Icon name="upload" />
      </span>
      <span className="tv-import-file-meta">
        <strong>{label}</strong>
        <small>{help ? `${hint} · ${help}` : hint}</small>
      </span>
      <input
        id={id}
        type="file"
        className="sr-only"
        accept={accept}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) onPick(f);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function SampleSheetLink({ sample }: { sample: SampleSheet }) {
  return (
    <div className="tv-import-sample">
      <Icon name="file-text" />
      <span className="tv-muted">Need a template?</span>
      {sample.href ? (
        <a className="tv-link" href={sample.href} download>
          <Icon name="download" /> {sample.label}
        </a>
      ) : (
        <button type="button" className="tv-link" onClick={sample.onDownload}>
          <Icon name="download" /> {sample.label}
        </button>
      )}
    </div>
  );
}
