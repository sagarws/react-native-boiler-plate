import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import CameraPermissionModal from "./CameraPermissionModal";
import VideoRecorder from "./VideoRecorder";
import CaptureImages from "./CaptureImages";
import { useCameraPermission } from "./useCameraPermission";

interface OpenImageOptions {
  name: string;
  onCapture: (s3Key: string, file: File) => void;
}
interface OpenVideoOptions {
  name: string;
  onCapture: (videoId: string, file: File) => void;
}

interface MediaCaptureContextValue {
  isReady: boolean; // camera permission granted + device present
  openImageCapture: (opts: OpenImageOptions) => void;
  openVideoRecord: (opts: OpenVideoOptions) => void;
  reopenPermissionModal: () => void;
}

const MediaCaptureContext = createContext<MediaCaptureContextValue | null>(null);

export const useMediaCapture = (): MediaCaptureContextValue | null =>
  useContext(MediaCaptureContext);

interface ProviderProps {
  feedId: string;
  children: ReactNode;
}

/**
 * Page-level media capture provider. Renders three modals:
 *  1. CameraPermissionModal — shown on mount when permission is not granted
 *  2. CaptureImages — single-shot image capture (any FileInput image field)
 *  3. VideoRecorder — start/pause/stop/retry video recording
 *
 * FileInputs can call useMediaCapture()?.openImageCapture / openVideoRecord
 * to trigger the appropriate modal, passing a per-slot callback.
 */
const MediaCaptureProvider = ({ feedId, children }: ProviderProps) => {
  const permission = useCameraPermission();
  const [permissionOpen, setPermissionOpen] = useState<boolean>(false);
  const [permissionAsked, setPermissionAsked] = useState<boolean>(false);

  // Show permission modal once the initial status resolves (and not already granted).
  useEffect(() => {
    if (permissionAsked) return;
    if (permission.status === "unknown") return;
    if (permission.status !== "granted") {
      setPermissionOpen(true);
      setPermissionAsked(true);
    }
  }, [permission.status, permissionAsked]);

  const handleRequest = async () => {
    const ok = await permission.requestPermission();
    if (ok) setPermissionOpen(false);
  };

  // --- Image capture modal state ---
  const [imgOpen, setImgOpen] = useState<{ open: boolean; index: number | null }>({
    open: false,
    index: null,
  });
  const currType = useRef<string>("");
  const imgCallbackRef = useRef<((s3Key: string, file: File) => void) | null>(null);

  const openImageCapture = ({ name, onCapture }: OpenImageOptions) => {
    if (!permission.isReady) {
      setPermissionOpen(true);
      return;
    }
    currType.current = name;
    imgCallbackRef.current = onCapture;
    setImgOpen({ open: true, index: null });
  };

  // Escape hatch fed into CaptureImages: it uploads to /uploadImage and passes
  // back the S3 key here so we can route to the slot's callback.
  const onCustomCaptureSuccess = (_type: string, s3Key: string, file: File) => {
    if (imgCallbackRef.current) {
      imgCallbackRef.current(s3Key, file);
      imgCallbackRef.current = null;
      return true;
    }
    return false;
  };

  // --- Video record modal state ---
  const [videoOpen, setVideoOpen] = useState<boolean>(false);
  const videoCallbackRef = useRef<((videoId: string, file: File) => void) | null>(null);

  const openVideoRecord = ({ name, onCapture }: OpenVideoOptions) => {
    if (!permission.isReady) {
      setPermissionOpen(true);
      return;
    }
    currType.current = name;
    videoCallbackRef.current = onCapture;
    setVideoOpen(true);
  };

  const contextValue: MediaCaptureContextValue = {
    isReady: permission.isReady,
    openImageCapture,
    openVideoRecord,
    reopenPermissionModal: () => setPermissionOpen(true),
  };

  return (
    <MediaCaptureContext.Provider value={contextValue}>
      {children}

      <CameraPermissionModal
        open={permissionOpen}
        status={permission.status}
        hasDevice={permission.hasDevice}
        onRequest={() => void handleRequest()}
        onSkip={() => setPermissionOpen(false)}
      />

      <CaptureImages
        open={imgOpen}
        handleClose={() => {
          setImgOpen({ open: false, index: null });
          imgCallbackRef.current = null;
        }}
        handleFilePreviewChange={() => {}}
        setFieldValue={() => {}}
        setFieldTouched={() => {}}
        currType={currType}
        feedId={feedId}
        onCustomCaptureSuccess={onCustomCaptureSuccess}
      />

      <VideoRecorder
        open={videoOpen}
        onClose={() => {
          setVideoOpen(false);
          videoCallbackRef.current = null;
        }}
        onCapture={(videoId, file) => {
          if (videoCallbackRef.current) {
            videoCallbackRef.current(videoId, file);
            videoCallbackRef.current = null;
          }
        }}
        feedId={feedId}
      />
    </MediaCaptureContext.Provider>
  );
};

export default MediaCaptureProvider;
