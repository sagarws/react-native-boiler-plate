"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { downloadBlob } from "@/lib/download";
import { formatBytes } from "@/lib/format";
import { SupportChatService } from "@/services/supportChat-service";
import type { SupportAttachment } from "@/types/support";
import { isImageMime, isPdfMime } from "./support-helpers";

/**
 * Points an <img> / <iframe> at a Blob through an object URL created in an effect and revoked on cleanup
 * (so no URL outlives the element that shows it).
 */
function useBlobSrc<T extends HTMLImageElement | HTMLIFrameElement>(blob: Blob | null) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!blob || !el) return;
    const url = URL.createObjectURL(blob);
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return ref;
}

function BlobImage({ blob, alt, className }: { blob: Blob; alt: string; className?: string }) {
  const ref = useBlobSrc<HTMLImageElement>(blob);
  return <img ref={ref} alt={alt} className={className} />;
}

function BlobFrame({ blob, title }: { blob: Blob; title: string }) {
  const ref = useBlobSrc<HTMLIFrameElement>(blob);
  return <iframe ref={ref} title={title} className="tv-support-preview-frame" />;
}

/** A file picked in the composer / new-ticket dialog, before it is sent. */
export function PendingFileChip({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled?: boolean }) {
  const image = isImageMime(file.type);
  return (
    <div className="tv-support-file-chip">
      {image ? (
        <BlobImage blob={file} alt="" className="tv-support-file-thumb" />
      ) : (
        <span className={`tv-support-file-icon ${isPdfMime(file.type) ? "is-pdf" : ""}`.trim()}>
          <Icon name="file-text" />
        </span>
      )}
      <span className="tv-support-file-meta">
        <strong title={file.name}>{file.name}</strong>
        <small>{formatBytes(file.size)}</small>
      </span>
      <button type="button" className="icon-button compact-button" aria-label={`Remove ${file.name}`} onClick={onRemove} disabled={disabled}>
        <Icon name="x" />
      </button>
    </div>
  );
}

/** TrackVid `AttachmentCard`: image thumbnail, or a file row for PDFs. Opens the preview dialog. */
export function AttachmentCard({ attachment, onOpen }: { attachment: SupportAttachment; onOpen: (a: SupportAttachment) => void }) {
  const blob = SupportChatService.getAttachmentBlob(attachment);
  if (isImageMime(attachment.mime)) {
    return (
      <button type="button" className="tv-support-attachment-image" onClick={() => onOpen(attachment)} aria-label={`Open ${attachment.name}`}>
        {blob ? <BlobImage blob={blob} alt={attachment.name} /> : <img src={attachment.url} alt={attachment.name} />}
        <span className="tv-support-attachment-open" aria-hidden="true">
          <Icon name="arrows-out" />
        </span>
      </button>
    );
  }
  return (
    <button type="button" className="tv-support-attachment-file" onClick={() => onOpen(attachment)}>
      <span className={`tv-support-file-icon ${isPdfMime(attachment.mime) ? "is-pdf" : ""}`.trim()}>
        <Icon name="file-text" />
      </span>
      <span className="tv-support-file-meta">
        <strong title={attachment.name}>{attachment.name}</strong>
        <small>{formatBytes(attachment.size)}</small>
      </span>
      <Icon name="external-link" />
    </button>
  );
}

/** Full-size view of an attachment (TrackVid opened it in a new tab; local files cannot be, so a dialog is used). */
export function AttachmentPreviewDialog({ attachment, onClose }: { attachment: SupportAttachment; onClose: () => void }) {
  const blob = SupportChatService.getAttachmentBlob(attachment);
  const image = isImageMime(attachment.mime);
  return (
    <AppDialog
      title={attachment.name}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {blob ? (
            <button type="button" className="secondary-button" onClick={() => downloadBlob(blob, attachment.name)}>
              <Icon name="download" /> Download
            </button>
          ) : (
            <a className="secondary-button" href={attachment.url} target="_blank" rel="noopener noreferrer">
              <Icon name="external-link" /> Open in new tab
            </a>
          )}
          <button type="button" className="primary-button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="tv-support-preview">
        {image ? (
          blob ? (
            <BlobImage blob={blob} alt={attachment.name} />
          ) : (
            <img src={attachment.url} alt={attachment.name} />
          )
        ) : blob ? (
          <BlobFrame blob={blob} title={attachment.name} />
        ) : (
          <p className="tv-muted">
            {attachment.name} · {formatBytes(attachment.size)}
          </p>
        )}
      </div>
    </AppDialog>
  );
}
