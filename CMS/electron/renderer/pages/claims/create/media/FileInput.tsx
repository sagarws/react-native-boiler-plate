import { Close, DeleteRounded, PictureAsPdfOutlined, InsertPhotoOutlined, PhotoCameraOutlined, VideocamOutlined, FiberManualRecord, VisibilityOutlined } from "../icons";
import { Box, CircularProgress, Dialog, Divider, IconButton, Typography, useMediaQuery } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import {
  deleteCmsFile,
  storeCmsVideo,
  uploadCmsImage,
} from "../api";
import { useMediaCapture } from "./MediaCaptureProvider";
import { largeVideoNotice } from "./largeVideo";
import { useToast } from "@renderer/hooks/useToast";
import { retryVideoAsProcessed } from "../videoSource";
import { tint } from "../tint";

type props = {
  height: string;
  width: string;
  name: string;
  /**
   * The image or video to show, or nothing.
   *
   * `undefined` is accepted alongside `null` because every caller reads this
   * out of a `Record<string, string | null>` keyed by slot name, and a slot
   * nobody has filled yet is simply absent from that record. Both mean the
   * same thing here — there is nothing to preview — and making each of the
   * twenty call sites say `?? null` would be twenty chances to forget.
   */
  preview: string | null | undefined;
  feedId: string;
  onFileChange: (name: string, file: File | null) => void;
  setFieldValue: (field: string, value: any, shouldValidate?: boolean) => any;
  setFieldTouched: (field: string, touched?: boolean, shouldValidate?: boolean) => any;
  error: boolean | undefined;
  isVideo?: boolean;
  loading?: boolean;
  children?: React.ReactNode;
  /** Set to true to disable the live capture (e.g. PDF-only slots). */
  disableCapture?: boolean;
  /** The video being uploaded when one starts, null when it ends either way. */
  onUploadingChange?: (file: File | null) => void;
};

