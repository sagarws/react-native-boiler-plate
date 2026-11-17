"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { downloadBlob } from "@/lib/download";
import { formatBytes } from "@/lib/format";
import { useAsync } from "@/lib/use-async";

/**
 * Inline preview of a local File (image or PDF). The object URL is created in an effect, written
 * straight to the element and revoked on cleanup.
 */
export function LocalFilePreview({ file, compact = false }: { file: File; compact?: boolean }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";

  useEffect(() => {
    if (!isImage && !isPdf) return;
    const url = URL.createObjectURL(file);
    if (imgRef.current) imgRef.current.src = url;
    if (frameRef.current) frameRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, isImage, isPdf]);

  if (isImage) return <img ref={imgRef} alt={`Preview of ${file.name}`} className={`tv-acc-preview-img ${compact ? "is-compact" : ""}`.trim()} />;
  if (isPdf && !compact) return <iframe ref={frameRef} title={`Preview of ${file.name}`} className="tv-acc-preview-frame" />;
  return (
    <div className="tv-acc-file-chip">
      <Icon name="file-text" />
      <span>
        <strong>{file.name}</strong>
        <small>{formatBytes(file.size)}</small>
      </span>
    </div>
  );
}

/** Dialog that loads a file record and shows it; falls back to a generated receipt for sample data. */
export function FilePreviewDialog({
  title,
  load,
  fallbackSrc,
  onClose,
}: {
  title: string;
  load: () => Promise<{ name: string; file: File | null }>;
  fallbackSrc: string;
  onClose: () => void;
}) {
  const { data, loading, error, reload } = useAsync(load, []);
  return (
    <AppDialog
      title={title}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {data?.file ? (
            <button type="button" className="secondary-button" onClick={() => data.file && downloadBlob(data.file, data.name)}>
              <Icon name="download" /> Download
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {loading ? (
        <LoadingState label="Loading file…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data ? (
        <div className="tv-stack">
          <span className="tv-muted tv-small">{data.name}</span>
          {data.file ? <LocalFilePreview file={data.file} /> : <img src={fallbackSrc} alt={`Preview of ${data.name}`} className="tv-acc-preview-img" />}
        </div>
      ) : null}
    </AppDialog>
  );
}
