"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraPermissionStatus = "unknown" | "prompt" | "granted" | "denied" | "unavailable";

/**
 * TrackVid `useCameraPermission`: navigator.permissions + enumerateDevices. `isReady` = permission granted and a
 * camera exists. The permission-change listener is removed on unmount.
 */
export function useCameraPermission() {
  const [status, setStatus] = useState<CameraPermissionStatus>("unknown");
  const [hasDevice, setHasDevice] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let permission: PermissionStatus | null = null;
    const onChange = () => {
      if (!cancelled && permission) setStatus(permission.state as CameraPermissionStatus);
    };
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (media?.enumerateDevices) {
      media
        .enumerateDevices()
        .then((devices) => {
          if (!cancelled) setHasDevice(devices.some((d) => d.kind === "videoinput"));
        })
        .catch(() => {
          if (!cancelled) setHasDevice(false);
        });
    } else {
      void Promise.resolve().then(() => {
        if (!cancelled) setHasDevice(false);
      });
    }
    const permApi = typeof navigator !== "undefined" ? navigator.permissions : undefined;
    if (permApi?.query) {
      permApi
        .query({ name: "camera" as PermissionName })
        .then((result) => {
          if (cancelled) return;
          permission = result;
          setStatus(result.state as CameraPermissionStatus);
          result.addEventListener("change", onChange);
        })
        .catch(() => {
          // Firefox / Safari do not know the "camera" permission name: treat it as "ask".
          if (!cancelled) setStatus("prompt");
        });
    } else {
      void Promise.resolve().then(() => {
        if (!cancelled) setStatus("prompt");
      });
    }
    return () => {
      cancelled = true;
      permission?.removeEventListener("change", onChange);
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      setStatus("granted");
      setHasDevice(true);
      return true;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        setHasDevice(false);
        setStatus("unavailable");
      } else setStatus("denied");
      return false;
    }
  }, []);

  return { status, hasDevice, isReady: status === "granted" && hasDevice !== false, requestPermission };
}

function cameraError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError" || e.name === "SecurityError") return "Camera access is blocked. Allow the camera in your browser's site settings.";
    if (e.name === "NotFoundError" || e.name === "OverconstrainedError") return "No camera was found on this device.";
    if (e.name === "NotReadableError") return "The camera is in use by another application.";
    return e.message || "Unable to access webcam";
  }
  return e instanceof Error ? e.message : "Unable to access webcam";
}

/**
 * Live camera stream for a dialog: opened on mount (`getUserMedia`), every track stopped on unmount. `attach` is a
 * callback ref for the preview <video>; it re-attaches when the element remounts (Retry after a recording).
 */
export function useCameraStream(withAudio: boolean) {
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      void Promise.resolve().then(() => {
        if (!cancelled) setError("Camera unavailable: this browser cannot open the webcam (a secure https page is required).");
      });
      return () => {
        cancelled = true;
      };
    }
    const video: MediaTrackConstraints = { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } };
    const open = withAudio ? media.getUserMedia({ video, audio: true }).catch(() => media.getUserMedia({ video })) : media.getUserMedia({ video });
    open
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(cameraError(e));
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [withAudio]);

  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) el.srcObject = streamRef.current;
  }, []);

  const getStream = useCallback(() => streamRef.current, []);
  const getVideo = useCallback(() => videoRef.current, []);
  return { attach, getStream, getVideo, error, ready };
}
