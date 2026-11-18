import {
  Alert,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  Button as ButtonElement,
} from "@mui/material";
import { VideocamOutlined, VideocamOffOutlined } from "../icons";
import { type CameraPermissionStatus } from "./useCameraPermission";

interface Props {
  open: boolean;
  status: CameraPermissionStatus;
  hasDevice: boolean | null;
  onRequest: () => void;
  onSkip: () => void;
}

/**
 * Camera permission ask modal. Shown on CreateCms mount when permission is
 * "prompt", "denied", or "unknown". Users can either grant access or skip
 * (falling back to file-upload-only mode).
 */
const CameraPermissionModal = ({ open, status, hasDevice, onRequest, onSkip }: Props) => {
  const denied = status === "denied";
  const unavailable = status === "unavailable" || hasDevice === false;

  return (
    <Dialog open={open} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {unavailable ? (
          <VideocamOffOutlined color="error" />
        ) : (
          <VideocamOutlined color="primary" />
        )}
        <Typography component="span" variant="h6" fontWeight={700}>
          {unavailable ? "No Camera Detected" : "Enable Camera Access"}
        </Typography>
      </DialogTitle>

      <DialogContent>
        {unavailable ? (
          <>
            <Alert severity="warning" sx={{ mb: 2 }}>
              We couldn't find a camera on this device.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              You can still upload existing images and videos from your computer.
              Connect a camera and reload the page to enable live capture.
            </Typography>
          </>
        ) : denied ? (
          <>
            <Alert severity="error" sx={{ mb: 2 }}>
              Camera access is currently blocked.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              To enable capture, open your browser's site settings for this page
              and set <b>Camera</b> to <b>Allow</b>. Then reload the page.
            </Typography>
          </>
        ) : (
          <Box>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              Creating a CMS entry works best with camera access so you can:
            </Typography>
            <Box component="ul" sx={{ pl: 2, my: 0.5 }}>
              <li>
                <Typography variant="body2">Capture product/side images live</Typography>
              </li>
              <li>
                <Typography variant="body2">Record return/forward/damaged videos</Typography>
              </li>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              You can still upload files without granting access.
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <ButtonElement type="button" variant="tonal"
                color="secondary" onClick={onSkip} sx={{ fontSize: 13 }}>
          Skip for now
        </ButtonElement>
        {!unavailable && !denied && (
          <ButtonElement
            type="button"
            variant="contained"
            onClick={onRequest}
            sx={{ fontSize: 13, color: "white" }}
          >
            Allow Camera
          </ButtonElement>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default CameraPermissionModal;
