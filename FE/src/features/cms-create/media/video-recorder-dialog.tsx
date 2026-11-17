"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { Spinner } from "@/components/ui/states";
import { errorMessage } from "@/lib/events";
import { storeCmsVideo } from "@/services/cms-create-service";
import { MediaVideo } from "@/features/cms-create/media/media-thumb";
import { useCameraStream } from "@/features/cms-create/media/use-camera";

type RecorderState = "idle" | "recording" | "paused" | "stopped" | "uploading";

const formatDuration = (ms: number) => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * TrackVid `VideoRecorder`: live webcam preview + MediaRecorder with Start / Pause / Resume / Stop / Retry / Cancel.
 * After Stop the take plays back for review; Save Video stores it (/cms/storeVideo) and hands back the video id.
 * Mounted only while open: unmount stops the recorder, every camera track and the duration timer.
 */
export function VideoRecorderDialog({ onClose, onCapture, feedId, title = "Record Video" }: { onClose: () => void; onCapture: (videoId: string, file: File) => void; feedId: string; title?: string }) {
  const camera = useCameraStream(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const [state, setState] = useState<RecorderState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [recorded, setRecorded] = useState<File | null>(null);
  const [mediaError, setMediaError] = useState("");

  const stopTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const startTimer = (fromMs: number) => {
    stopTimer();
    startedAtRef.current = performance.now() - fromMs;
    timerRef.current = window.setInterval(() => setDurationMs(performance.now() - startedAtRef.current), 250);
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
      const rec = recorderRef.current;
      if (rec) {
        rec.ondataavailable = null;
        rec.onstop = null;
        if (rec.state !== "inactive") {
          try {
            rec.stop();
          } catch {
            // Already stopping because the stream's tracks ended — nothing left to release.
          }
        }
      }
    },
    [],
  );

  const handleStart = () => {
    const stream = camera.streamRef.current;
    if (!stream) {
      setMediaError("Camera stream not available");
      return;
    }
    try {
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = chunksRef.current[0]?.type || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "mp4" : "webm";
        setRecorded(new File([blob], `recorded-${Date.now()}.${ext}`, { type }));
        setState("stopped");
        stopTimer();
      };
      recorder.start(500);
      recorderRef.current = recorder;
      setDurationMs(0);
      setState("recording");
      startTimer(0);
    } catch (e) {
      setMediaError(errorMessage(e, "Failed to start recording"));
    }
  };

  const handlePause = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      stopTimer();
      setState("paused");
    }
  };

  const handleResume = () => {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      startTimer(durationMs);
      setState("recording");
    }
  };

  const handleStop = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  };

  const handleRetry = () => {
    stopTimer();
    chunksRef.current = [];
    recorderRef.current = null;
    setRecorded(null);
    setDurationMs(0);
    setState("idle");
  };

  const handleSave = async () => {
    if (!recorded) return;
    setState("uploading");
    try {
      const fd = new FormData();
      fd.append("file", recorded);
      fd.append("feedId", feedId || "");
      const res = await storeCmsVideo(fd);
      onCapture(res.data._id, recorded);
      onClose();
    } catch (e) {
      setMediaError(errorMessage(e, "Upload failed"));
      setState("stopped");
    }
  };

  const isLive = state === "idle" || state === "recording" || state === "paused";
  const error = mediaError || camera.error;
  const canRecord = camera.ready && !camera.error;

  const footer = (
    <>
      {state === "uploading" ? (
        <span className="tv-row">
          <Spinner /> Uploading…
        </span>
      ) : (
        <button type="button" className="secondary-button" onClick={onClose}>
          Cancel
        </button>
      )}
      {state === "idle" ? (
        <button type="button" className="danger-button" onClick={handleStart} disabled={!canRecord}>
          <Icon name="record" /> Start Recording
        </button>
      ) : null}
      {state === "recording" ? (
        <>
          <button type="button" className="secondary-button" onClick={handlePause}>
            <Icon name="pause" /> Pause
          </button>
          <button type="button" className="primary-button" onClick={handleStop}>
            <Icon name="stop" /> Stop
          </button>
        </>
      ) : null}
      {state === "paused" ? (
        <>
          <button type="button" className="secondary-button" onClick={handleResume}>
            <Icon name="play" /> Resume
          </button>
          <button type="button" className="primary-button" onClick={handleStop}>
            <Icon name="stop" /> Stop
          </button>
        </>
      ) : null}
      {state === "stopped" ? (
        <>
          <button type="button" className="secondary-button" onClick={handleRetry}>
            <Icon name="refresh" /> Retry
          </button>
          <button type="button" className="primary-button" onClick={() => void handleSave()} disabled={!recorded}>
            Save Video
          </button>
        </>
      ) : null}
    </>
  );

  return (
    <AppDialog
      title={
        <span className="tv-cmsc-rec-title">
          {title}
          {state === "recording" ? <span className="tv-cmsc-rec-badge">REC</span> : null}
          {state === "paused" ? <span className="tv-cmsc-rec-badge is-paused">PAUSED</span> : null}
          <span className="tv-cmsc-rec-time">{formatDuration(durationMs)}</span>
        </span>
      }
      onClose={onClose}
      size="wide"
      locked={state === "uploading"}
      footer={footer}
    >
      {error ? (
        <Banner tone="error" title={camera.error ? "Camera unavailable" : undefined} onDismiss={mediaError ? () => setMediaError("") : undefined}>
          {error}
        </Banner>
      ) : null}
      <div className="tv-cmsc-stage">
        {isLive ? (
          camera.error ? (
            <div className="tv-cmsc-stage-empty">
              <Icon name="video-camera" />
              <span>You can still upload a video file instead.</span>
            </div>
          ) : (
            <>
              <video ref={camera.attach} autoPlay muted playsInline />
              {!camera.ready ? (
                <div className="tv-cmsc-stage-overlay">
                  <Spinner label="Starting camera" />
                </div>
              ) : null}
            </>
          )
        ) : recorded ? (
          <MediaVideo src={recorded} />
        ) : (
          <div className="tv-cmsc-stage-overlay">
            <Spinner />
          </div>
        )}
      </div>
    </AppDialog>
  );
}
