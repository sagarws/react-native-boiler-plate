"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { Spinner } from "@/components/ui/states";
import { errorMessage, toast } from "@/lib/events";
import { uploadCmsImage } from "@/services/cms-create-service";
import { MediaImage } from "@/features/cms-create/media/media-thumb";
import { useCameraStream } from "@/features/cms-create/media/use-camera";

const MAX_SHOTS = 9;

const TITLES: Record<string, string> = {
  returnProductImage: "Return Product Image",
  forwardSentProductImage: "Forward Sent Product Image",
  sideImages: "Side Images",
};

export type CaptureMode =
  | { kind: "single"; name: string; onCapture: (key: string, file: File) => void }
  | { kind: "multi"; files: File[]; onSave: (files: File[]) => void };

/** Grabs the current video frame through a canvas as a PNG file. */
function grabFrame(video: HTMLVideoElement, name: string): Promise<File | null> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ? new File([blob], `${name || "capture"}-${Date.now()}.png`, { type: "image/png" }) : null), "image/png"));
}

/**
 * TrackVid `CaptureImages`: webcam frame capture. Single mode uploads one shot into one slot and closes; multi mode
 * (six-side grid) collects up to nine shots with a thumbnail rail, preview, remove, Clear and Save. SPACE captures.
 */
export function CaptureImagesDialog({ mode, feedId, onClose }: { mode: CaptureMode; feedId: string; onClose: () => void }) {
  const { attach: attachCamera, getVideo, error: cameraError, ready: cameraReady } = useCameraStream(false);
  const [images, setImages] = useState<File[]>(mode.kind === "multi" ? mode.files : []);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const multi = mode.kind === "multi";
  const name = mode.kind === "single" ? mode.name : "sideImages";
  const full = multi && images.length >= MAX_SHOTS;

  const capture = async () => {
    const video = getVideo();
    if (!video || busyRef.current || full) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const file = await grabFrame(video, name);
      if (!file) throw new Error("Could not read a frame from the camera");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("feedId", feedId || "");
      const res = await uploadCmsImage(fd);
      if (mode.kind === "single") {
        mode.onCapture(res.data.key, file);
        onClose();
        return;
      }
      setImages((prev) => (prev.length >= MAX_SHOTS ? prev : [...prev, file]));
    } catch (e) {
      toast.error(errorMessage(e, "Error uploading image"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const captureRef = useRef(capture);
  useEffect(() => {
    captureRef.current = capture;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      void captureRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const remove = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setPreviewIndex(null);
  };

  const previewing = previewIndex !== null && images[previewIndex] ? images[previewIndex] : null;

  const footer = (
    <>
      <span className="tv-cmsc-hint">
        Press <kbd>SPACE</kbd> to capture the screenshot
      </span>
      <button type="button" className="primary-button" onClick={() => void capture()} disabled={Boolean(cameraError) || !cameraReady || busy || (multi && (full || previewing !== null))}>
        {busy ? <Spinner /> : <Icon name="camera" />} Capture Screenshot
      </button>
      {multi ? (
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            if (mode.kind === "multi" && images.length > 0) mode.onSave(images);
            onClose();
          }}
        >
          Save
        </button>
      ) : null}
    </>
  );

  return (
    <AppDialog title={TITLES[name] ?? "Capture Image"} onClose={onClose} size="xl" footer={footer} locked={busy}>
      {cameraError ? (
        <Banner tone="error" title="Camera unavailable">
          {cameraError} You can still upload images from your computer.
        </Banner>
      ) : null}
      <div className={`tv-cmsc-capture ${multi ? "is-multi" : ""}`}>
        <div className="tv-cmsc-stage">
          {previewing ? (
            <MediaImage src={previewing} alt="Captured preview" />
          ) : cameraError ? (
            <div className="tv-cmsc-stage-empty">
              <Icon name="camera" />
              <span>No camera stream</span>
            </div>
          ) : (
            <>
              <video ref={attachCamera} autoPlay muted playsInline />
              {!cameraReady ? (
                <div className="tv-cmsc-stage-overlay">
                  <Spinner label="Starting camera" />
                </div>
              ) : null}
            </>
          )}
        </div>
        {multi && !cameraError ? (
          <aside className="tv-cmsc-rail" aria-label="Captured images">
            <div className="tv-cmsc-rail-list">
              {images.map((file, index) => (
                <div key={`${file.name}-${file.lastModified}-${index}`} className={`tv-cmsc-rail-item ${previewIndex === index ? "is-active" : ""}`}>
                  <button type="button" className="tv-cmsc-rail-thumb" onClick={() => setPreviewIndex(index)} aria-label={`Preview capture ${index + 1}`}>
                    <MediaImage src={file} alt={`Capture ${index + 1}`} />
                  </button>
                  <button type="button" className="tv-cmsc-remove" onClick={() => remove(index)} aria-label={`Remove capture ${index + 1}`}>
                    <Icon name="x" />
                  </button>
                </div>
              ))}
              {Array.from({ length: Math.max(0, MAX_SHOTS - images.length) }, (_, i) => (
                <button key={`empty-${i}`} type="button" className="tv-cmsc-rail-empty" onClick={() => setPreviewIndex(null)} aria-label="Back to live camera" />
              ))}
            </div>
            <div className="tv-row-between">
              <strong>
                {images.length}/{MAX_SHOTS}
              </strong>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => {
                  setImages([]);
                  setPreviewIndex(null);
                }}
              >
                Clear
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </AppDialog>
  );
}
