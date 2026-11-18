import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
} from "@mui/material";
import {
  DragIndicator,
  Close as CloseIcon,
  AddPhotoAlternateOutlined,
} from "./icons";
import { tint } from "./tint";

export interface ArrangementField {
  fieldName: string;
  label: string;
  position: "first" | "last" | "middle";
}

export interface RearrangeModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (arrangedImages: string[]) => void;
  images: string[];
  schema: ArrangementField[];
  title?: string;
  initialSlotImages?: Record<string, string | null | undefined>;
}

interface SlotItem {
  id: string;
  imageUrl: string | null;
  isEmpty: boolean;
}

const getPositionColor = (position: "first" | "last" | "middle"): string => {
  switch (position) {
    case "first":
      return "success.main";
    case "last":
      return "error.main";
    case "middle":
      return "info.main";
    default:
      return "info.main";
  }
};

const RearrangeModal: React.FC<RearrangeModalProps> = ({
  open,
  onClose,
  onSave,
  images,
  schema,
  title = "Rearrange Screenshots",
  initialSlotImages,
}) => {
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [draggedSlotIndex, setDraggedSlotIndex] = useState<number | null>(null);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);
  const [draggedImageUrl, setDraggedImageUrl] = useState<string | null>(null);
  // Track the previous `open` value so we only re-initialize when the
  // modal transitions from closed → open. Some parents (CommonRightPart /
  // Ajio-Nykaa-Limeroad) push new `initialSlotImages` / `images`
  // references on every render as part of their blob-URL bookkeeping,
  // which would otherwise re-run `initializeSlots()` and instantly
  // revert any drag/drop the operator just made.
  const wasOpenRef = useRef<boolean>(false);

  const initializeSlots = () => {
    const firstField = schema.find((s) => s.position === "first");
    const lastField = schema.find((s) => s.position === "last");
    const middleFields = schema.filter((s) => s.position === "middle");

    const orderedSlots: SlotItem[] = [];
    if (firstField) orderedSlots.push({ id: firstField.fieldName, imageUrl: null, isEmpty: true });
    middleFields.forEach((field) =>
      orderedSlots.push({ id: field.fieldName, imageUrl: null, isEmpty: true }),
    );
    if (lastField) orderedSlots.push({ id: lastField.fieldName, imageUrl: null, isEmpty: true });

    if (initialSlotImages) {
      orderedSlots.forEach((slot) => {
        const url = initialSlotImages[slot.id];
        if (url) {
          slot.imageUrl = url;
          slot.isEmpty = false;
        }
      });
      setSlots(orderedSlots);
      return;
    }

    if (images.length > 0) {
      const firstImage = images[0];
      const lastImage = images[images.length - 1];

      if (firstField && firstImage) {
        const s = orderedSlots.find((x) => x.id === firstField.fieldName);
        if (s) {
          s.imageUrl = firstImage;
          s.isEmpty = false;
        }
      }
      if (lastField && lastImage) {
        const s = orderedSlots.find((x) => x.id === lastField.fieldName);
        if (s) {
          s.imageUrl = lastImage;
          s.isEmpty = false;
        }
      }
      if (images.length > 2) {
        const middleImages = images.slice(1, -1);
        middleFields.forEach((field, i) => {
          const middleImage = middleImages[i];

          if (middleImage) {
            const slot = orderedSlots.find((s) => s.id === field.fieldName);
            if (slot) {
              slot.imageUrl = middleImage;
              slot.isEmpty = false;
            }
          }
        });
      } else if (images.length === 2 && middleFields[0]) {
        const slot = orderedSlots.find((s) => s.id === middleFields[0]?.fieldName);
        const secondImage = images[1];

        if (slot && secondImage) {
          slot.imageUrl = secondImage;
          slot.isEmpty = false;
        }
      }
    }

    setSlots(orderedSlots);
  };

  /**
   * Lay the slots out once, when the modal opens.
   *
   * Placed AFTER `initializeSlots` on purpose: a closure read before its
   * declaration cannot see later changes to what it captures, and this one
   * captures the schema and the image pool.
   *
   * Only on the closed → open transition. Some parents push a new
   * `initialSlotImages` reference on every render as part of their blob-URL
   * bookkeeping, and re-running this would instantly revert the drag the
   * operator just made.
   */
  useEffect(() => {
    if (open && !wasOpenRef.current) initializeSlots();
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSlotDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedSlotIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Firefox refuses to fire the drop event unless dataTransfer carries
    // some payload set during dragstart. The value itself is unused — we
    // key drops off React state — but the call is mandatory.
    try {
      e.dataTransfer.setData("text/plain", `slot:${index}`);
    } catch {
      // Some browsers refuse this outside a real user gesture. The drag still
      // works — the payload is never read.
    }
    // currentTarget is the slot Box (source of the drag). Using e.target
    // would sometimes point at an inner element with 0 dimensions.
    const target = e.currentTarget as HTMLElement;
    e.dataTransfer.setDragImage(target, target.offsetWidth / 2, target.offsetHeight / 2);
  }, []);

  const handleSlotDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (draggedSlotIndex !== null && draggedSlotIndex !== index) {
        setDragOverSlotIndex(index);
      }
    },
    [draggedSlotIndex],
  );

  const handleSlotDragLeave = useCallback(() => setDragOverSlotIndex(null), []);

  const handleSlotDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      if (draggedSlotIndex === null || draggedSlotIndex === dropIndex) {
        setDraggedSlotIndex(null);
        setDragOverSlotIndex(null);
        return;
      }
      const updated = [...slots];
      const dragged = updated[draggedSlotIndex];
      const drop = updated[dropIndex];

      // Either index can be past the end if the slot layout changed between
      // picking a tile up and letting go of it — a platform switch mid-drag.
      if (!dragged || !drop) {
        setDraggedSlotIndex(null);
        setDragOverSlotIndex(null);

        return;
      }

      const temp = dragged.imageUrl;
      dragged.imageUrl = drop.imageUrl;
      dragged.isEmpty = dragged.imageUrl === null;
      drop.imageUrl = temp;
      drop.isEmpty = temp === null;
      setSlots(updated);
      setDraggedSlotIndex(null);
      setDragOverSlotIndex(null);
    },
    [draggedSlotIndex, slots],
  );

  const handleSlotDragEnd = useCallback(() => {
    setDraggedSlotIndex(null);
    setDragOverSlotIndex(null);
  }, []);

  const handleImageDragStart = useCallback((e: React.DragEvent, imageUrl: string) => {
    setDraggedImageUrl(imageUrl);
    e.dataTransfer.effectAllowed = "move";
    // Firefox: dragstart must set dataTransfer or drop won't fire.
    try {
      e.dataTransfer.setData("text/plain", imageUrl);
    } catch {
      // See the note on the slot drag above.
    }
    const target = e.currentTarget as HTMLElement;
    e.dataTransfer.setDragImage(target, target.offsetWidth / 2, target.offsetHeight / 2);
  }, []);

  const handleSlotImageDrop = useCallback(
    (e: React.DragEvent, slotIndex: number) => {
      e.preventDefault();
      if (draggedImageUrl === null) return;
      const updated = [...slots];
      const target = updated[slotIndex];

      if (!target) return;

      const sourceIndex = slots.findIndex((s) => s.imageUrl === draggedImageUrl);
      const source = sourceIndex === -1 ? undefined : updated[sourceIndex];

      if (source) {
        const temp = source.imageUrl;
        source.imageUrl = target.imageUrl;
        source.isEmpty = target.imageUrl === null;
        target.imageUrl = temp;
        target.isEmpty = temp === null;
      } else {
        target.imageUrl = draggedImageUrl;
        target.isEmpty = false;
      }
      setSlots(updated);
      setDraggedImageUrl(null);
    },
    [draggedImageUrl, slots],
  );

  const placedImageUrls = slots.filter((s) => !s.isEmpty).map((s) => s.imageUrl);
  const availableImages = images.filter((img) => img && !placedImageUrls.includes(img));

  const handleSave = () => {
    const arrangedImages = slots.map((slot) => slot.imageUrl || "");
    onSave(arrangedImages);
    onClose();
  };

  const handleReset = () => initializeSlots();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: 2, maxHeight: "90vh" } }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: (t) => `1px solid ${t.palette.divider}`,
          pb: 2,
        }}
      >
        <Typography variant="h6" fontWeight={600}>
          {title}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ py: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Drag and drop images between slots. You can place any image in any slot you want.
        </Typography>

        <Box sx={{ display: "flex", gap: 3, mb: 3, flexWrap: "wrap" }}>
          {schema.map((field) => (
            <Box key={field.fieldName} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  backgroundColor: getPositionColor(field.position),
                }}
              />
              <Typography variant="caption">{field.label}</Typography>
            </Box>
          ))}
        </Box>

        {availableImages.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
              Available Images (drag to any slot):
            </Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {availableImages.map((imageUrl, index) => (
                <Box
                  key={`available-${index}`}
                  draggable
                  onDragStart={(e) => handleImageDragStart(e, imageUrl)}
                  sx={{
                    width: 80,
                    height: 80,
                    borderRadius: 1,
                    overflow: "hidden",
                    border: (t) => `1px solid ${t.palette.divider}`,
                    cursor: "grab",
                    opacity: draggedImageUrl === imageUrl ? 0.5 : 1,
                    transition: "all 0.2s ease",
                    "&:hover": { borderColor: "primary.main", transform: "scale(1.05)" },
                  }}
                >
                  <img
                    src={imageUrl}
                    alt={`Available ${index + 1}`}
                    draggable={false}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      pointerEvents: "none",
                      userSelect: "none",
                      WebkitUserDrag: "none",
                    } as React.CSSProperties}
                  />
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {slots.map((slot, index) => {
            const field = schema.find((f) => f.fieldName === slot.id);
            const positionColor = getPositionColor(field?.position || "middle");
            const isDragging = draggedSlotIndex === index;
            const isDragOver = dragOverSlotIndex === index;

            return (
              <Box
                key={slot.id}
                sx={{
                  width: 150,
                  opacity: isDragging ? 0.5 : 1,
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    textAlign: "center",
                    mb: 0.5,
                    fontWeight: 600,
                    color: positionColor,
                  }}
                >
                  {field?.label || slot.id}
                </Typography>

                {/* Single Box carries BOTH drag source and drop target
                    handlers (mirrors the working inline pattern in
                    MyntraForm). Splitting them across parent/child was
                    letting the CSS transform on the parent shift the
                    hitbox mid-drag on Chromium, so `drop` never fired.
                    Everything visual now stays static during dragOver
                    (border + background only, no transform). */}
                <Box
                  draggable={!slot.isEmpty}
                  onDragStart={(e) => !slot.isEmpty && handleSlotDragStart(e, index)}
                  onDragOver={(e) => {
                    // preventDefault + dropEffect together are what
                    // tell the browser this element accepts the drop.
                    // Without dropEffect on every dragover, Firefox
                    // silently cancels the drop.
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (draggedImageUrl !== null) setDragOverSlotIndex(index);
                    else if (draggedSlotIndex !== null && draggedSlotIndex !== index)
                      handleSlotDragOver(e, index);
                  }}
                  onDragLeave={handleSlotDragLeave}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (draggedImageUrl !== null) handleSlotImageDrop(e, index);
                    else if (draggedSlotIndex !== null) handleSlotDrop(e, index);
                  }}
                  onDragEnd={handleSlotDragEnd}
                  sx={{
                    width: "100%",
                    height: 150,
                    borderRadius: 1,
                    overflow: "hidden",
                    border: `1px solid ${positionColor}`,
                    backgroundColor: slot.isEmpty ? "action.hover" : "common.white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: slot.isEmpty ? "default" : "grab",
                    "&:active": { cursor: "grabbing" },
                    "&:hover": { borderColor: "primary.main", borderStyle: "solid" },
                    ...(isDragOver && {
                      backgroundColor: tint('primary.main', 0.1),
                      borderColor: "primary.main",
                    }),
                  }}
                >
                  {slot.isEmpty ? (
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        color: "text.disabled",
                      }}
                    >
                      <AddPhotoAlternateOutlined sx={{ fontSize: 32 }} />
                      <Typography variant="caption" sx={{ color: "text.disabled" }}>
                        Drop here
                      </Typography>
                    </Box>
                  ) : (
                    <Box sx={{ position: "relative", width: "100%", height: "100%" }}>
                      <img
                        src={slot.imageUrl!}
                        alt={field?.label}
                        draggable={false}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          pointerEvents: "none",
                          userSelect: "none",
                          WebkitUserDrag: "none",
                        } as React.CSSProperties}
                      />
                      <Box
                        sx={{
                          position: "absolute",
                          top: 4,
                          left: 4,
                          backgroundColor: positionColor,
                          color: "white",
                          px: 0.75,
                          py: 0.25,
                          borderRadius: 0.5,
                          fontSize: "11px",
                          fontWeight: 600,
                          pointerEvents: "none",
                        }}
                      >
                        {index + 1}
                      </Box>
                      <Box
                        sx={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          backgroundColor: tint('common.black', 0.5),
                          borderRadius: 0.5,
                          p: 0.5,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          pointerEvents: "none",
                        }}
                      >
                        <DragIndicator sx={{ fontSize: 14, color: "white" }} />
                      </Box>
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>

        {slots.length === 0 && (
          <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
            <Typography>No slots configured</Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={handleReset} color="inherit">
          Reset
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          sx={{
            // The brand sweep, in whatever primary colour the operator chose.
            background: (t) =>
              `linear-gradient(to right, ${t.palette.primary.light}, ${t.palette.primary.main})`,
            "&:hover": {
              background: (t) =>
                `linear-gradient(to right, ${t.palette.primary.main}, ${t.palette.primary.dark})`,
            },
          }}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RearrangeModal;
