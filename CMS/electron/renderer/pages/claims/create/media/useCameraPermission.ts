import { useCallback, useEffect, useState } from "react";

export type CameraPermissionStatus =
  | "unknown"
  | "prompt"
  | "granted"
  | "denied"
  | "unavailable";

/**
 * Wraps navigator.permissions + getUserMedia to expose a stable
 * camera-permission status. Also detects when no camera device exists so
 * callers can suppress the capture UI in that case.
 */
export const useCameraPermission = () => {
  const [status, setStatus] = useState<CameraPermissionStatus>("unknown");
  const [hasDevice, setHasDevice] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Enumerate devices — if there is no videoinput at all, capture is
    // impossible regardless of permission state.
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (cancelled) return;
          setHasDevice(devices.some((d) => d.kind === "videoinput"));
        })
        .catch(() => !cancelled && setHasDevice(false));
    } else {
      setHasDevice(false);
    }

    // Best-effort: use navigator.permissions if available (Chromium browsers).
    // Firefox/Safari will fall back to the "prompt" default.
    const permApi = (navigator as any).permissions;
    if (permApi?.query) {
      permApi
        .query({ name: "camera" as PermissionName })
        .then((result: PermissionStatus) => {
          if (cancelled) return;
          setStatus(result.state as CameraPermissionStatus);
          result.onchange = () => {
            if (!cancelled) setStatus(result.state as CameraPermissionStatus);
          };
        })
        .catch(() => !cancelled && setStatus("prompt"));
    } else {
      setStatus("prompt");
    }

    return () => {
      cancelled = true;
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
      return true;
    } catch (e: any) {
      const name = e?.name || "";
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        setHasDevice(false);
        setStatus("unavailable");
      } else if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
      } else {
        setStatus("denied");
      }
      return false;
    }
  }, []);

  const isReady = status === "granted" && hasDevice !== false;

  return { status, hasDevice, isReady, requestPermission };
};
