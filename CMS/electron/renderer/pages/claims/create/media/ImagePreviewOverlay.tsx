import { Close, VisibilityOutlined } from "../icons";
import { Box, Dialog, IconButton } from "@mui/material";
import { useCallback, useState } from "react";
import { tint } from "../tint";

/**
 * Centralised click-to-enlarge helper for the platform CMS forms that build
 * their own image slots (Myntra / Flipkart / Tata CliQ / Amazon packing +
 * contents grids). Returns a centered eye IconButton to overlay on each
 * filled slot plus a Dialog to render once at the bottom of the form. The
 * FileInput component already has an equivalent overlay of its own — this
 * hook keeps the custom-slot forms visually consistent with it.
 */
export const useImagePreviewOverlay = () => {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const openPreview = useCallback((src: string) => setPreviewSrc(src), []);
  const closePreview = useCallback(() => setPreviewSrc(null), []);

  /**
   * Centered eye button — drop inside each filled slot (position: relative
   * ancestor already provided by the slot Box).
   */
  const PreviewButton = ({ src }: { src: string }) => (
    <IconButton
      size="small"
      onClick={(e) => {
        e.stopPropagation();
        openPreview(src);
      }}
      sx={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 36,
        height: 36,
        bgcolor: tint('common.black', 0.55),
        color: "white",
        boxShadow: `0 4px 12px ${tint('common.black', 0.45)}`,
        "&:hover": { bgcolor: tint('common.black', 0.75) },
        zIndex: 2,
      }}
    >
      <VisibilityOutlined sx={{ fontSize: 18 }} />
    </IconButton>
  );

  /** Single Dialog for the whole form — render once alongside the slots. */
  const PreviewDialog = () => (
    <Dialog
      open={!!previewSrc}
      onClose={closePreview}
      maxWidth="md"
      PaperProps={{ sx: { bgcolor: "background.paper", boxShadow: 24 } }}
    >
      <IconButton
        onClick={closePreview}
        sx={{
          position: "absolute",
          top: 8,
          right: 8,
          bgcolor: tint('common.black', 0.55),
          color: "white",
          "&:hover": { bgcolor: tint('common.black', 0.75) },
          zIndex: 1,
        }}
        size="small"
      >
        <Close fontSize="small" />
      </IconButton>
      {previewSrc && (
        <Box
          component="img"
          src={previewSrc}
          alt="Preview"
          sx={{
            display: "block",
            maxWidth: "85vw",
            maxHeight: "85vh",
            objectFit: "contain",
          }}
        />
      )}
    </Dialog>
  );

  return { PreviewButton, PreviewDialog, openPreview, closePreview };
};
