"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { VideoPlayer } from "@/components/ui/video-player";
import { copyText, downloadBlob } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { FileService } from "@/services/file-service";
import { safeFormat } from "@/features/vms/vms-utils";
import type { VideoPreview } from "@/types/vms";

/** TrackVid `VideoModal`: player, scanned number (copy), order type, feed / date / time / size, S3 or Drive link, download. */
export function VideoPreviewDialog({ preview, onClose }: { preview: VideoPreview; onClose: () => void }) {
  const { url, title, createdAt, feedName, orderType, videoSize, fileKey } = preview;
  const video = useAsync(() => FileService.getFileUrl(url), [url]);
  const [linkType, setLinkType] = useState<"s3" | "drive">("s3");
  const [copyingLink, setCopyingLink] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const isReturn = orderType === "Return";

  const handleCopyLink = async () => {
    if (!fileKey) return;
    setCopyingLink(true);
    try {
      // First Drive click may take a moment (uploads to Drive); later clicks are instant (cached).
      const res = linkType === "drive" ? await FileService.getDriveLink(fileKey, title) : await FileService.getFileUrl(fileKey);
      const ok = await copyText(res.url);
      if (ok) toast.success(linkType === "drive" ? "Google Drive link copied!" : "S3 link copied to clipboard!");
      else toast.error("Clipboard is blocked in this browser.");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to copy link. Please retry."));
    } finally {
      setCopyingLink(false);
    }
  };

  const handleDownload = async () => {
    if (!video.data) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(video.data.url);
      // A 404 still resolves; never save an HTML error page named like the video.
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] ?? "mp4").split(";")[0];
      downloadBlob(blob, `${title}-${orderType}-${feedName}.${ext}`);
    } catch (err) {
      setDownloadError(errorMessage(err, "Download failed"));
    } finally {
      setDownloading(false);
    }
  };

  const copyAwb = async () => {
    if (await copyText(title)) toast.success("Tracking number copied");
  };

  return (
    <AppDialog
      size="wide"
      onClose={onClose}
      className="tv-vms-video-dialog"
      title={
        <span className="tv-vms-dialog-title">
          <span className="tv-muted">Scanned Number</span>
          <span className="tv-vms-awb">
            <span>{title}</span>
            <button type="button" className="icon-button compact-button" aria-label="Copy scanned number" onClick={() => void copyAwb()}>
              <Icon name="copy" />
            </button>
          </span>
          {orderType ? <span className={`c-status ${isReturn ? "red" : "green"} tv-vms-chip`}>{orderType}</span> : null}
        </span>
      }
    >
      <div className="tv-stack">
        {video.loading ? (
          <LoadingState label="Loading video…" />
        ) : video.error ? (
          <ErrorState title="Error fetching video" message={video.error} onRetry={video.reload} />
        ) : (
          <VideoPlayer src={video.data?.url} title={`Video ${title}`} autoPlay />
        )}
        {downloadError ? (
          <p className="tv-field-error" role="alert">
            {downloadError}
          </p>
        ) : null}

        <div className="tv-vms-video-footer">
          <ul className="tv-vms-meta">
            <li>
              <Icon name="video-camera" /> {feedName || "-"}
            </li>
            <li>
              <Icon name="calendar" /> {safeFormat(createdAt, "dd/MM/yyyy", "-")}
            </li>
            <li>
              <Icon name="clock" /> {safeFormat(createdAt, "hh:mm:ss a", "-")}
            </li>
            <li>
              <Icon name="database" /> {videoSize}
            </li>
          </ul>
          <div className="tv-row">
            <div className="tv-vms-segment" role="radiogroup" aria-label="Link type">
              {(["s3", "drive"] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={linkType === t} onClick={() => setLinkType(t)}>
                  {t === "s3" ? "S3" : "Drive"}
                </button>
              ))}
            </div>
            <button type="button" className="secondary-button compact-button" disabled={video.loading || copyingLink || !fileKey} onClick={() => void handleCopyLink()}>
              {copyingLink ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="link" />}
              {copyingLink && linkType === "drive" ? "Preparing…" : "Copy Link"}
            </button>
            <button type="button" className="primary-button compact-button" disabled={video.loading || downloading || !video.data} onClick={() => void handleDownload()}>
              {downloading ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="download" />}
              {downloading ? "Downloading…" : "Download"}
            </button>
          </div>
        </div>
      </div>
    </AppDialog>
  );
}
