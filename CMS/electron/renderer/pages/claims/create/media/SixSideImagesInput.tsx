import {
  Box,
  Dialog,
  Divider,
  IconButton,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  Close,
  DeleteRounded,
  InsertPhotoOutlined,
  PhotoCameraOutlined,
  PictureAsPdfOutlined,
  VisibilityOutlined,
} from "../icons";
import React, { useState } from "react";
import UploadModal from "./UploadModal";
import { tint } from "../tint";

interface SixSideImagesInputProps {
  handleCameraClick: (
    event: React.MouseEvent<HTMLButtonElement>,
    index: number,
    imgType?: string,
  ) => void;
  sideImages: File[] | [];
  setSideImages: (files: File[]) => void;
  /**
   * /cms/update: URL of the stored six-side PDF for the loaded claim.
   * When present and the operator hasn't picked new files this session,
   * a "View PDF" tile is rendered inside the grid so the operator can
   * open the stored PDF and knows that images ARE saved. The PDF can't
   * be split back into individual grid tiles (it was merged from 3..9
   * source images by createPdfFromImages_old at create time), so a
   * single tile is the honest representation.
   */
  existingPdfUrl?: string;
}

const SixSideImagesInput = ({
  sideImages,
  setSideImages,
  handleCameraClick,
  existingPdfUrl,
}: SixSideImagesInputProps) => {
  const [isOpenUploadModal, setIsOpenUploadModal] = React.useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const handleUploadModalClose = () => {
    setIsOpenUploadModal(false);
  };

  const handleFileChange = (files: File[]) => {
    if (files && files.length > 0) {
      setSideImages(files);
    }
  };

  const handleClearImage = (index: number, src: string) => () => {
    URL.revokeObjectURL(src);
    const files = sideImages ? Array.from(sideImages) : [];
    files.splice(index, 1);
    setSideImages(files as never);
  };

  const isXl = useMediaQuery((theme: any) => theme.breakpoints.up("xl"));
  const widthForSixSideImages = isXl ? "calc(33.33% - 8px)" : "calc(33.33% - 8px)";

  const hasImages = !!(sideImages && sideImages.length > 0);
  // The stored PDF (on /cms/update) is separate from whatever populates the
  // side-images grid — on the update surface the grid gets seeded from the VMS
  // pool / carry-over, which is unrelated to the merged PDF that was actually
  // saved with the claim. Show the tile whenever the claim has one, so the
  // operator can always open it, even when the grid already has tiles.
  const hasExistingPdf = !!existingPdfUrl;

  const renderExistingPdfTile = () => (
    <Box
      component="a"
      href={existingPdfUrl}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        border: (t) => `1px solid ${t.palette.divider}`,
        height: "88px",
        width: widthForSixSideImages,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: "4px",
        borderRadius: "8px",
        position: "relative",
        cursor: "pointer",
        textDecoration: "none",
        color: (t) => t.palette.primary.main,
        transition: "background .2s ease",
        "&:hover": {
          bgcolor: (t) =>
            t.palette.mode === "dark"
              ? tint('common.white', 0.04)
              : tint('common.black', 0.03),
        },
      }}
    >
      <PictureAsPdfOutlined fontSize="medium" />
      <Typography fontSize={11} fontWeight="bold">
        View PDF
      </Typography>
      <Typography fontSize={10} sx={{ color: "text.secondary" }}>
        Stored
      </Typography>
    </Box>
  );

  const renderUploadCaptureBox = (widthOverride?: string) => (
    <Box
      sx={{
        border: (t) => `1px solid ${t.palette.divider}`,
        /*
         * The fill is what makes this read as a panel, not just the border.
         *
         * A `divider` hairline is faint against a dark surface, so on the dark
         * scheme the six-side dropzone had no edges at all — an Upload and a
         * Capture label floating in the page. Every other dropzone on this
         * screen pairs the border with `background.paper`; this one did not.
         *
         * (The border was dashed when this was written. It is solid now, with
         * every other border in the app, but the fill is still doing this job.)
         */
        bgcolor: "background.paper",
        paddingBlock: "6px",
        minHeight: widthOverride ? "88px" : "110px",
        height: widthOverride ? undefined : "100%",
        width: widthOverride ?? "100%",
        display: "flex",
        flexWrap: "wrap",
        gap: "4px",
        justifyContent: "center",
        alignItems: "center",
        cursor: "pointer",
        borderRadius: "8px",
        position: "relative",
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          height: "100%",
          padding: "6px",
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            width: "50%",
            height: "100%",
          }}
          onClick={() => setIsOpenUploadModal(true)}
        >
          <InsertPhotoOutlined fontSize="medium" color="primary" />
          <Typography fontSize={11} fontWeight="bold" color="primary">
            Upload
          </Typography>
        </Box>
        <Divider orientation="vertical" sx={{ width: "1px", height: "100%" }} />
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            width: "50%",
            height: "100%",
          }}
          onClick={(e: any) => handleCameraClick(e, 0, "sideImages")}
        >
          <PhotoCameraOutlined color="primary" fontSize="medium" />
          <Typography color="primary" fontSize={11} fontWeight="bold">
            Capture
          </Typography>
        </Box>
      </Box>
    </Box>
  );

  return (
    <>
      <Box
        sx={{
          padding: "6px 0 6px 0",
          display: "flex",
          flexWrap: "wrap",
          marginBottom: 1,
          gap: "8px",
          width: "100%",
          position: "relative",
        }}
      >
        {/* Stored PDF preview — always rendered when the loaded claim has one.
            Sits first so the operator sees the saved artifact even after the
            grid fills with new picks / VMS shots. */}
        {hasExistingPdf ? renderExistingPdfTile() : null}
        {hasImages ? (
          Array.from(sideImages).map((image, index) => {
            const src =
              typeof image !== "string" ? URL.createObjectURL(image) : (image as any);
            return (
              <Box
                key={index}
                sx={{
                  border: (t) => `1px solid ${t.palette.divider}`,
                  height: "88px",
                  width: widthForSixSideImages,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  borderRadius: "8px",
                  position: "relative",
                }}
              >
                <img
                  src={src}
                  alt="Preview"
                  style={{
                    maxWidth: "100%",
                    height: "100%",
                    objectFit: "contain",
                    borderRadius: "8px",
                  }}
                />
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewSrc(src);
                  }}
                  sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 32,
                    height: 32,
                    bgcolor: tint('common.black', 0.55),
                    color: "white",
                    boxShadow: `0 4px 12px ${tint('common.black', 0.45)}`,
                    "&:hover": { bgcolor: tint('common.black', 0.75) },
                  }}
                >
                  <VisibilityOutlined sx={{ fontSize: 18 }} />
                </IconButton>
                <Box
                  sx={{
                    position: "absolute",
                    top: -7,
                    right: -7,
                    backgroundColor: "error.main",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    borderRadius: "100%",
                    padding: "2px",
                    boxShadow: `0 2px 6px ${tint('common.black', 0.35)}`,
                  }}
                >
                  <DeleteRounded
                    sx={{ color: "white" }}
                    fontSize="inherit"
                    onClick={handleClearImage(index, src)}
                  />
                </Box>
              </Box>
            );
          })
        ) : hasExistingPdf ? null : (
          // No images AND no stored PDF: fall back to the big Upload/Capture
          // combo tile so first-time create surfaces still look right.
          renderUploadCaptureBox()
        )}
        {/* Upload/Capture pill — visible whenever the grid has at least one
            existing tile (image or stored PDF) AND room for another image. */}
        {(hasImages || hasExistingPdf) && (sideImages?.length ?? 0) < 9 &&
          renderUploadCaptureBox(widthForSixSideImages)}
      </Box>

      <UploadModal
        handleFileChange={handleFileChange}
        sideImages={sideImages}
        open={isOpenUploadModal}
        onClose={handleUploadModalClose}
      />

      <Dialog
        open={!!previewSrc}
        onClose={() => setPreviewSrc(null)}
        maxWidth="md"
        PaperProps={{ sx: { bgcolor: "background.paper", boxShadow: 24 } }}
      >
        <IconButton
          onClick={() => setPreviewSrc(null)}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            bgcolor: tint('common.black', 0.55),
            color: "white",
            "&:hover": { bgcolor: tint('common.black', 0.75) },
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
              maxWidth: "80vw",
              maxHeight: "80vh",
              objectFit: "contain",
            }}
          />
        )}
      </Dialog>
    </>
  );
};

export default SixSideImagesInput;
