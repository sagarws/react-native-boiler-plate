"use client";

import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Spinner } from "@/components/ui/states";
import { errorMessage, toast } from "@/lib/events";
import { deleteCmsFile, storeCmsVideo, uploadCmsImage } from "@/services/cms-create-service";
import { useMediaCapture } from "@/features/cms-create/media/media-capture-provider";
import { isPdfSrc, MediaImage, MediaVideo, srcLabel, type MediaSrc } from "@/features/cms-create/media/media-thumb";

const ACCEPT_IMAGE = "image/jpg,image/png,image/jpeg";
const ACCEPT_DOC = ".pdf,image/jpg,image/png,image/jpeg";

function acceptFor(name: string, isVideo: boolean): string {
  if (isVideo) return "video/*";
  if (name === "podProof" || name === "additionalFieldValue") return ACCEPT_DOC;
  return ACCEPT_IMAGE;
}

export interface FileInputProps {
  name: string;
  feedId: string;
  preview: MediaSrc | null | undefined;
  /** Called with the picked / captured file (null when cleared). */
  onFileChange: (name: string, file: File | null) => void;
  setFieldValue: (field: string, value: string) => void;
  setFieldTouched: (field: string) => void;
  error?: boolean;
  isVideo?: boolean;
  /** No live capture for this slot (PDF slots). */
  disableCapture?: boolean;
  /** Tile height: sm 56px, md 110px, lg 150px. */
  size?: "sm" | "md" | "lg";
  accept?: string;
  /** Max size in MB; larger files are refused with a toast (Myntra / Flipkart limits). */
  maxMb?: number;
  children?: ReactNode;
  label?: string;
}

/**
 * TrackVid `media/FileInput`: one upload slot. Empty → click to browse, or an Upload | Capture (Record for video)
 * split when the camera is ready. A picked file is uploaded at once (/cms/uploadImage or /cms/storeVideo) and the
 * returned key / video id lands in the form. Filled → image / video / PDF preview, an eye button for a larger view
 * and a delete button (DELETE /files/:key).
 */
export function FileInput({ name, feedId, preview, onFileChange, setFieldValue, setFieldTouched, error, isVideo = false, disableCapture, size = "md", accept, maxMb, children, label }: FileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [fileKey, setFileKey] = useState("");
  const [viewOpen, setViewOpen] = useState(false);
  const media = useMediaCapture();
  const captureEnabled = !disableCapture && Boolean(media?.isReady);
  const showSplit = !preview && !loading && captureEnabled;
  const pdf = isPdfSrc(preview ?? null) || fileKey.toLowerCase().endsWith(".pdf");

  const browse = () => inputRef.current?.click();

  const store = async (file: File) => {
    setLoading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("feedId", feedId || "");
    try {
      if (file.type.startsWith("video/")) {
        const res = await storeCmsVideo(fd);
        setFieldValue(name, res.data._id);
        setFileKey(res.data.key);
      } else {
        const res = await uploadCmsImage(fd);
        setFieldValue(name, res.data.key);
        setFileKey(res.data.key);
      }
      onFileChange(name, file);
    } catch (e) {
      toast.error(errorMessage(e, "Upload failed"));
    } finally {
      setLoading(false);
      setFieldTouched(name);
    }
  };

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (maxMb && file.size > maxMb * 1024 * 1024) {
      toast.error(`File must be less than ${maxMb}MB`);
      return;
    }
    if (file.type.startsWith("video/") || file.type.startsWith("image/") || file.type === "application/pdf") void store(file);
    else {
      setFieldTouched(name);
      setFieldValue(name, "");
      toast.error("*Unsupported File Format");
    }
  };

  const capture = () => {
    if (!media) return;
    if (isVideo) {
      media.openVideoRecord({
        name,
        onCapture: (videoId, file) => {
          setFieldValue(name, videoId);
          onFileChange(name, file);
        },
      });
    } else {
      media.openImageCapture({
        name,
        onCapture: (key, file) => {
          setFieldValue(name, key);
          setFileKey(key);
          setFieldTouched(name);
          onFileChange(name, file);
        },
      });
    }
  };

  const clear = () => {
    if (fileKey) {
      void deleteCmsFile(fileKey).catch(() => {
        // The slot is cleared either way; an orphaned upload is swept by the BE.
      });
    }
    setFileKey("");
    setFieldValue(name, "");
    onFileChange(name, null);
  };

  return (
    <>
      <div className={`tv-cmsc-slot size-${size} ${error ? "has-error" : ""} ${preview ? "is-filled" : ""}`}>
        <input ref={inputRef} type="file" accept={accept ?? acceptFor(name, isVideo)} hidden onChange={onPick} aria-label={label ? `Upload ${label}` : `Upload ${name}`} />
        {loading ? (
          <Spinner label="Uploading" />
        ) : preview ? (
          <>
            {pdf ? (
              <span className="tv-cmsc-pdf-chip">
                <Icon name="file-text" /> {srcLabel(preview).slice(0, 18)}
                {srcLabel(preview).length > 18 ? "…" : ""}
              </span>
            ) : isVideo ? (
              <MediaVideo src={preview} className="tv-cmsc-slot-media" />
            ) : (
              <MediaImage src={preview} alt={label ?? "Preview"} className="tv-cmsc-slot-media" />
            )}
            {!pdf ? (
              <button type="button" className="tv-cmsc-view" onClick={() => setViewOpen(true)} aria-label="View larger">
                <Icon name="eye" />
              </button>
            ) : null}
            <button type="button" className="tv-cmsc-remove" onClick={clear} aria-label={label ? `Remove ${label}` : "Remove file"}>
              <Icon name="trash" />
            </button>
          </>
        ) : showSplit ? (
          <div className="tv-cmsc-split">
            <button type="button" onClick={browse}>
              <Icon name={isVideo ? "video-camera" : "image"} />
              <span>Upload</span>
            </button>
            <button type="button" onClick={capture}>
              <Icon name={isVideo ? "record" : "camera"} className={isVideo ? "tv-cmsc-rec-icon" : undefined} />
              <span>{isVideo ? "Record" : "Capture"}</span>
            </button>
          </div>
        ) : (
          <button type="button" className="tv-cmsc-slot-empty" onClick={browse}>
            {children ?? (
              <>
                <Icon name={isVideo ? "video-camera" : "image"} />
                <span>Upload</span>
              </>
            )}
          </button>
        )}
      </div>
      {viewOpen && preview && !pdf ? (
        <AppDialog title={label ?? "Preview"} onClose={() => setViewOpen(false)} size="wide">
          <div className="tv-cmsc-viewer">{isVideo ? <MediaVideo src={preview} autoPlay /> : <MediaImage src={preview} alt={label ?? "Preview"} />}</div>
        </AppDialog>
      ) : null}
    </>
  );
}
