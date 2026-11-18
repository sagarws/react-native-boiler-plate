import {
  Box,
  CircularProgress,
  FormHelperText,
  TextField,
  Typography,
} from "@mui/material";
import { DeleteRounded, InsertPhotoOutlined } from "../../icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../../toast";
import { useImagePreviewOverlay } from "../../media/ImagePreviewOverlay";
import LeftVideos from "../../LeftVideos";
import VmsRearrangeButton from "../../VmsRearrangeButton";
import RearrangeModal, { type ArrangementField } from "../../RearrangeModal";
import { useVmsScreenshots } from "../../useVmsScreenshots";
import { useCmsAutoFetch } from "../../useCmsAutoFetch";
import { useBlobPreview } from "../../useBlobPreview";
import { uploadCmsImage } from "../../api";
import { type PackingSide, type XbeesPackingImage } from "@shared/types/cmsCreate";
import { type PlatformFormProps } from "../ajio/ClaimForm";
import PlatformAccountDropdown from "../../PlatformAccountDropdown";

const EVIDENCE_IMAGE_MAX_MB = 3;
const EVIDENCE_IMAGE_ACCEPT = "image/jpg,image/png,image/jpeg";

// Xbees renders four positional evidence slots (unlike the drag-reorder grid
// used by Flipkart / Tata CliQ / Delhivery). Each slot's `side` travels with
// the S3 fileKey in the payload, so downstream consumers don't have to rely on
// array index to know which face of the box a photo represents.
const EVIDENCE_SLOTS: { label: string; index: number; side: PackingSide }[] = [
  { label: "Top", index: 0, side: "top" },
  { label: "Right", index: 1, side: "right" },
  { label: "Bottom", index: 2, side: "bottom" },
  { label: "Left", index: 3, side: "left" },
];

const emptyPackingSlots = (): XbeesPackingImage[] =>
  EVIDENCE_SLOTS.map((s) => ({ fileKey: "", side: s.side }));

/**
 * Xbees CMS form. Left column mirrors FlipkartForm but adds a Dispute Amount
 * field. Right column asks for a shipping label + four fixed evidence photos
 * (Top / Right / Bottom / Left). Everything persists under
 * `otherClaimDetails.*` (shared bundle).
 */
