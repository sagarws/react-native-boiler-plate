import { Box, Divider, FormHelperText, TextField, Typography } from "@mui/material";
import { CameraAltOutlined } from "./icons";
import type { ClaimForm } from "./useClaimForm";
import { type ChangeEvent, useState } from "react";
import FileInput from "./media/FileInput";
import { type ICms } from "@shared/types/cmsCreate";
import { largeVideoNotice } from "./media/largeVideo";

interface Props {
  formik: ClaimForm<ICms>;
  feedId: string;
  /** Both may be absent: the slot has nothing in it yet. See FileInput. */
  previews: {
    returnVideo: string | null | undefined;
    forwardVideo: string | null | undefined;
  };
  onPreviewChange: (name: string, file: File | null) => void;
  onLinkChange: (side: "returnVideo" | "forwardVideo", value: string) => void;
}

/**
 * Under a video box, only while a large video is uploading into it — the same
 * words as the toast, but there for as long as the wait lasts.
 */
const VideoHint = ({ uploading }: { uploading: File | null }) => {
  const notice = uploading ? largeVideoNotice(uploading) : null;

  if (!notice) return null;

  return (
    <Typography variant="caption" color="text.secondary" className="flex items-start gap-1" role="status">
      <i className="tabler-info-circle text-base shrink-0" aria-hidden="true" />
      {notice}
    </Typography>
  );
};

/**
 * Return + Forward video row (upload OR link), matching App CMSPage.tsx
 * left-side layout at lines ~1996-2205.
 */
const LeftVideos = ({ formik, feedId, previews, onPreviewChange, onLinkChange }: Props) => {
  const [uploadingReturn, setUploadingReturn] = useState<File | null>(null);
  const [uploadingForward, setUploadingForward] = useState<File | null>(null);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        marginBottom: 2,
        gap: "16px",
        width: "100%",
      }}
    >
      {/* Return Video */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
      <Box
        sx={{
          display: "flex",
          borderRadius: "8px",
          border: (t) => `1px solid ${t.palette.divider}`,
          padding: "12px",
          flex: "1 1 auto",
        }}
      >
        <Box sx={{ width: "100%", display: "flex", flexDirection: "column", gap: "6px" }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography>
              Upload Return Video <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
            </Typography>
            {(formik.touched.returnVideo || formik.touched.returnVideoLink) &&
              formik.errors.eitherVideoOrLink && (
                <FormHelperText sx={{ ml: 1 }} error>
                  {formik.errors.eitherVideoOrLink as string}
                </FormHelperText>
              )}
          </Box>
          <FileInput
            name="returnVideo"
            onUploadingChange={setUploadingReturn}
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="150px"
            width="100%"
            preview={previews.returnVideo}
            onFileChange={onPreviewChange}
            error={formik?.errors?.returnVideo === "*Unsupported File Format"}
            isVideo
            disableCapture
          >
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "text.secondary" }}>
              <CameraAltOutlined fontSize="large" />
              <Typography variant="caption">Choose a video</Typography>
            </Box>
          </FileInput>
          {!previews.returnVideo && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: "6px", mt: 0.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Divider sx={{ flex: 1, borderColor: "primary.light" }} />
                <Typography variant="caption" color="text.secondary">or paste link</Typography>
                <Divider sx={{ flex: 1, borderColor: "primary.light" }} />
              </Box>
              <TextField
                fullWidth
                size="small"
                name="returnVideoLink"
                placeholder="Return Video Link"
                value={formik.values.returnVideoLink}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  formik.setFieldValue("returnVideoLink", e.target.value);
                  onLinkChange("returnVideo", e.target.value);
                }}
              />
            </Box>
          )}
        </Box>
      </Box>
        <VideoHint uploading={uploadingReturn} />
      </Box>

      {/* Forward Video */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
      <Box
        sx={{
          display: "flex",
          borderRadius: "8px",
          border: (t) => `1px solid ${t.palette.divider}`,
          padding: "12px",
          flex: "1 1 auto",
        }}
      >
        <Box sx={{ width: "100%", display: "flex", flexDirection: "column", gap: "6px" }}>
          <Typography>Upload Forward Video</Typography>
          <FileInput
            name="forwardVideo"
            onUploadingChange={setUploadingForward}
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="150px"
            width="100%"
            preview={previews.forwardVideo}
            onFileChange={onPreviewChange}
            error={formik?.errors?.forwardVideo === "*Unsupported File Format"}
            isVideo
            disableCapture
          >
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "text.secondary" }}>
              <CameraAltOutlined fontSize="large" />
              <Typography variant="caption">Choose a video</Typography>
            </Box>
          </FileInput>
          {!previews.forwardVideo && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: "6px", mt: 0.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Divider sx={{ flex: 1, borderColor: "primary.light" }} />
                <Typography variant="caption" color="text.secondary">or paste link</Typography>
                <Divider sx={{ flex: 1, borderColor: "primary.light" }} />
              </Box>
              <TextField
                fullWidth
                size="small"
                name="forwardVideoLink"
                placeholder="Forward Video Link"
                value={formik.values.forwardVideoLink}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  formik.setFieldValue("forwardVideoLink", e.target.value);
                  onLinkChange("forwardVideo", e.target.value);
                }}
                onBlur={formik.handleBlur}
              />
            </Box>
          )}
        </Box>
      </Box>
        <VideoHint uploading={uploadingForward} />
      </Box>
    </Box>
  );
};

export default LeftVideos;
