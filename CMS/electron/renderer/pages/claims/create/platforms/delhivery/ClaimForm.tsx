import {
  Box,
  CircularProgress,
  FormHelperText,
  TextField,
  Typography,
} from "@mui/material";
import {
  DeleteRounded,
  DragIndicator,
  InsertPhotoOutlined,
} from "../../icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../../toast";
import FileInput from "../../media/FileInput";
import { useImagePreviewOverlay } from "../../media/ImagePreviewOverlay";
import LeftVideos from "../../LeftVideos";
import VmsRearrangeButton from "../../VmsRearrangeButton";
import RearrangeModal, { type ArrangementField } from "../../RearrangeModal";
import { useVmsScreenshots } from "../../useVmsScreenshots";
import { useCmsAutoFetch } from "../../useCmsAutoFetch";
import { useBlobPreview } from "../../useBlobPreview";
import { uploadCmsImage } from "../../api";
import { type PlatformFormProps } from "../ajio/ClaimForm";
import PlatformAccountDropdown from "../../PlatformAccountDropdown";
import { tint } from "../../tint";

const SHIPPING_LABEL_MAX_MB = 5;
const PACKING_IMAGE_MAX_MB = 3;
const PACKING_DEFAULT_SLOTS = 3;
const PACKING_MAX = 10;
const PACKING_IMAGE_ACCEPT = "image/jpg,image/png,image/jpeg";

/**
 * Delhivery CMS form. Mirrors the FlipkartForm layout — a two-column
 * shipping-label + evidence-images bundle stored under
 * `otherClaimDetails` so BE persistence can evolve independently.
 */