const XbeesForm = (props: PlatformFormProps) => {
  const { formik, feedId, isPartialArticleClaim, skus, side, existingClaim } = props;

  // /cms/update: seed the 4 evidence-image previews from the loaded claim's
  // otherClaimDetails.packingImages. Each persisted image comes tagged with
  // its side (top/right/bottom/left) and now carries a resolved `.url` from
  // findCmsByAwb; we place it in evidencePreviews at the correct positional
  // index (0=top, 1=right, 2=bottom, 3=left) and write the fileKey back into
  // the tagged formik array so an Update submit re-sends the S3 keys
  // unchanged. Also seeds disputeAmount when present. Guarded by claim-id
  // ref so re-renders don't clobber operator edits.
  const xbeesHydratedRef = useRef<string | null>(null);

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

  // Fixed-length 4-slot preview state — kept parallel to
  // otherClaimDetails.packingImages so positional identity survives reset.
  const [evidencePreviews, setEvidencePreviews] = useState<(string | null)[]>([
    null,
    null,
    null,
    null,
  ]);

  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || xbeesHydratedRef.current === claimId) return;
    const details = (existingClaim?.otherClaimDetails as any) || null;
    if (!details) return;
    xbeesHydratedRef.current = claimId;

    const packings = Array.isArray(details.packingImages) ? details.packingImages : [];
    if (packings.length > 0) {
      const previews: (string | null)[] = [null, null, null, null];
      const tagged: XbeesPackingImage[] = EVIDENCE_SLOTS.map((s) => ({
        fileKey: "",
        side: s.side,
      }));
      packings.forEach((p: any, i: number) => {
        // Prefer explicit `side` tag; fall back to positional index for older
        // records that stored bare fileKey strings in top/right/bottom/left
        // order.
        const sideTag =
          typeof p?.side === "string" ? p.side : EVIDENCE_SLOTS[i]?.side;
        const slotIndex = EVIDENCE_SLOTS.findIndex((s) => s.side === sideTag);
        const slot = EVIDENCE_SLOTS[slotIndex];

        if (!slot) return;

        previews[slotIndex] = p?.url || null;
        tagged[slotIndex] = { fileKey: p?.fileKey || "", side: slot.side };
      });
      setEvidencePreviews(previews);
      formik.setFieldValue("otherClaimDetails.packingImages", tagged);
    }

    if (details.disputeAmount !== undefined && details.disputeAmount !== null) {
      formik.setFieldValue(
        "otherClaimDetails.disputeAmount",
        String(details.disputeAmount),
      );
    }

    // Defensive: seed the seller-portal account username. See FlipkartForm's
    // matching effect for why this is done here in addition to the shared
    // applyExistingClaim spread — same race on platform-flag freshness.
    if (typeof details.username === "string" && details.username.trim()) {
      formik.setFieldValue("otherClaimDetails.username", details.username);
    }
  }, [existingClaim, formik]);
  const {
    PreviewButton: EvidencePreviewButton,
    PreviewDialog: EvidencePreviewDialog,
  } = useImagePreviewOverlay();

  const rawPackingImages =
    formik.values.otherClaimDetails?.packingImages;
  // Normalize to the tagged 4-slot shape. If a legacy string[] slips in
  // (e.g. reset defaults or stale persisted values), lift it into
  // XbeesPackingImage[] using positional order — the same mapping we've always
  // relied on for Xbees, now made explicit.
  const packingImages: XbeesPackingImage[] = Array.isArray(rawPackingImages)
    ? rawPackingImages.length === EVIDENCE_SLOTS.length &&
      typeof rawPackingImages[0] !== "string"
      ? (rawPackingImages as XbeesPackingImage[])
      : EVIDENCE_SLOTS.map((s, i) => ({
          fileKey:
            typeof rawPackingImages[i] === "string"
              ? (rawPackingImages[i] as string)
              : (rawPackingImages[i] as XbeesPackingImage | undefined)?.fileKey ??
                "",
          side: s.side,
        }))
    : emptyPackingSlots();

  // Seed formik once so validation sees the initialized 4-slot shape even
  // before the user touches any upload input.
  //
  // MIGRATION GUARD: legacy Xbees CMS rows persisted `packingImages` as a bare
  // `string[]` of 4 S3 keys (positional: [top, right, bottom, left]). The
  // previous seed effect rejected those via `typeof current[0] !== "string"`,
  // which treated them as unseeded and overwrote formik with
  // `emptyPackingSlots()` — the operator would then save an edit and the four
  // S3 keys would be lost from the DB. Instead, walk every slot and preserve
  // whatever `fileKey` we can recover (bare-string legacy OR partial-tagged
  // shape), stamping the positional `side` tag alongside. Empty slots stay
  // `{ fileKey: "", side }`. The early return keeps this a no-op once formik
  // is already in the tagged shape.
  useEffect(() => {
    const current = formik.values.otherClaimDetails?.packingImages;
    const isTaggedShape =
      Array.isArray(current) &&
      current.length === EVIDENCE_SLOTS.length &&
      current.every(
        (c: any) => c && typeof c === "object" && typeof c.side === "string",
      );
    if (isTaggedShape) return;
    const migrated: XbeesPackingImage[] = EVIDENCE_SLOTS.map((s, i) => {
      const entry = Array.isArray(current) ? current[i] : undefined;
      const fileKey =
        typeof entry === "string"
          ? entry
          : (entry as XbeesPackingImage | undefined)?.fileKey ?? "";
      return { fileKey, side: s.side };
    });
    formik.setFieldValue("otherClaimDetails.packingImages", migrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const uploadEvidenceImage = async (file: File, slotIndex: number) => {
    if (file.size > EVIDENCE_IMAGE_MAX_MB * 1024 * 1024) {
      toast.error(`Each image must be less than ${EVIDENCE_IMAGE_MAX_MB}MB`);
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
        const updated =
          packingImages.length === EVIDENCE_SLOTS.length
            ? [...packingImages]
            : emptyPackingSlots();
        const uploadSlot = EVIDENCE_SLOTS[slotIndex];

        // The slot names which face of the box this photograph shows, and
        // Xbees files the claim on those labels. Better to drop a photograph
        // than to attach it to the wrong face.
        if (!uploadSlot) return;

        updated[slotIndex] = { fileKey: key, side: uploadSlot.side };
        formik.setFieldValue("otherClaimDetails.packingImages", updated);
        formik.setFieldTouched("otherClaimDetails.packingImages", true, false);
        setEvidencePreviews((prev) => {
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

  const removeEvidenceImage = (slotIndex: number) => {
    const updated =
      packingImages.length === EVIDENCE_SLOTS.length
        ? [...packingImages]
        : emptyPackingSlots();
    const clearedSlot = EVIDENCE_SLOTS[slotIndex];

    if (!clearedSlot) return;

    updated[slotIndex] = { fileKey: "", side: clearedSlot.side };
    formik.setFieldValue("otherClaimDetails.packingImages", updated);
    setEvidencePreviews((prev) => {
      blobs.release(prev[slotIndex]);
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
    if (inputRefs.current[slotIndex]) {
      inputRefs.current[slotIndex]!.value = "";
    }
  };

  const onEvidenceFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    slotIndex: number,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void uploadEvidenceImage(file, slotIndex);
  };

  const xbeesTouched = (formik.touched as any)?.otherClaimDetails || {};
  const xbeesErrors = (formik.errors as any)?.otherClaimDetails || {};
  const evidenceError =
    xbeesTouched.packingImages &&
    typeof xbeesErrors.packingImages === "string"
      ? (xbeesErrors.packingImages as string)
      : "";
  const disputeAmountError =
    xbeesTouched.disputeAmount &&
    typeof xbeesErrors.disputeAmount === "string"
      ? (xbeesErrors.disputeAmount as string)
      : "";

  // VMS screenshot cascade — 4 positional package-photo slots only. Xbees
  // does not collect a shipping label so the shipping slot is intentionally
  // absent from the arrangement.
  const rearrangeSchema = useMemo<ArrangementField[]>(
    () => [
      { fieldName: "evidence_top", label: "Top", position: "first" },
      { fieldName: "evidence_right", label: "Right", position: "middle" },
      { fieldName: "evidence_bottom", label: "Bottom", position: "middle" },
      { fieldName: "evidence_left", label: "Left", position: "last" },
    ],
    [],
  );

  const rearrangeImageFields = useMemo(
    () => rearrangeSchema.map((s) => s.fieldName),
    [rearrangeSchema],
  );

  const rearrangeSlotPreviews = useMemo(() => {
    return {
      evidence_top: evidencePreviews[0] ?? null,
      evidence_right: evidencePreviews[1] ?? null,
      evidence_bottom: evidencePreviews[2] ?? null,
      evidence_left: evidencePreviews[3] ?? null,
    } as Record<string, string | null>;
  }, [evidencePreviews]);

  const populateFromVms = (screenshots: string[]) => {
    const evidenceUrls = screenshots.slice(0, EVIDENCE_SLOTS.length);
    const nextSlots = emptyPackingSlots();
    const nextPreviews: (string | null)[] = [null, null, null, null];
    evidenceUrls.forEach((url, i) => {
      const slot = EVIDENCE_SLOTS[i];

      if (slot) {
        nextSlots[i] = {
          fileKey: url ? url.split("/").pop() || "" : "",
          side: slot.side,
        };
        nextPreviews[i] = url || null;
      }
    });
    formik.setFieldValue("otherClaimDetails.packingImages", nextSlots);
    setEvidencePreviews((prev) => {
      prev.forEach((u) => blobs.release(u));
      return nextPreviews;
    });
  };

  const resetVms = () => {
    formik.setFieldValue(
      "otherClaimDetails.packingImages",
      emptyPackingSlots(),
    );
    setEvidencePreviews((prev) => {
      prev.forEach((u) => blobs.release(u));
      return [null, null, null, null];
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
    const nextSlots = emptyPackingSlots();
    const nextPreviews: (string | null)[] = [null, null, null, null];
    arranged.forEach((url, i) => {
      const slot = EVIDENCE_SLOTS[i];

      if (slot && url) {
        // Preserve existing S3 key if the preview URL matches the current slot.
        const existingKey =
          evidencePreviews[i] === url ? packingImages[i]?.fileKey || "" : "";
        nextSlots[i] = {
          fileKey: existingKey || url.split("/").pop() || "",
          side: slot.side,
        };
        nextPreviews[i] = url;
      }
    });
    formik.setFieldValue("otherClaimDetails.packingImages", nextSlots);
    setEvidencePreviews((prev) => {
      prev.forEach((u) => blobs.release(u));
      return nextPreviews;
    });

    const merged = new Set<string>([
      ...vms.fetchedScreenshots,
      ...evidencePreviews.filter((v): v is string => Boolean(v)),
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
            Upload package photos <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <FormHelperText sx={{ mb: "5px" }} error={!!evidenceError}>
            (Upload one photo per side · {EVIDENCE_IMAGE_MAX_MB}MB each)
          </FormHelperText>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: "0.75rem",
            }}
          >
            {EVIDENCE_SLOTS.map(({ label, index }) => {
              const filled = !!packingImages[index]?.fileKey;
              const preview = evidencePreviews[index];
              const isUploading = uploadingSlot === index;
              return (
                <Box key={label} sx={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {label}
                  </Typography>
                  <Box
                    sx={{
                      position: "relative",
                      width: "100%",
                      height: 150,
                      border: (t) =>
                        `1px solid ${t.palette.divider}`,
                      borderRadius: "8px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    <input
                      ref={(el) => { inputRefs.current[index] = el }}
                      type="file"
                      accept={EVIDENCE_IMAGE_ACCEPT}
                      style={{ display: "none" }}
                      onChange={(e) => onEvidenceFileChange(e, index)}
                    />
                    {isUploading ? (
                      <CircularProgress size={24} color="primary" />
                    ) : filled && preview ? (
                      <>
                        <img
                          src={preview}
                          alt={label}
                          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "8px" }}
                        />
                        <EvidencePreviewButton src={preview} />
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
                            removeEvidenceImage(index);
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
                        onClick={() => inputRefs.current[index]?.click()}
                      >
                        <InsertPhotoOutlined fontSize="large" color="primary" />
                        <Typography fontSize="small" fontWeight="bold" color="primary">
                          Upload
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
          {evidenceError && (
            <FormHelperText error sx={{ ml: 1, mt: "5px" }}>{evidenceError}</FormHelperText>
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
        <EvidencePreviewDialog />
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

      {/* Dispute Amount — Xbees requires a positive numeric amount alongside
          the selected claim. Persisted at otherClaimDetails.disputeAmount. */}
      <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "6px" }}>
        <Typography>
          Dispute Amount <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
        </Typography>
        <TextField
          name="otherClaimDetails.disputeAmount"
          placeholder="Enter Dispute Amount"
          type="number"
          size="small"
          fullWidth
          value={formik.values.otherClaimDetails?.disputeAmount || ""}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
          error={!!disputeAmountError}
          helperText={disputeAmountError || undefined}
        />
      </Box>

      {/* Optional Xbees seller-portal account; no master-data lookup.
          Persisted at otherClaimDetails.username. */}
      <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "6px" }}>
        <Typography>Xbees Account Username</Typography>
        <PlatformAccountDropdown
          platform="xbees"
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

export default XbeesForm;