const FileInput = ({
  height,
  width,
  name,
  setFieldValue,
  setFieldTouched,
  preview,
  onFileChange,
  error,
  isVideo,
  loading,
  children,
  feedId,
  disableCapture,
  onUploadingChange,
}: props) => {
  const [isPdf, setIsPdf] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [fileKey, setFileKey] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const media = useMediaCapture();
  const toast = useToast();
  const captureEnabled = !disableCapture && !!media && media.isReady;

  const isXl = useMediaQuery((theme: any) => theme.breakpoints.up("xl"));
  const responsiveHeightForReturnVideo = isXl ? "350px" : "300px";

  const inputType =
    name === "returnVideo" || name === "forwardVideo"
      ? "video/*"
      : name === "returnProductImage" || name === "forwardSentProductImage"
      ? "image/jpg,image/png,image/jpeg"
      : name === "podProof" || name === "additionalFieldValue"
      ? ".pdf,image/jpg,image/png,image/jpeg"
      : "";

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleCaptureClick = () => {
    if (!media) return;
    if (isVideo) {
      media.openVideoRecord({
        name,
        onCapture: (videoId, file) => {
          setFieldValue(name, videoId);
          onFileChange(name, file);
        },
      });
    } else {
      media.openImageCapture({
        name,
        onCapture: (key, file) => {
          setFieldValue(name, key);
          onFileChange(name, file);
        },
      });
    }
  };

  const handleStoreFile = async (file: File) => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("feedId", feedId || "");

    const isVideoFile = file.type.startsWith("video/");
    const notice = isVideoFile ? largeVideoNotice(file) : null;
    if (notice) toast.info(notice);
    if (isVideoFile) onUploadingChange?.(file);

    try {
      const response = file.type.startsWith("video/")
        ? await storeCmsVideo(formData)
        : await uploadCmsImage(formData);

      if (response.status === 200) {
        if (file.type.startsWith("video/")) {
          setFieldValue(name, response.data.data._id);
          setFileKey(response.data.data.key);
        } else {
          setFieldValue(name, response.data.data.key);
          setFileKey(response.data.data.key);
        }
        onFileChange(name || "", file);
      }
    } catch (err) {
      console.warn(err);
    } finally {
      setIsLoading(false);
      if (isVideoFile) onUploadingChange?.(null);
      setFieldTouched(name, true, false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type === "application/pdf") {
        setIsPdf(true);
      }
      if (name && setFieldValue) {
        if (
          file.type.startsWith("video/") ||
          file.type.startsWith("image/") ||
          file.type === "application/pdf"
        ) {
          void handleStoreFile(file);
        } else {
          setFieldTouched(name, true, false);
          setFieldValue(name, file);
          onFileChange(name || "", file);
        }
      }
    } else {
      if (preview && preview.startsWith("http")) {
        setFieldValue(name, preview);
        setFileKey(preview);
      } else {
        setFieldTouched(name, true, false);
        setFieldValue(name, "");
        onFileChange(name || "", null);
      }
    }
  };

  const clearInput = async (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (fileKey) {
      try {
        const response = await deleteCmsFile(fileKey);
        if (response.status === 200) {
          setIsPdf(false);
          setFieldValue(name || "", "");
          onFileChange(name || "", null);
          setFileKey("");
        }
      } catch (err) {
        console.warn(err);
      }
    }
    setIsPdf(false);
    setFieldValue(name || "", "");
    onFileChange(name || "", null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!preview) {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [preview]);

  const showSplit = !preview && !isLoading && !loading && captureEnabled;
  const boxOnClick = showSplit || preview ? undefined : handleUploadClick;

  return (
    <>
    <Box
      onClick={boxOnClick}
      sx={{
        border: (t) => `1px solid ${t.palette.divider}`,
        height: height,
        width: width,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        cursor: boxOnClick ? "pointer" : "default",
        borderRadius: "8px",
        position: "relative",
        bgcolor: "background.paper",
        transition: "border-color .2s ease, background .2s ease",
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      <input
        ref={fileInputRef}
        disabled={preview ? true : false}
        accept={inputType}
        type="file"
        name={name}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      {isLoading || loading ? (
        <CircularProgress size={24} color="primary" />
      ) : showSplit ? (
        <SplitUploadCapture
          isVideo={!!isVideo}
          onUpload={handleUploadClick}
          onCapture={handleCaptureClick}
        />
      ) : (
        <>
          {(!preview || error) && children}
          {preview && !error && (
            <Box
              sx={{
                zIndex: 1,
                height: `calc(${height} - 5px)`,
                width: `calc(${width} - 5px)`,
              }}
            >
              {isPdf ? (
                <Box
                  sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    zIndex: 1,
                    maxWidth: "100%",
                    textWrap: "wrap",
                    backgroundColor: tint('primary.main', 0.08),
                    display: "flex",
                    padding: "5px 10px",
                    borderRadius: "10px",
                    border: (t) => `1px solid ${t.palette.primary.main}`,
                    gap: "5px",
                    alignItems: "center",
                  }}
                >
                  <PictureAsPdfOutlined color="primary" />
                  <Typography variant="body2" color="primary">
                    {preview.substring(0, 10)} {preview.length > 10 ? "..." : ""}
                  </Typography>
                </Box>
              ) : isVideo ? (
                <video
                  src={preview}
                  controls
                  onError={retryVideoAsProcessed}
                  style={{
                    width: "100%",
                    height: "100%",
                    maxWidth: "650px",
                    maxHeight:
                      name === "returnVideo" || name === "forwardVideo"
                        ? responsiveHeightForReturnVideo
                        : "350px",
                    borderRadius: "10px",
                  }}
                />
              ) : (
                <img
                  src={preview}
                  alt="Preview"
                  style={{
                    maxWidth: "100%",
                    height: "100%",
                    objectFit: "cover",
                    borderRadius: "10px",
                  }}
                />
              )}
              {!isPdf && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewOpen(true);
                  }}
                  sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 40,
                    height: 40,
                    bgcolor: tint('common.black', 0.55),
                    color: "white",
                    boxShadow: `0 4px 12px ${tint('common.black', 0.45)}`,
                    "&:hover": { bgcolor: tint('common.black', 0.75) },
                    zIndex: 2,
                  }}
                >
                  <VisibilityOutlined sx={{ fontSize: 20 }} />
                </IconButton>
              )}
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
                  onClick={(event) => void clearInput(event)}
                />
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
    <Dialog
      open={previewOpen && !!preview && !isPdf}
      onClose={() => setPreviewOpen(false)}
      maxWidth="md"
      PaperProps={{ sx: { bgcolor: "background.paper", boxShadow: 24 } }}
    >
      <IconButton
        onClick={() => setPreviewOpen(false)}
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
      {preview && !isPdf && (
        isVideo ? (
          <Box
            component="video"
            src={preview}
            controls
            autoPlay
            sx={{
              display: "block",
              maxWidth: "85vw",
              maxHeight: "85vh",
              objectFit: "contain",
            }}
          />
        ) : (
          <Box
            component="img"
            src={preview}
            alt="Preview"
            sx={{
              display: "block",
              maxWidth: "85vw",
              maxHeight: "85vh",
              objectFit: "contain",
            }}
          />
        )
      )}
    </Dialog>
    </>
  );
};

interface SplitProps {
  isVideo: boolean;
  onUpload: () => void;
  onCapture: () => void;
}

const SplitUploadCapture = ({ isVideo, onUpload, onCapture }: SplitProps) => (
  <Box
    sx={{
      display: "flex",
      alignItems: "stretch",
      width: "100%",
      height: "100%",
      minHeight: 90,
    }}
  >
    <Box
      role="button"
      onClick={(e) => {
        e.stopPropagation();
        onUpload();
      }}
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.5,
        cursor: "pointer",
        color: "primary.main",
        "&:hover": { bgcolor: tint('primary.main', 0.06) },
      }}
    >
      {isVideo ? <VideocamOutlined fontSize="medium" /> : <InsertPhotoOutlined fontSize="medium" />}
      <Typography variant="caption" fontWeight={600}>Upload</Typography>
    </Box>
    <Divider orientation="vertical" flexItem />
    <Box
      role="button"
      onClick={(e) => {
        e.stopPropagation();
        onCapture();
      }}
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.5,
        cursor: "pointer",
        color: "primary.main",
        "&:hover": { bgcolor: tint('primary.main', 0.06) },
      }}
    >
      {isVideo ? <FiberManualRecord fontSize="medium" sx={{ color: "error.main" }} /> : <PhotoCameraOutlined fontSize="medium" />}
      <Typography variant="caption" fontWeight={600}>
        {isVideo ? "Record" : "Capture"}
      </Typography>
    </Box>
  </Box>
);

export default FileInput;
