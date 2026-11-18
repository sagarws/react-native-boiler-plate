import { Close, CloseRounded } from "../icons";
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
  Button as ButtonElement,
} from "@mui/material";
import React, { useEffect, useRef, useState } from "react";
import Webcam, { type WebcamHandle } from "./Webcam";
import { uploadCmsImage } from "../api";
import { tint } from "../tint";

type Props = {
  open: {
    open: boolean;
    index: number | null;
  };
  handleClose: () => void;
  handleFilePreviewChange: (name: string, file: File | null) => void;
  setFieldValue: (field: string, value: any, shouldValidate?: boolean) => void;
  setFieldTouched: (field: string, isTouched?: boolean, shouldValidate?: boolean) => void;
  currType: React.MutableRefObject<string>;
  feedId: string;
  setSideImages?: (images: File[]) => void;
  sideImages?: File[];
  // Escape hatch for Myntra packing slots that append to an array.
  onCustomCaptureSuccess?: (currType: string, s3Key: string, file: File) => boolean;
};

const DIMENSIONS = { width: 900, height: 500 };

const SINGLE_FIELD_KEYS = new Set([
  "returnProductImage",
  "forwardSentProductImage",
  "barcodeImage",
  "receivedProductImage_1",
  "reverseWayBillImage",
  "outerPackageImage_1",
  "outerPackageImage_2",
  "innerPackageImage_1",
  "innerPackageImage_2",
  "productImage_1",
  "productImage_2",
  "podImage_1",
  "podImage_2",
]);

const getTitle = (value: string) => {
  switch (value) {
    case "returnProductImage":
      return "Return Product Image";
    case "forwardSentProductImage":
      return "Forward Sent Product Image";
    case "sideImages":
      return "Side Images";
    default:
      return "";
  }
};

