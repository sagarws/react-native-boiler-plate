import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  Button as ButtonElement,
} from "@mui/material";
import {
  Close,
  FiberManualRecord,
  Pause,
  PlayArrow,
  Replay,
  Stop,
} from "../icons";
import { useEffect, useRef, useState } from "react";
import Webcam, { type WebcamHandle } from "./Webcam";
import { storeCmsVideo } from "../api";
import { largeVideoNotice } from "./largeVideo";
import { useToast } from "@renderer/hooks/useToast";

interface Props {
  open: boolean;
  onClose: () => void;
  onCapture: (videoId: string, file: File) => void;
  feedId: string;
  title?: string;
}

type RecorderState = "idle" | "recording" | "paused" | "stopped" | "uploading";

const formatDuration = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

/**
 * Video recorder modal. Uses react-webcam for live preview and the standard
 * MediaRecorder API for recording. Supports Start / Pause / Resume / Stop /
 * Retry / Cancel; after Stop, the recording is played back for review before
 * being uploaded to /cms/storeVideo on Save.
 */
const VideoRecorder = ({ open, onClose, onCapture, feedId, title = "Record Video" }: Props) => {
  const webcamRef = useRef<WebcamHandle | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationTimerRef = useRef<number | null>(null);

  const [recState, setRecState] = useState<RecorderState>("idle");
  const [durationMs, setDurationMs] = useState<number>(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string>("");
  const toast = useToast();

  /**
   * Declared before the effect that calls it, not after.
   *
   * A closure read before its declaration cannot be updated when what it
   * closes over changes, so the lint rule refuses it — and here the effect
   * genuinely needs the current one: it is what stops the interval when the
   * recorder closes mid-recording.
   */
  const stopTimer = () => {
    if (durationTimerRef.current !== null) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      // Full reset when the modal closes.
      stopTimer();
      chunksRef.current = [];
      mediaRecorderRef.current = null;
      setRecState("idle");
      setDurationMs(0);
      setPreviewUrl((url) => {
        if (url) URL.revokeObjectURL(url);
        return null;
      });
      setMediaError("");
    }
     
  }, [open]);

  /**
   * On unmount: stop the timer and tear down the recorder.
   *
   * Covers the parent yanking the modal while a recording is in flight,
   * without going through Cancel — the handlers are cleared first so a `stop()`
   * that fires afterwards cannot write into an unmounted component.
   *
   * THE CAMERA ITSELF IS NOT STOPPED HERE any more: `Webcam` owns its stream
   * and stops every track when it unmounts, which is both earlier and more
   * reliable than reaching through a ref that may already be null.
   */
  useEffect(() => {
    const recorder = mediaRecorderRef;

    return () => {
      stopTimer();

      const active = recorder.current;

      if (!active) return;

      active.onstop = null;
      active.ondataavailable = null;

      if (active.state !== "inactive") {
        try {
          active.stop();
        } catch {
          // Already stopped, or the stream went away first. Nothing to undo.
        }
      }
    };
     
  }, []);

  const startTimer = () => {
    stopTimer();
    const startedAt = performance.now() - durationMs;
    durationTimerRef.current = window.setInterval(() => {
      setDurationMs(performance.now() - startedAt);
    }, 250);
  };

  const handleStart = () => {
    const stream = webcamRef.current?.stream;
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
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setRecState("stopped");
        stopTimer();
      };
      recorder.start(500);
      mediaRecorderRef.current = recorder;
      setRecState("recording");
      setDurationMs(0);
      startTimer();
    } catch (e: any) {
      setMediaError(e?.message || "Failed to start recording");
    }
  };

  const handlePause = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      stopTimer();
      setRecState("paused");
    }
  };

  const handleResume = () => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      startTimer();
      setRecState("recording");
    }
  };

  const handleStop = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      // onstop handler flips state to "stopped"
    }
  };

  const handleRetry = () => {
    // Discard current recording and start fresh.
    stopTimer();
    chunksRef.current = [];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setDurationMs(0);
    setRecState("idle");
  };

  const handleSave = async () => {
    if (chunksRef.current.length === 0) return;
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" });
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const file = new File([blob], `recorded-${Date.now()}.${ext}`, { type: blob.type });

    setRecState("uploading");
    const notice = largeVideoNotice(file);
    if (notice) toast.info(notice);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("feedId", feedId || "");
      const response = await storeCmsVideo(formData);
      if (response.status === 200) {
        onCapture(response.data.data._id, file);
        onClose();
      } else {
        setMediaError("Upload failed");
        setRecState("stopped");
      }
    } catch (e: any) {
      setMediaError(typeof e === "string" ? e : e?.message || "Upload failed");
      setRecState("stopped");
    }
  };

  // Release the underlying getUserMedia tracks. `react-webcam` normally does
  // this on unmount, but during a cancel we need it to happen synchronously —
  // otherwise the camera indicator can stay on for a beat after the modal
  // closes, and the audio track keeps the mic reserved.
  const stopMediaTracks = () => {
    try {
      const stream = webcamRef.current?.stream;
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      // no-op: stream may already be released
    }
  };

  const handleCancel = () => {
    if (mediaRecorderRef.current) {
      // Null the onstop handler BEFORE stopping. Otherwise the async onstop
      // fires after the modal has closed, builds a Blob, and calls
      // setPreviewUrl/setRecState on an unmounted component (React warns and
      // the Blob is retained until the useEffect cleanup runs).
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.ondataavailable = null;
      if (mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // no-op: recorder may already be inactive
        }
      }
    }
    stopMediaTracks();
    onClose();
  };

  const isLive = recState === "recording" || recState === "paused" || recState === "idle";

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h6" fontWeight={700}>
          {title}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          {recState === "recording" && (
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <FiberManualRecord sx={{ color: "error.main", fontSize: 14 }} />
              <Typography variant="body2" fontWeight={600} color="error.main">
                REC
              </Typography>
            </Stack>
          )}
          {recState === "paused" && (
            <Typography variant="body2" fontWeight={600} color="warning.main">
              PAUSED
            </Typography>
          )}
          <Typography variant="body2" fontFamily="monospace">
            {formatDuration(durationMs)}
          </Typography>
          <Tooltip title="Close">
            <IconButton onClick={handleCancel} size="small">
              <Close />
            </IconButton>
          </Tooltip>
        </Stack>
      </DialogTitle>

      <DialogContent>
        {mediaError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setMediaError("")}>
            {mediaError}
          </Alert>
        )}

        <Box
          sx={{
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: 2,
            overflow: "hidden",
            bgcolor: "black",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isLive ? (
            <Webcam
              ref={webcamRef}
              audio
              videoConstraints={{ facingMode: "environment" }}
              muted
              onUserMediaError={(e: any) => {
                setMediaError(
                  typeof e === "string" ? e : e?.message || "Unable to access webcam",
                );
              }}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : previewUrl ? (
            <video
              src={previewUrl}
              controls
              autoPlay={false}
              style={{ width: "100%", height: "100%", objectFit: "contain", background: "black" }}
            />
          ) : (
            <CircularProgress color="inherit" />
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: "wrap" }}>
        {recState === "idle" && (
          <>
            <ButtonElement type="button" variant="tonal"
                color="secondary" onClick={handleCancel} sx={{ fontSize: 13 }}>
              Cancel
            </ButtonElement>
            <ButtonElement
              type="button"
              variant="contained"
              startIcon={<FiberManualRecord sx={{ color: "common.white" }} />}
              sx={{ fontSize: 13, color: "white", bgcolor: "error.main", "&:hover": { bgcolor: "error.dark" } }}
              onClick={handleStart}
            >
              Start Recording
            </ButtonElement>
          </>
        )}

        {recState === "recording" && (
          <>
            <ButtonElement type="button" variant="tonal"
                color="secondary" onClick={handleCancel} sx={{ fontSize: 13 }}>
              Cancel
            </ButtonElement>
            <ButtonElement
              type="button"
              variant="tonal"
                color="secondary"
              startIcon={<Pause />}
              sx={{ fontSize: 13 }}
              onClick={handlePause}
            >
              Pause
            </ButtonElement>
            <ButtonElement
              type="button"
              variant="contained"
              startIcon={<Stop />}
              sx={{ fontSize: 13, color: "white" }}
              onClick={handleStop}
            >
              Stop
            </ButtonElement>
          </>
        )}

        {recState === "paused" && (
          <>
            <ButtonElement type="button" variant="tonal"
                color="secondary" onClick={handleCancel} sx={{ fontSize: 13 }}>
              Cancel
            </ButtonElement>
            <ButtonElement
              type="button"
              variant="tonal"
                color="secondary"
              startIcon={<PlayArrow />}
              sx={{ fontSize: 13 }}
              onClick={handleResume}
            >
              Resume
            </ButtonElement>
            <ButtonElement
              type="button"
              variant="contained"
              startIcon={<Stop />}
              sx={{ fontSize: 13, color: "white" }}
              onClick={handleStop}
            >
              Stop
            </ButtonElement>
          </>
        )}

        {recState === "stopped" && (
          <>
            <ButtonElement type="button" variant="tonal"
                color="secondary" onClick={handleCancel} sx={{ fontSize: 13 }}>
              Cancel
            </ButtonElement>
            <ButtonElement
              type="button"
              variant="tonal"
                color="secondary"
              startIcon={<Replay />}
              sx={{ fontSize: 13 }}
              onClick={handleRetry}
            >
              Retry
            </ButtonElement>
            <ButtonElement
              type="button"
              variant="contained"
              sx={{ fontSize: 13, color: "white" }}
              onClick={() => void handleSave()}
            >
              Save Video
            </ButtonElement>
          </>
        )}

        {recState === "uploading" && (
          <Stack direction="row" alignItems="center" spacing={1}>
            <CircularProgress size={18} />
            <Typography variant="body2">Uploading…</Typography>
          </Stack>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default VideoRecorder;