const DelhiveryForm = (props: PlatformFormProps) => {
  const { formik, feedId, isPartialArticleClaim, skus, side, existingClaim } = props;

  // /cms/update: seed shipping-label + evidence-image previews from the
  // loaded claim's otherClaimDetails bundle. See FlipkartForm hydration
  // comment for the wider rationale.
  const delhiveryHydratedRef = useRef<string | null>(null);

  const blobs = useBlobPreview();
  const [videoPreviews, setVideoPreviews] = useState<{
    returnVideo: string | null;
    forwardVideo: string | null;
  }>({ returnVideo: null, forwardVideo: null });

  // /cms/update: seed return/forward video previews from the loaded claim.
  const videoHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || videoHydratedRef.current === claimId) return;
    videoHydratedRef.current = claimId;
    setVideoPreviews((prev) => ({
      returnVideo: existingClaim?.returnVideoLink || prev.returnVideo,
      forwardVideo: existingClaim?.forwardVideoLink || prev.forwardVideo,
    }));
  }, [existingClaim]);

  const handleVideoPreview = (name: string, file: File | null) => {
    setVideoPreviews((prev) => {
      blobs.release(prev[name as keyof typeof prev]);
      return {
        ...prev,
        [name]: file ? blobs.createObjectURL(file) : null,
      };
    });
  };

  const handleVideoLink = (sideKey: "returnVideo" | "forwardVideo", value: string) => {
    setVideoPreviews((prev) => {
      blobs.release(prev[sideKey]);
      return { ...prev, [sideKey]: value };
    });
  };

  const auto = useCmsAutoFetch({
    formik,
    onReturnVideoLink: (link) =>
      setVideoPreviews((prev) => {
        blobs.release(prev.returnVideo);
        return { ...prev, returnVideo: link };
      }),
    onForwardVideoLink: (link) =>
      setVideoPreviews((prev) => {
        blobs.release(prev.forwardVideo);
        return { ...prev, forwardVideo: link };
      }),
  });

  const [shippingLabelPreview, setShippingLabelPreview] = useState<string | null>(null);
  const [packingPreviews, setPackingPreviews] = useState<(string | null)[]>([]);

  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || delhiveryHydratedRef.current === claimId) return;
    const details = (existingClaim?.otherClaimDetails as any) || null;
    if (!details) return;
    delhiveryHydratedRef.current = claimId;

    const shipping = details.shippingLabelImage;
    if (shipping?.url) {
      setShippingLabelPreview(shipping.url);
      formik.setFieldValue(
        "otherClaimDetails.shippingLabelImage",
        shipping.fileKey || "",
      );
    }

    const packings = Array.isArray(details.packingImages) ? details.packingImages : [];
    if (packings.length > 0) {
      const previewUrls: (string | null)[] = packings.map((p: any) => p?.url || null);
      const fileKeys: string[] = packings
        .map((p: any) => p?.fileKey || "")
        .filter((k: string) => !!k);
      setPackingPreviews(previewUrls);
      formik.setFieldValue("otherClaimDetails.packingImages", fileKeys);
    }

    // Defensive: seed the seller-portal account username. See FlipkartForm's
    // matching effect for why this is done here in addition to the shared
    // applyExistingClaim spread — same race on platform-flag freshness.
    if (typeof details.username === "string" && details.username.trim()) {
      formik.setFieldValue("otherClaimDetails.username", details.username);
    }
  }, [existingClaim, formik]);

  const {
    PreviewButton: PackingPreviewButton,
    PreviewDialog: PackingPreviewDialog,
  } = useImagePreviewOverlay();
  const packingImages: string[] =
    (formik.values.otherClaimDetails?.packingImages as string[]) || [];
  const filledCount = packingImages.filter((k) => !!k).length;
  const visibleSlotCount = useMemo(
    () => Math.min(PACKING_MAX, Math.max(PACKING_DEFAULT_SLOTS, filledCount + 1)),
    [filledCount],
  );

  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [dragSrcIndex, setDragSrcIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleShippingLabelPreview = (_name: string, file: File | null) => {
    setShippingLabelPreview((prev) => {
      blobs.release(prev);
      return file ? blobs.createObjectURL(file) : null;
    });
  };

  const uploadPackingImage = async (file: File, slotIndex: number) => {
    if (file.size > PACKING_IMAGE_MAX_MB * 1024 * 1024) {
      toast.error(`Each image must be less than ${PACKING_IMAGE_MAX_MB}MB`);
      return;
    }
    setUploadingSlot(slotIndex);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("feedId", feedId || "");
    try {
      const response = await uploadCmsImage(formData);
      if (response.status === 200) {
        const key = response.data.data?.key;

        // A 200 with no key is a file the server did not keep. Saying so beats
        // writing `undefined` into a slot that then looks filled.
        if (!key) {
          toast.error("Image upload failed");

          return;
        }
        const updated = [...packingImages];
        updated[slotIndex] = key;
        const compact = updated.filter((v) => !!v);
        formik.setFieldValue("otherClaimDetails.packingImages", compact);
        formik.setFieldTouched("otherClaimDetails.packingImages", true, false);
        setPackingPreviews((prev) => {
          blobs.release(prev[slotIndex]);
          const next = [...prev];
          next[slotIndex] = blobs.createObjectURL(file);
          return next;
        });
      }
    } catch (e) {
      console.warn(e);
      toast.error("Image upload failed");
    } finally {
      setUploadingSlot(null);
    }
  };

  const removePackingImage = (slotIndex: number) => {
    const updated = packingImages.filter((_, i) => i !== slotIndex);
    formik.setFieldValue("otherClaimDetails.packingImages", updated);
    setPackingPreviews((prev) => {
      blobs.release(prev[slotIndex]);
      return prev.filter((_, i) => i !== slotIndex);
    });
    if (inputRefs.current[slotIndex]) {
      inputRefs.current[slotIndex]!.value = "";
    }
  };

  const reorderPackingImage = (from: number, to: number) => {
    if (from === to) return;
    const keys = [...packingImages];
    const previews = [...packingPreviews];
    const filledLen = keys.filter((k) => !!k).length;
    if (from >= filledLen) return;
    const clampedTo = Math.min(to, filledLen - 1);
    const [movedKey] = keys.splice(from, 1);
    const [movedPreview] = previews.splice(from, 1);

    // `from` was bounded above, so both are present — but the splice result is
    // typed as possibly empty, and putting an `undefined` back into the list
    // would be an image slot that renders as a hole.
    if (movedKey === undefined || movedPreview === undefined) return;

    keys.splice(clampedTo, 0, movedKey);
    previews.splice(clampedTo, 0, movedPreview);
    formik.setFieldValue("otherClaimDetails.packingImages", keys);
    setPackingPreviews(previews);
  };

  const onPackingFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    slotIndex: number,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void uploadPackingImage(file, slotIndex);
  };

  const delhiveryTouched = (formik.touched as any)?.otherClaimDetails || {};
  const delhiveryErrors = (formik.errors as any)?.otherClaimDetails || {};
  const shippingError =
    delhiveryTouched.shippingLabelImage &&
    typeof delhiveryErrors.shippingLabelImage === "string"
      ? (delhiveryErrors.shippingLabelImage as string)
      : "";
  const packingError =
    delhiveryTouched.packingImages &&
    typeof delhiveryErrors.packingImages === "string"
      ? (delhiveryErrors.packingImages as string)
      : "";

  const rearrangeSchema = useMemo<ArrangementField[]>(() => {
    const packingCount = Math.max(1, packingImages.length);
    return [
      { fieldName: "shippingLabel", label: "Shipping Label", position: "first" },
      ...Array.from({ length: packingCount }, (_, i) => ({
        fieldName: `packing_${i}`,
        label: `Packing ${i + 1}`,
        position: (i === packingCount - 1 ? "last" : "middle") as "last" | "middle",
      })),
    ];
  }, [packingImages.length]);

  const rearrangeImageFields = useMemo(
    () => rearrangeSchema.map((s) => s.fieldName),
    [rearrangeSchema],
  );

  const rearrangeSlotPreviews = useMemo(() => {
    const map: Record<string, string | null> = {
      shippingLabel: shippingLabelPreview ?? null,
    };
    rearrangeSchema.slice(1).forEach((field, i) => {
      map[field.fieldName] = packingPreviews[i] ?? null;
    });
    return map;
  }, [rearrangeSchema, packingPreviews, shippingLabelPreview]);

  const populateFromVms = (screenshots: string[]) => {
    const capped = screenshots.slice(0, 1 + PACKING_MAX);
    const [shippingUrl, ...packingUrls] = capped;
    if (shippingUrl) {
      formik.setFieldValue(
        "otherClaimDetails.shippingLabelImage",
        shippingUrl.split("/").pop() || "",
      );
      setShippingLabelPreview((prev) => {
        blobs.release(prev);
        return shippingUrl;
      });
    } else {
      formik.setFieldValue("otherClaimDetails.shippingLabelImage", "");
      setShippingLabelPreview((prev) => {
        blobs.release(prev);
        return null;
      });
    }
    const packingKeys = packingUrls.map((u) => u.split("/").pop() || "");
    formik.setFieldValue("otherClaimDetails.packingImages", packingKeys);
    setPackingPreviews((prev) => {
      prev.forEach((u) => blobs.release(u));
      return packingUrls;
    });
  };

  const resetVms = () => {
    formik.setFieldValue("otherClaimDetails.shippingLabelImage", "");
    formik.setFieldValue("otherClaimDetails.packingImages", []);
    setShippingLabelPreview((prev) => {
      blobs.release(prev);
      return null;
    });
    setPackingPreviews((prev) => {
      prev.forEach((u) => blobs.release(u));
      return [];
    });
  };

  const vms = useVmsScreenshots({
    carryOverImages: props.carryOverImages,
    awb: formik.values.AWBNumber,
    // Forward-AWB shots surface only in the Rearrange pool (no slot placement).
    forwardAwb: formik.values.forwardAWB,
    previews: rearrangeSlotPreviews,
    imageFields: rearrangeImageFields,
    populate: populateFromVms,
    reset: resetVms,
  });

  const applyArranged = (arranged: string[]) => {
    const [shippingUrl, ...packingUrls] = arranged;
    if (shippingUrl) {
      formik.setFieldValue(
        "otherClaimDetails.shippingLabelImage",
        shippingUrl.split("/").pop() || "",
      );
      setShippingLabelPreview((prev) => {
        blobs.release(prev);
        return shippingUrl;
      });
    } else {
      formik.setFieldValue("otherClaimDetails.shippingLabelImage", "");
      setShippingLabelPreview((prev) => {
        blobs.release(prev);
        return null;
      });
    }
    const previewsNow = packingPreviews;
    const keysNow = packingImages;
    const newKeys: string[] = [];
    const newPreviews: (string | null)[] = [];
    packingUrls.forEach((url) => {
      if (!url) return;
      const oldIdx = previewsNow.indexOf(url);
      if (oldIdx >= 0) {
        newKeys.push(keysNow[oldIdx] || "");
        newPreviews.push(url);
      } else {
        newKeys.push(url.split("/").pop() || "");
        newPreviews.push(url);
      }
    });
    formik.setFieldValue("otherClaimDetails.packingImages", newKeys);
    setPackingPreviews((prev) => {
      prev.forEach((u) => blobs.release(u));
      return newPreviews;
    });

    const merged = new Set<string>([
      ...vms.fetchedScreenshots,
      ...(shippingLabelPreview ? [shippingLabelPreview] : []),
      ...previewsNow.filter((v): v is string => Boolean(v)),
      ...arranged.filter(Boolean),
    ]);
    vms.setFetchedScreenshots(Array.from(merged));
  };

  if (side === "right") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <VmsRearrangeButton
          show={vms.fetchedScreenshots.length > 0 || vms.forwardOnlyScreenshots.length > 0}
          onClick={() => vms.setRearrangeModalOpen(true)}
        />
        <Box>
          <Typography sx={{ mb: "5px" }}>
            Shipping Label <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <FormHelperText sx={{ mb: "5px" }}>
            (Maximum 1 Image, max size {SHIPPING_LABEL_MAX_MB}MB)
          </FormHelperText>
          <FileInput
            name="otherClaimDetails.shippingLabelImage"
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="150px"
            width="100%"
            preview={shippingLabelPreview}
            onFileChange={handleShippingLabelPreview}
            error={!!shippingError}
          >
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "primary.main" }}>
              <InsertPhotoOutlined fontSize="large" />
              <Typography variant="body2" fontWeight="bold">Upload</Typography>
            </Box>
          </FileInput>
          {shippingError && (
            <FormHelperText error sx={{ ml: 1 }}>{shippingError}</FormHelperText>
          )}
        </Box>

        <Box>
          <Typography sx={{ mb: "5px" }}>
            Evidence of Issue <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <FormHelperText sx={{ mb: "5px" }} error={!!packingError}>
            (Min 1, Max {PACKING_MAX} · {PACKING_IMAGE_MAX_MB}MB each · drag to reorder)
          </FormHelperText>
          <Box sx={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {Array.from({ length: visibleSlotCount }).map((_, slotIndex) => {
              const filled = !!packingImages[slotIndex];
              const preview = packingPreviews[slotIndex];
              const isUploading = uploadingSlot === slotIndex;
              const isDragOver = dragOverIndex === slotIndex;
              return (
                <Box
                  key={slotIndex}
                  draggable={filled}
                  onDragStart={(e) => {
                    if (!filled) return;
                    setDragSrcIndex(slotIndex);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (dragSrcIndex === null) return;
                    e.preventDefault();
                    setDragOverIndex(slotIndex);
                  }}
                  onDragLeave={() => setDragOverIndex(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragSrcIndex !== null) {
                      reorderPackingImage(dragSrcIndex, slotIndex);
                    }
                    setDragSrcIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragSrcIndex(null);
                    setDragOverIndex(null);
                  }}
                  sx={{
                    position: "relative",
                    width: "100%",
                    height: 150,
                    border: (t) =>
                      `1px solid ${
                        isDragOver ? t.palette.primary.main : t.palette.divider
                      }`,
                    borderRadius: "8px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: filled ? "grab" : "default",
                    backgroundColor: isDragOver ? tint('primary.main', 0.08) : "transparent",
                    overflow: "hidden",
                  }}
                >
                  <input
                    ref={(el) => { inputRefs.current[slotIndex] = el }}
                    type="file"
                    accept={PACKING_IMAGE_ACCEPT}
                    style={{ display: "none" }}
                    onChange={(e) => onPackingFileChange(e, slotIndex)}
                  />
                  {isUploading ? (
                    <CircularProgress size={24} color="primary" />
                  ) : filled && preview ? (
                    <>
                      <img
                        src={preview}
                        alt={`packing-${slotIndex + 1}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "8px" }}
                      />
                      <PackingPreviewButton src={preview} />
                      <Box
                        sx={{
                          position: "absolute",
                          top: 4,
                          left: 4,
                          bgcolor: tint('common.black', 0.55),
                          color: "white",
                          px: 0.75,
                          py: 0.25,
                          borderRadius: 0.5,
                          fontSize: "11px",
                          fontWeight: 600,
                        }}
                      >
                        {slotIndex + 1}
                      </Box>
                      <Box
                        sx={{
                          position: "absolute",
                          top: 4,
                          right: 30,
                          bgcolor: tint('common.black', 0.5),
                          borderRadius: 0.5,
                          p: "2px",
                        }}
                      >
                        <DragIndicator sx={{ fontSize: 14, color: "white" }} />
                      </Box>
                      <Box
                        sx={{
                          position: "absolute",
                          top: 1,
                          right: 1,
                          width: 20,
                          height: 20,
                          bgcolor: "error.main",
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          removePackingImage(slotIndex);
                        }}
                      >
                        <DeleteRounded sx={{ color: "white", fontSize: 14 }} />
                      </Box>
                    </>
                  ) : (
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        width: "100%",
                        height: "100%",
                      }}
                      onClick={() => inputRefs.current[slotIndex]?.click()}
                    >
                      <InsertPhotoOutlined fontSize="large" color="primary" />
                      <Typography fontSize="small" fontWeight="bold" color="primary">
                        Upload
                      </Typography>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
          {packingError && (
            <FormHelperText error sx={{ ml: 1, mt: "5px" }}>{packingError}</FormHelperText>
          )}
        </Box>

        <RearrangeModal
          open={vms.rearrangeModalOpen}
          onClose={() => vms.setRearrangeModalOpen(false)}
          onSave={applyArranged}
          images={vms.rearrangeImagePool}
          initialSlotImages={vms.rearrangeInitialSlots}
          schema={rearrangeSchema}
          title="Rearrange Product Screenshots"
        />
        <PackingPreviewDialog />
      </Box>
    );
  }

  return (
    <>
      {isPartialArticleClaim && (
        <Box sx={{ marginBottom: 2 }}>
          <Typography>Cost of Missing Article</Typography>
          <TextField
            name="costOfMissingArticle"
            placeholder="Enter Cost of Missing Article"
            type="number"
            size="small"
            fullWidth
            value={formik.values.costOfMissingArticle}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            error={!!(formik.touched.costOfMissingArticle && formik.errors.costOfMissingArticle)}
            helperText={
              formik.touched.costOfMissingArticle &&
              (formik.errors.costOfMissingArticle as string)
            }
          />
        </Box>
      )}

      {/* Optional Delhivery seller-portal account; no master-data lookup.
          Persisted at otherClaimDetails.username. */}
      <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "6px" }}>
        <Typography>Delhivery Account Username</Typography>
        <PlatformAccountDropdown
          platform="delhivery"
          label=""
          value={(formik.values.otherClaimDetails?.username as string) || ""}
          onChange={(v) => formik.setFieldValue("otherClaimDetails.username", v)}
        />
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "1fr 1fr",
            md: skus.length > 0 ? "repeat(3, 1fr)" : "repeat(2, 1fr)",
          },
          marginBottom: 2,
          gap: "16px",
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Typography>
            Return AWB Number <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <TextField
            name="AWBNumber"
            placeholder="Enter AWB Number"
            size="small"
            fullWidth
            value={formik.values.AWBNumber}
            onChange={(e) => auto.onReturnAwbChange(e.target.value)}
            onBlur={formik.handleBlur}
            error={!!(formik.touched.AWBNumber && formik.errors.AWBNumber)}
            helperText={formik.touched.AWBNumber && (formik.errors.AWBNumber as string)}
          />
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Typography>Forward AWB</Typography>
          <TextField
            name="forwardAWB"
            placeholder="Enter Forward AWB"
            size="small"
            fullWidth
            value={formik.values.forwardAWB}
            onChange={(e) => auto.onForwardAwbChange(e.target.value)}
            onBlur={formik.handleBlur}
          />
        </Box>

        {skus.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <Typography>SKU</Typography>
            <TextField
              name="skuName"
              placeholder="Select SKU"
              size="small"
              fullWidth
              value={formik.values.skuName}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              error={!!(formik.touched.skuName && formik.errors.skuName)}
              helperText={formik.touched.skuName && (formik.errors.skuName as string)}
            />
          </Box>
        )}
      </Box>

      <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "6px" }}>
        <Typography>Remark</Typography>
        <TextField
          fullWidth
          size="small"
          multiline
          rows={2}
          placeholder="Remark"
          name="remark"
          value={formik.values.remark}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
        />
      </Box>

      <LeftVideos
        formik={formik}
        feedId={feedId}
        previews={videoPreviews}
        onPreviewChange={handleVideoPreview}
        onLinkChange={handleVideoLink}
      />
    </>
  );
};

export default DelhiveryForm;
