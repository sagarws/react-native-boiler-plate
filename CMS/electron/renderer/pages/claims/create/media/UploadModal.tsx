import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useMediaQuery,
  Button as ButtonElement,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { CloudUploadOutlined, DeleteRounded } from "../icons";

interface Props {
  open: boolean;
  onClose: () => void;
  handleFileChange: (file: File[]) => void;
  sideImages?: File[];
}

const UploadModal = ({ open, onClose, handleFileChange, sideImages }: Props) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isError, setIsError] = useState<string>("");
  const [images, setImages] = useState<File[]>([]);

  useEffect(() => {
    if (sideImages && sideImages.length > 0) {
      setImages([...sideImages]);
    } else {
      setImages([]);
    }
  }, [sideImages]);

  const handleClose = () => {
    onClose();
    setIsError("");
    setImages([]);
  };

  const handleSave = () => {
    if (images && images.length > 0) {
      handleFileChange(images);
    }
    handleClose();
  };

  const handleClearImage = (index: number, src: string) => () => {
    URL.revokeObjectURL(src);
    setImages((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && images.length + files.length > 9) {
      setIsError("You can only select up to 9 images.");
      return;
    }
    setIsError("");
    setImages((prev) => {
      const next = [...prev];
      if (files) {
        for (const file of Array.from(files)) next.push(file);
      }
      return next;
    });
  };

  const isXl = useMediaQuery((theme: any) => theme.breakpoints.up("xl"));
  const widthForSixSideImages = isXl ? "calc(33.33% - 12px)" : "calc(50% - 12px)";

  return (
    <Dialog maxWidth="sm" fullWidth open={open} onClose={onClose}>
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "center",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
        textAlign="center"
      >
        Upload Images
      </DialogTitle>

      <DialogContent>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/jpg"
          style={{ display: "none" }}
          multiple
          onChange={handleFileUpload}
        />

        <Box
          sx={{
            border: (t) =>
              `1px solid ${isError ? t.palette.error.main : t.palette.divider}`,
            marginBottom: "1rem",
            minHeight: "150px",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            cursor: "pointer",
            borderRadius: "8px",
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <CloudUploadOutlined fontSize="large" color="primary" />
          <Typography fontSize="large" fontWeight="bold" color="primary">
            Upload
          </Typography>
          <Typography fontSize="small" color="textSecondary">
            Max you can select 9 images
          </Typography>
          <Typography fontSize="small" color="error">
            {isError}
          </Typography>
        </Box>

        <Box
          sx={{
            display: "flex",
            justifyContent: "start",
            alignItems: "center",
            flexDirection: "row",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          {images.length > 0 &&
            images.map((image, index) => {
              const src = typeof image !== "string" ? URL.createObjectURL(image) : (image as any);
              return (
                <Box
                  key={index}
                  sx={{
                    border: (t) => `1px solid ${t.palette.divider}`,
                    height: "120px",
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
                      borderRadius: "10px",
                    }}
                  />
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
            })}
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          marginBottom: "1rem",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ButtonElement
          type="button"
          variant="contained"
          sx={{ color: "white" }}
          onClick={handleSave}
        >
          Save
        </ButtonElement>
        <ButtonElement
          type="button"
          variant="tonal"
                color="secondary"
          onClick={handleClose}
        >
          Cancel
        </ButtonElement>
      </DialogActions>
    </Dialog>
  );
};

export default UploadModal;