const CaptureImages = ({
  open,
  handleClose,
  handleFilePreviewChange,
  setFieldValue,
  setFieldTouched,
  currType,
  setSideImages,
  sideImages,
  onCustomCaptureSuccess,
  feedId,
}: Props) => {
  const [isMediaError, setIsMediaError] = useState<string>("");
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const previewIndexRef = useRef<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const webcamRef = useRef<WebcamHandle | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const counterRef = useRef<number>(0);

  // Cache one blob URL per File so we don't spawn a fresh URL (and leak the
  // old one) on every render. The Map is keyed by File identity; URLs for
  // Files that leave `images` are revoked immediately, and any URL still in
  // the map at unmount is revoked in the cleanup effect below.
  const previewUrlsRef = useRef<Map<File, string>>(new Map());
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    // `sideImages` is typed File[] but at runtime VMS auto-fetch mixes URL
    // strings into it; the preview effect below feeds each entry to
    // createObjectURL, which throws on non-Blobs. Match CommonRightPart and
    // only forward real File instances into the modal's buffer.
    const files = (sideImages as unknown as (File | string)[] | undefined)?.filter(
      (img): img is File => img instanceof File,
    );
    if (files && files.length > 0) {
      setImages(files);
    } else {
      setImages([]);
    }
  }, [sideImages]);

  useEffect(() => {
    const map = previewUrlsRef.current;
    const active = new Set(images);
    const nextUrls: string[] = [];
    for (const file of images) {
      let url = map.get(file);
      if (!url) {
        url = URL.createObjectURL(file);
        map.set(file, url);
      }
      nextUrls.push(url);
    }
    for (const [file, url] of map) {
      if (!active.has(file)) {
        URL.revokeObjectURL(url);
        map.delete(file);
      }
    }
    setPreviewUrls(nextUrls);
  }, [images]);

  useEffect(() => {
    // The MAP is captured, not its contents: its identity never changes, so
    // this reads whatever is in it at unmount — which is the point. A blob URL
    // that is never revoked holds its bytes in memory for the life of the
    // window, and this screen makes one per photograph.
    const urls = previewUrlsRef.current;

    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const handleSave = () => {
    if (images && images.length > 0) {
      setSideImages?.(images);
    }
    handleClose();
  };

  const uploadCapturedImage = (newFile: File) => {
    const formData = new FormData();
    formData.append("file", newFile);
    formData.append("feedId", feedId || "");

    uploadCmsImage(formData)
      .then((data: any) => {
        const s3Key = data.data.data.key;
        const handled = onCustomCaptureSuccess?.(currType.current, s3Key, newFile);
        if (handled) {
          currType.current = "";
          handleClose();
          return;
        }
        if (SINGLE_FIELD_KEYS.has(currType.current)) {
          setFieldValue(currType.current, s3Key);
          setFieldTouched(currType.current, true, false);
          handleFilePreviewChange(currType.current, newFile);
          currType.current = "";
          handleClose();
          return;
        }
        // Side images path: append to buffer
        setImages((prev) => [...prev, newFile]);
      })
      .catch((error) => {
        console.error("Error uploading image:", error);
      })
      .finally(() => {
        setIsUploading(false);
        setIsCapturing(false);
      });
  };

  const handleCaptureScreenshot = () => {
    const video = webcamRef.current?.video;
    if (!video) {
      console.warn("Webcam video element not available");
      return;
    }

    setIsCapturing(true);

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) {
      setIsCapturing(false);
      return;
    }
    ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
    setIsUploading(true);
    // Straight from the canvas, not `fetch(toDataURL())`: the CSP is
    // `connect-src 'self'`, which refuses a `data:` fetch, so every capture
    // silently vanished. Fire-and-forget — this is a click handler.
    tempCanvas.toBlob((blob) => {
      if (!blob) {
        setIsUploading(false);
        setIsCapturing(false);
        return;
      }
      const newFile = new File([blob], `${currType.current}.png`, {
        type: "image/png",
      });
      uploadCapturedImage(newFile);
    }, "image/png");
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!open.open) return;
      // Scope preventDefault to Space only — the previous unconditional
      // preventDefault broke Tab / Enter / Esc navigation inside the dialog.
      if (event.code !== "Space") return;
      event.preventDefault();
      if (isCapturing || isUploading) return;
      if (counterRef.current < 9) {
        handleCaptureScreenshot();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.open, isCapturing, isUploading]);

  const handleScreenShotRemove = (event: React.MouseEvent, index: number) => {
    event.stopPropagation();
    counterRef.current -= 1;
    if (images.length === 1) {
      setIsPreviewOpen(false);
      previewIndexRef.current = null;
      setPreviewIndex(null);
      setImages([]);
      return;
    }
    const newImages = [...images];
    newImages.splice(index, 1);
    setImages(newImages);
    if (previewIndexRef.current !== null) {
      if (previewIndexRef.current + 1 === images.length) {
        previewIndexRef.current = previewIndexRef.current - 1;
        setPreviewIndex(previewIndexRef.current);
      }
    }
  };

  return (
    <Dialog
      onClose={handleClose}
      open={open.open}
      maxWidth="xl"
      PaperProps={{ sx: { maxHeight: "90vh" } }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <Typography variant="h6" fontWeight={600}>
          {getTitle(currType.current)}
        </Typography>
        <Tooltip title="Close" arrow>
          <IconButton onClick={handleClose}>
            <Close />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "row", width: "100%", height: DIMENSIONS.height }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: "row",
              alignItems: "start",
              gap: "1rem",
              width: "100%",
              height: DIMENSIONS.height,
            }}
          >
            {isPreviewOpen && previewIndex !== null && images[previewIndex] ? (
              <Box>
                <img
                  src={previewUrls[previewIndex]}
                  style={{
                    width: DIMENSIONS.width - 215,
                    height: DIMENSIONS.height - 15,
                    borderRadius: "8px",
                  }}
                  alt="Preview"
                />
              </Box>
            ) : isMediaError ? (
              <Box
                sx={{
                  width: DIMENSIONS.width - 215,
                  height: DIMENSIONS.height - 15,
                  borderRadius: "8px",
                }}
              >
                <Alert severity="error">{isMediaError || "Media Error"}</Alert>
              </Box>
            ) : (
              <Box sx={{ width: "100%", height: "100%" }}>
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  videoConstraints={{
                    width: DIMENSIONS.width,
                    height: DIMENSIONS.height,
                    facingMode: "environment",
                  }}
                  onUserMediaError={(e: any) => {
                    setIsMediaError(
                      typeof e === "string"
                        ? e
                        : e?.message || "Unable to access webcam. Check browser permissions.",
                    );
                  }}
                  style={{ width: "100%", height: "100%", borderRadius: "8px", objectFit: "cover" }}
                />
              </Box>
            )}

            {open.index !== null && !isMediaError && (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                  height: "100%",
                  padding: "10px",
                  border: (t) => `1px solid ${t.palette.divider}`,
                  borderRadius: "8px",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "1rem",
                    height: "100%",
                    overflowY: "auto",
                    overflowX: "hidden",
                  }}
                >
                  {images.length > 0 &&
                    images.map((image, index) => {
                      if (!(image instanceof Blob)) return null;
                      const src = previewUrls[index];
                      if (!src) return null;
                      return (
                        <Box
                          key={index}
                          onClick={() => {
                            previewIndexRef.current = index;
                            setPreviewIndex(index);
                            setIsPreviewOpen(true);
                          }}
                          sx={{
                            border: (t) =>
                              isPreviewOpen && previewIndex === index
                                ? `1px solid ${t.palette.primary.main}`
                                : `1px solid ${t.palette.divider}`,
                            height: "120px",
                            width: "160px",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            cursor: "pointer",
                            borderRadius: "8px",
                            position: "relative",
                          }}
                        >
                          <img
                            src={src}
                            alt="Preview"
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              borderRadius: "6px",
                            }}
                          />
                          <CloseRounded
                            onClick={(e) => {
                              handleScreenShotRemove(e, index);
                              setIsPreviewOpen(false);
                              previewIndexRef.current = null;
                              setPreviewIndex(null);
                              counterRef.current = 0;
                            }}
                            sx={{
                              width: 20,
                              height: 20,
                              background: "primary.main",
                              bgcolor: "primary.main",
                              position: "absolute",
                              top: "5px",
                              right: "5px",
                              color: "white",
                              cursor: "pointer",
                              padding: "1px",
                              borderRadius: "50%",
                            }}
                          />
                        </Box>
                      );
                    })}
                  {Array(Math.max(0, 9 - images.length))
                    .fill(0)
                    .map((_, index) => (
                      <Box
                        key={index}
                        onClick={() => {
                          setIsPreviewOpen(false);
                          previewIndexRef.current = null;
                          setPreviewIndex(null);
                        }}
                        sx={{
                          border: (t) => `1px solid ${t.palette.divider}`,
                          minHeight: "120px",
                          height: "120px",
                          width: "160px",
                          borderRadius: "8px",
                        }}
                      />
                    ))}
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                  }}
                >
                  <Typography variant="body1" fontWeight={600}>
                    {images.length}/9
                  </Typography>
                  <ButtonElement
                    onClick={() => {
                      setIsPreviewOpen(false);
                      previewIndexRef.current = null;
                      setPreviewIndex(null);
                      setImages([]);
                      counterRef.current = 0;
                    }}
                    size="small"
                  >
                    Clear
                  </ButtonElement>
                </Box>
              </Box>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "1rem",
            gap: "1rem",
          }}
        >
          <Typography color="primary.dark" mt="16px" sx={{ textAlign: "center" }}>
            Press{" "}
            <span
              style={{
                fontWeight: "bold",
                backgroundColor: tint('primary.main', 0.08),
                padding: "5px",
                borderRadius: "5px",
              }}
            >
              SPACE
            </span>{" "}
            to capture the screenshot
          </Typography>
          <ButtonElement
            onClick={handleCaptureScreenshot}
            disabled={
              !!isMediaError ||
              (open.index !== null &&
                (images.length >= 9 || isPreviewOpen || isCapturing || isUploading))
            }
          >
            {isCapturing || isUploading ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              "Capture Screenshot"
            )}
          </ButtonElement>
          {open.index !== null && (
            <ButtonElement onClick={handleSave}>Save</ButtonElement>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(CaptureImages);
