"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { CaptureImagesDialog, type CaptureMode } from "@/features/cms-create/media/capture-images-dialog";
import { useCameraPermission, type CameraPermissionStatus } from "@/features/cms-create/media/use-camera";
import { VideoRecorderDialog } from "@/features/cms-create/media/video-recorder-dialog";

interface MediaCaptureContextValue {
  /** Camera permission granted and a device present. */
  isReady: boolean;
  openImageCapture: (opts: { name: string; onCapture: (key: string, file: File) => void }) => void;
  openVideoRecord: (opts: { name: string; onCapture: (videoId: string, file: File) => void }) => void;
  openSideCapture: (opts: { files: File[]; onSave: (files: File[]) => void }) => void;
  reopenPermissionModal: () => void;
}

const MediaCaptureContext = createContext<MediaCaptureContextValue | null>(null);

export const useMediaCapture = (): MediaCaptureContextValue | null => useContext(MediaCaptureContext);

function CameraPermissionDialog({ status, hasDevice, onRequest, onSkip }: { status: CameraPermissionStatus; hasDevice: boolean | null; onRequest: () => void; onSkip: () => void }) {
  const denied = status === "denied";
  const unavailable = status === "unavailable" || hasDevice === false;
  return (
    <AppDialog
      title={
        <span className="tv-row">
          <Icon name="video-camera" /> {unavailable ? "No Camera Detected" : "Enable Camera Access"}
        </span>
      }
      onClose={onSkip}
      size="sm"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onSkip}>
            Skip for now
          </button>
          {!unavailable && !denied ? (
            <button type="button" className="primary-button" onClick={onRequest}>
              Allow Camera
            </button>
          ) : null}
        </>
      }
    >
      {unavailable ? (
        <div className="tv-stack">
          <Banner tone="warning">We couldn&apos;t find a camera on this device.</Banner>
          <p className="tv-muted">You can still upload existing images and videos from your computer. Connect a camera and reload the page to enable live capture.</p>
        </div>
      ) : denied ? (
        <div className="tv-stack">
          <Banner tone="error">Camera access is currently blocked.</Banner>
          <p className="tv-muted">
            To enable capture, open your browser&apos;s site settings for this page and set <b>Camera</b> to <b>Allow</b>. Then reload the page.
          </p>
        </div>
      ) : (
        <div className="tv-stack">
          <p>Creating a CMS entry works best with camera access so you can:</p>
          <ul className="tv-cmsc-list">
            <li>Capture product/side images live</li>
            <li>Record return/forward/damaged videos</li>
          </ul>
          <p className="tv-muted">You can still upload files without granting access.</p>
        </div>
      )}
    </AppDialog>
  );
}

type Open =
  | { kind: "none" }
  | { kind: "image"; mode: CaptureMode }
  | { kind: "video"; onCapture: (videoId: string, file: File) => void };

/**
 * TrackVid `MediaCaptureProvider`: asks for camera permission once when the page opens (if not granted), and hosts
 * the single-shot capture, six-side capture and video recorder dialogs for every FileInput on the page.
 */
export function MediaCaptureProvider({ feedId, children }: { feedId: string; children: ReactNode }) {
  const permission = useCameraPermission();
  const [asked, setAsked] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [open, setOpen] = useState<Open>({ kind: "none" });

  // Same rule as TrackVid: once the status is known, prompt a single time if the camera is not granted.
  if (!asked && permission.status !== "unknown") {
    setAsked(true);
    if (permission.status !== "granted") setPermissionOpen(true);
  }

  const guard = (fn: () => void) => {
    if (!permission.isReady) {
      setPermissionOpen(true);
      return;
    }
    fn();
  };

  const value: MediaCaptureContextValue = {
    isReady: permission.isReady,
    openImageCapture: ({ name, onCapture }) => guard(() => setOpen({ kind: "image", mode: { kind: "single", name, onCapture } })),
    openVideoRecord: ({ onCapture }) => guard(() => setOpen({ kind: "video", onCapture })),
    openSideCapture: ({ files, onSave }) => guard(() => setOpen({ kind: "image", mode: { kind: "multi", files, onSave } })),
    reopenPermissionModal: () => setPermissionOpen(true),
  };

  const close = () => setOpen({ kind: "none" });

  return (
    <MediaCaptureContext.Provider value={value}>
      {children}
      {permissionOpen ? (
        <CameraPermissionDialog
          status={permission.status}
          hasDevice={permission.hasDevice}
          onSkip={() => setPermissionOpen(false)}
          onRequest={() => {
            void permission.requestPermission().then((okay) => {
              if (okay) setPermissionOpen(false);
            });
          }}
        />
      ) : null}
      {open.kind === "image" ? <CaptureImagesDialog mode={open.mode} feedId={feedId} onClose={close} /> : null}
      {open.kind === "video" ? <VideoRecorderDialog feedId={feedId} onClose={close} onCapture={open.onCapture} /> : null}
    </MediaCaptureContext.Provider>
  );
}
