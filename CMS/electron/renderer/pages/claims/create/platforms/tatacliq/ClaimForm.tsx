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
import {
  TATACLIQ_QC_IMAGE_SLOTS,
  needsVideo,
  qcSelectionFromClaimType,
} from "../../tatacliqQc";
import { tint } from "../../tint";

const TC_QC_IMAGE_MAX_MB = 3;
const TC_QC_IMAGE_ACCEPT = "image/jpg,image/png,image/jpeg";

/**
 * Tata CliQ CMS form. Left column: AWB / Forward AWB / SKU / Remark / videos
 * (no Customer Order Number). All right-side data is nested under
 * `otherClaimDetails` on formik and travels as a JSON bundle to the BE,
 * mirroring the myntra/flipkart pattern with its own dedicated storage.
 *
 * THE RIGHT COLUMN IS THE PORTAL'S OWN QC FAIL FORM, field for field: the
 * reason, the sub-reason Wrong Product alone takes, six NAMED image slots and
 * the two video URLs.
 *
 * It used to be a packaging slip plus three-to-ten generic "evidence" images,
 * and that does not survive contact with the portal: every upload there goes to
 * a NUMBERED slot a reviewer opens expecting a particular thing — the product
 * in the first, the packing slip in the fourth — so an image in the wrong slot
 * is a claim arguing the wrong thing. Fixed, labelled slots are the only shape
 * that can be filed correctly.
 *
 * The slots are drag-to-swap, which is what makes them workable: pictures
 * arrive from VMS in whatever order the warehouse took them, and moving one
 * into the right slot should not mean re-uploading it.
 *
 * `qcImages` (slot key → file key) is what the automation reads.
 * `shippingLabelImage` and `packingImages` are still written alongside it,
 * because the claim viewer and every claim stored before these slots existed
 * read those — see `mirrorLegacyImages`.
 *
 * The two video fields are hidden for the six reasons the portal does not ask
 * footage for. Absent rather than disabled: a greyed-out field still reads as
 * something forgotten.
 */
const TataCliqForm = (props: PlatformFormProps) => {
  const { formik, feedId, isPartialArticleClaim, skus, side, existingClaim } = props;

  // /cms/update: seed the QC bundle from the loaded claim. See FlipkartForm
  // hydration comment for the wider rationale.
  const tcHydratedRef = useRef<string | null>(null);

  // ── Left-side (video previews + AWB auto-fetch) ────────────────────────
  const blobs = useBlobPreview();
  const [tcVideoPreviews, setTcVideoPreviews] = useState<{
    returnVideo: string | null;
    forwardVideo: string | null;
  }>({ returnVideo: null, forwardVideo: null });

  // /cms/update: seed return/forward video previews from the loaded claim.
  const tcVideoHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || tcVideoHydratedRef.current === claimId) return;
    tcVideoHydratedRef.current = claimId;
    setTcVideoPreviews((prev) => ({
      returnVideo: existingClaim?.returnVideoLink || prev.returnVideo,
      forwardVideo: existingClaim?.forwardVideoLink || prev.forwardVideo,
    }));
  }, [existingClaim]);

  const onTcVideoPreview = (name: string, file: File | null) => {
    setTcVideoPreviews((prev) => {
      blobs.release(prev[name as keyof typeof prev]);
      return {
        ...prev,
        [name]: file ? blobs.createObjectURL(file) : null,
      };
    });
  };

  const onTcVideoLink = (sideKey: "returnVideo" | "forwardVideo", value: string) => {
    setTcVideoPreviews((prev) => {
      blobs.release(prev[sideKey]);
      return { ...prev, [sideKey]: value };
    });
  };

  const tcAuto = useCmsAutoFetch({
    formik,
    onReturnVideoLink: (link) =>
      setTcVideoPreviews((prev) => {
        blobs.release(prev.returnVideo);
        return { ...prev, returnVideo: link };
      }),
    onForwardVideoLink: (link) =>
      setTcVideoPreviews((prev) => {
        blobs.release(prev.forwardVideo);
        return { ...prev, forwardVideo: link };
      }),
  });

  // ── Right-side: the portal's six QC slots ──────────────────────────────
  // Keyed by slot, not indexed: the slot IS the meaning, so an array would make
  // "which picture is the packing slip" a matter of position in a list that
  // shifts whenever something is removed.
  const [tcSlotPreviews, setTcSlotPreviews] = useState<Record<string, string | null>>({});
  const [tcUploadingSlot, setTcUploadingSlot] = useState<string | null>(null);
  const [tcDragSrc, setTcDragSrc] = useState<string | null>(null);
  const [tcDragOver, setTcDragOver] = useState<string | null>(null);
  const tcInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const {
    PreviewButton: TcPreviewButton,
    PreviewDialog: TcPreviewDialog,
  } = useImagePreviewOverlay();

  const tcQcImages: Record<string, string> =
    (formik.values.otherClaimDetails?.qcImages as Record<string, string>) || {};
  const tcReason = (formik.values.otherClaimDetails?.qcReason as string) || "";

  /**
   * The portal's codes, kept in step with the claim-type cascade.
   *
   * The cascade on the left IS the reason for a Tata CliQ claim — it is the
   * same two questions in the portal's wording — so it is the only place an
   * operator chooses one. This mirrors its answer into the two fields the
   * automation actually sends.
   *
   * Written only when it CHANGES, and only when it resolves to something. A
   * cascade value with no portal equivalent leaves the codes empty, which the
   * validation then refuses by name — far better than filing under a reason
   * nobody chose, which the marketplace rejects days later.
   */
  const tcParent = (formik.values.otherClaimDetails?.parentSelection as string) || "";
  const tcTypeOfClaim = (formik.values.typeOfClaim as string) || "";
  const { setFieldValue } = formik;

  const tcDerived = useMemo(
    () => qcSelectionFromClaimType(tcParent, tcTypeOfClaim),
    [tcParent, tcTypeOfClaim],
  );

  /**
   * The reason this component last mirrored, so a sub-reason is cleared when
   * the REASON moves on and at no other time.
   *
   * Without it, a sub-reason the operator picked by hand below was wiped on the
   * next render: the cascade cannot derive one, so the derived value is empty,
   * and "write the derived value" means "write empty over their answer".
   */
  const tcLastReason = useRef<string | null>(null);

  useEffect(() => {
    const currentReason = (formik.values.otherClaimDetails?.qcReason as string) || "";
    const currentSubReason = (formik.values.otherClaimDetails?.qcSubReason as string) || "";

    if (tcDerived.reason !== currentReason) {
      setFieldValue("otherClaimDetails.qcReason", tcDerived.reason);
    }

    // Null on the first pass — a claim loaded by /cms/update arrives with its
    // sub-reason already set, and that is not a change.
    const reasonChanged =
      tcLastReason.current !== null && tcLastReason.current !== tcDerived.reason;

    tcLastReason.current = tcDerived.reason;

    if (tcDerived.subReason) {
      if (tcDerived.subReason !== currentSubReason) {
        setFieldValue("otherClaimDetails.qcSubReason", tcDerived.subReason);
      }
    } else if (reasonChanged && currentSubReason) {
      // Cleared with the reason, exactly as the portal's own page does: a
      // sub-reason inherited from the previous reason is one it never sends.
      setFieldValue("otherClaimDetails.qcSubReason", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tcDerived, setFieldValue]);

  /**
   * Keeps `shippingLabelImage` and `packingImages` in step with the slots.
   *
   * The claim viewer and every claim stored before these slots existed read
   * those two fields, so they are still written — the packing slip into the one
   * that has always meant exactly that, and the rest in slot order. Derived
   * from `qcImages` on every change rather than maintained in parallel, so
   * there is one place the truth lives and no way for the two to disagree.
   */
  const mirrorLegacyImages = (images: Record<string, string>) => {
    formik.setFieldValue("otherClaimDetails.shippingLabelImage", images.packingSlip || "");
    formik.setFieldValue(
      "otherClaimDetails.packingImages",
      TATACLIQ_QC_IMAGE_SLOTS.filter((slot) => slot.key !== "packingSlip")
        .map((slot) => images[slot.key])
        .filter((key): key is string => Boolean(key)),
    );
  };

  const setQcImages = (images: Record<string, string>) => {
    formik.setFieldValue("otherClaimDetails.qcImages", images);
    formik.setFieldTouched("otherClaimDetails.qcImages", true, false);
    mirrorLegacyImages(images);
  };

  // /cms/update: rebuild the slots from the stored bundle.
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || tcHydratedRef.current === claimId) return;
    const details = (existingClaim?.otherClaimDetails as any) || null;
    if (!details) return;
    tcHydratedRef.current = claimId;

    const stored = (details.qcImages || {}) as Record<
      string,
      { url?: string; fileKey?: string } | string
    >;
    const keys: Record<string, string> = {};
    const previews: Record<string, string | null> = {};

    for (const slot of TATACLIQ_QC_IMAGE_SLOTS) {
      const entry = stored[slot.key];
      if (!entry) continue;
      // The BE hands these back as { url, fileKey }; a claim written by an
      // older build may hold the bare key.
      if (typeof entry === "string") {
        keys[slot.key] = entry;
        continue;
      }
      if (entry.fileKey) keys[slot.key] = entry.fileKey;
      if (entry.url) previews[slot.key] = entry.url;
    }

    if (Object.keys(keys).length > 0) {
      formik.setFieldValue("otherClaimDetails.qcImages", keys);
    }
    if (Object.keys(previews).length > 0) setTcSlotPreviews(previews);

    if (typeof details.qcReason === "string" && details.qcReason) {
      formik.setFieldValue("otherClaimDetails.qcReason", details.qcReason);
    }
    if (typeof details.qcSubReason === "string" && details.qcSubReason) {
      formik.setFieldValue("otherClaimDetails.qcSubReason", details.qcSubReason);
    }
    if (typeof details.packagingVideoUrl === "string") {
      formik.setFieldValue("otherClaimDetails.packagingVideoUrl", details.packagingVideoUrl);
    }
    if (typeof details.unboxingVideoUrl === "string") {
      formik.setFieldValue("otherClaimDetails.unboxingVideoUrl", details.unboxingVideoUrl);
    }

    // Defensive: seed the seller-portal account username. See FlipkartForm's
    // matching effect for why this is done here in addition to the shared
    // applyExistingClaim spread — same race on platform-flag freshness.
    if (typeof details.username === "string" && details.username.trim()) {
      formik.setFieldValue("otherClaimDetails.username", details.username);
    }
  }, [existingClaim, formik]);

  const uploadTcSlot = async (file: File, slotKey: string) => {
    if (file.size > TC_QC_IMAGE_MAX_MB * 1024 * 1024) {
      toast.error(`Each image must be less than ${TC_QC_IMAGE_MAX_MB}MB`);
      return;
    }
    setTcUploadingSlot(slotKey);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("feedId", feedId || "");
    try {
      const response = await uploadCmsImage(fd);
      if (response.status === 200) {
        const key = response.data.data?.key;

        // A 200 with no key is a file the server did not keep. Saying so beats
        // writing `undefined` into a slot that then looks filled.
        if (!key) {
          toast.error("Image upload failed");

          return;
        }
        setQcImages({ ...tcQcImages, [slotKey]: key });
        setTcSlotPreviews((prev) => {
          blobs.release(prev[slotKey] ?? null);
          return { ...prev, [slotKey]: blobs.createObjectURL(file) };
        });
      }
    } catch (e) {
      console.warn(e);
      toast.error("Image upload failed");
    } finally {
      setTcUploadingSlot(null);
    }
  };

  const removeTcSlot = (slotKey: string) => {
    const next = { ...tcQcImages };
    delete next[slotKey];
    setQcImages(next);
    setTcSlotPreviews((prev) => {
      blobs.release(prev[slotKey] ?? null);
      const updated = { ...prev };
      delete updated[slotKey];
      return updated;
    });
    const input = tcInputRefs.current[slotKey];
    if (input) input.value = "";
  };

  /**
   * Drag one slot onto another: the two SWAP.
   *
   * Not an insert-and-shift, which is what a list wants: these are six fixed
   * positions with fixed meanings, so moving the product photo into slot 1 must
   * put whatever was there into the slot it came from — not push everything
   * down and leave the packing slip somewhere it does not belong.
   */
  const swapTcSlots = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const next = { ...tcQcImages };
    const movedFrom = next[fromKey];
    const movedTo = next[toKey];

    if (movedTo) next[fromKey] = movedTo;
    else delete next[fromKey];
    if (movedFrom) next[toKey] = movedFrom;
    else delete next[toKey];

    setQcImages(next);
    setTcSlotPreviews((prev) => ({
      ...prev,
      [fromKey]: prev[toKey] ?? null,
      [toKey]: prev[fromKey] ?? null,
    }));
  };

  const onTcSlotFileChange = (e: React.ChangeEvent<HTMLInputElement>, slotKey: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void uploadTcSlot(file, slotKey);
  };

  const tcTouched = (formik.touched as any)?.otherClaimDetails || {};
  const tcErrors = (formik.errors as any)?.otherClaimDetails || {};
  const errorFor = (field: string): string =>
    tcTouched[field] && typeof tcErrors[field] === "string" ? (tcErrors[field] as string) : "";
  const tcImagesError = errorFor("qcImages");
  const tcReasonError = errorFor("qcReason");

  // ── VMS screenshot cascade (mirrors MyntraForm / FlipkartForm) ─────────
  // One rearrange field per slot, under the portal's own labels, so the
  // rearrange dialog and the form name the same things.
  const tcRearrangeSchema = useMemo<ArrangementField[]>(
    () =>
      TATACLIQ_QC_IMAGE_SLOTS.map((slot, index) => ({
        fieldName: slot.key,
        label: slot.label,
        position: (index === 0
          ? "first"
          : index === TATACLIQ_QC_IMAGE_SLOTS.length - 1
            ? "last"
            : "middle") as "first" | "middle" | "last",
      })),
    [],
  );

  const tcRearrangeFields = useMemo(
    () => tcRearrangeSchema.map((entry) => entry.fieldName),
    [tcRearrangeSchema],
  );

  const tcRearrangeSlotPreviews = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const slot of TATACLIQ_QC_IMAGE_SLOTS) map[slot.key] = tcSlotPreviews[slot.key] ?? null;
    return map;
  }, [tcSlotPreviews]);

  /** VMS screenshots land in slot order — the operator then drags them right. */
  const populateTcFromVms = (screenshots: string[]) => {
    const keys: Record<string, string> = {};
    const previews: Record<string, string | null> = {};

    TATACLIQ_QC_IMAGE_SLOTS.forEach((slot, index) => {
      const url = screenshots[index];
      if (!url) return;
      keys[slot.key] = url.split("/").pop() || "";
      previews[slot.key] = url;
    });

    setQcImages(keys);
    setTcSlotPreviews((prev) => {
      Object.values(prev).forEach((url) => blobs.release(url));
      return previews;
    });
  };

  const resetTcVms = () => {
    setQcImages({});
    setTcSlotPreviews((prev) => {
      Object.values(prev).forEach((url) => blobs.release(url));
      return {};
    });
  };

  const tcVms = useVmsScreenshots({
    carryOverImages: props.carryOverImages,
    awb: formik.values.AWBNumber,
    // Forward-AWB shots surface only in the Rearrange pool (no slot placement).
    forwardAwb: formik.values.forwardAWB,
    previews: tcRearrangeSlotPreviews,
    imageFields: tcRearrangeFields,
    populate: populateTcFromVms,
    reset: resetTcVms,
  });

  const applyTcArranged = (arranged: string[]) => {
    const previousPreviews = tcSlotPreviews;
    const previousKeys = tcQcImages;
    const keys: Record<string, string> = {};
    const previews: Record<string, string | null> = {};

    TATACLIQ_QC_IMAGE_SLOTS.forEach((slot, index) => {
      const url = arranged[index];
      if (!url) return;
      // A picture already in a slot keeps its uploaded key; only something new
      // to the form needs one derived from the URL.
      const previousSlot = Object.keys(previousPreviews).find(
        (key) => previousPreviews[key] === url,
      );
      keys[slot.key] = previousSlot ? previousKeys[previousSlot] || "" : url.split("/").pop() || "";
      previews[slot.key] = url;
    });

    setQcImages(keys);
    setTcSlotPreviews(previews);

    const merged = new Set<string>([
      ...tcVms.fetchedScreenshots,
      ...Object.values(previousPreviews).filter((value): value is string => Boolean(value)),
      ...arranged.filter(Boolean),
    ]);
    tcVms.setFetchedScreenshots(Array.from(merged));
  };

  // ── RIGHT column ───────────────────────────────────────────────────────
  if (side === "right") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <VmsRearrangeButton
          show={tcVms.fetchedScreenshots.length > 0 || tcVms.forwardOnlyScreenshots.length > 0}
          onClick={() => tcVms.setRearrangeModalOpen(true)}
        />

        {/* THE PORTAL'S TWO DROPDOWNS USED TO BE HERE.

            They asked the same question the cascade on the left already asks —
            "Reason Of QC Failure" / "Sub Reason Of Failure" — so the form put
            it twice and only this copy was ever sent to the marketplace. An
            operator who filled in the obvious one and missed this one produced
            a claim no runner would file.

            The codes are now derived from the cascade by
            `qcSelectionFromClaimType`, which accepts either the portal's code
            or its label, so the left pair is the only place a reason is chosen.
            When it cannot resolve one, the warning below says so rather than
            letting the claim reach the marketplace under the wrong reason. */}
        {tcReasonError && (
          <FormHelperText error sx={{ mx: 0 }}>
            {tcReasonError}
          </FormHelperText>
        )}

        {/* NOTHING ABOUT THE REASON IS ASKED OR REPORTED HERE. Both halves of
            the question live in the cascade on the left, and a second copy of
            either the control or its error only made the form look like it was
            asking twice. The core refuses an unfilable pair before it reaches
            the marketplace, which is where that check belongs. */}
        {/* The six numbered slots. */}
        <Box>
          <Typography sx={{ mb: "5px" }}>
            QC Images <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <FormHelperText sx={{ mb: "5px" }} error={!!tcImagesError}>
            (The four starred slots are required · {TC_QC_IMAGE_MAX_MB}MB each · drag one slot onto
            another to swap them)
          </FormHelperText>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: "0.75rem",
            }}
          >
            {TATACLIQ_QC_IMAGE_SLOTS.map((slot) => {
              const filled = !!tcQcImages[slot.key];
              const preview = tcSlotPreviews[slot.key];
              const isUploading = tcUploadingSlot === slot.key;
              const isDragOver = tcDragOver === slot.key;

              return (
                <Box key={slot.key}>
                  <Typography sx={{ fontSize: "12px", mb: "3px" }}>
                    {slot.slot}. {slot.label}
                    {slot.required && <span style={{ color: "var(--mui-palette-error-main)" }}> *</span>}
                  </Typography>
                  <Box
                    draggable={filled}
                    onDragStart={(e) => {
                      if (!filled) return;
                      setTcDragSrc(slot.key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (tcDragSrc === null) return;
                      e.preventDefault();
                      setTcDragOver(slot.key);
                    }}
                    onDragLeave={() => setTcDragOver(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (tcDragSrc !== null) swapTcSlots(tcDragSrc, slot.key);
                      setTcDragSrc(null);
                      setTcDragOver(null);
                    }}
                    onDragEnd={() => {
                      setTcDragSrc(null);
                      setTcDragOver(null);
                    }}
                    sx={{
                      position: "relative",
                      width: "100%",
                      height: 140,
                      border: (t) =>
                        `1px solid ${
                          isDragOver
                            ? t.palette.primary.main
                            : slot.required && !filled && tcImagesError
                              ? t.palette.error.main
                              : t.palette.divider
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
                      ref={(el) => {
                        tcInputRefs.current[slot.key] = el;
                      }}
                      type="file"
                      accept={TC_QC_IMAGE_ACCEPT}
                      style={{ display: "none" }}
                      onChange={(e) => onTcSlotFileChange(e, slot.key)}
                    />
                    {isUploading ? (
                      <CircularProgress size={24} color="primary" />
                    ) : filled && preview ? (
                      <>
                        <img
                          src={preview}
                          alt={slot.label}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            borderRadius: "8px",
                          }}
                        />
                        <TcPreviewButton src={preview} />
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
                          {slot.slot}
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
                            removeTcSlot(slot.key);
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
                        onClick={() => tcInputRefs.current[slot.key]?.click()}
                      >
                        <InsertPhotoOutlined fontSize="large" color="primary" />
                        <Typography fontSize="small" fontWeight="bold" color="primary">
                          Browse
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
          {tcImagesError && (
            <FormHelperText error sx={{ ml: 1, mt: "5px" }}>
              {tcImagesError}
            </FormHelperText>
          )}
        </Box>

        {/* URLs, not uploads: the portal fetches these itself, which is why a
            TrackVid S3 link is all it needs. Absent for the six reasons it does
            not ask footage for. */}
        {needsVideo(tcReason) && (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: "16px",
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <Typography>Add Packaging Video URL</Typography>
              <TextField
                name="otherClaimDetails.packagingVideoUrl"
                placeholder="Enter URL"
                size="small"
                fullWidth
                value={(formik.values.otherClaimDetails?.packagingVideoUrl as string) || ""}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                error={!!errorFor("packagingVideoUrl")}
                helperText={errorFor("packagingVideoUrl")}
              />
            </Box>
            <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <Typography>Add Unboxing Video URL</Typography>
              <TextField
                name="otherClaimDetails.unboxingVideoUrl"
                placeholder="Enter URL"
                size="small"
                fullWidth
                value={(formik.values.otherClaimDetails?.unboxingVideoUrl as string) || ""}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                error={!!errorFor("unboxingVideoUrl")}
                helperText={errorFor("unboxingVideoUrl")}
              />
            </Box>
          </Box>
        )}

        <RearrangeModal
          open={tcVms.rearrangeModalOpen}
          onClose={() => tcVms.setRearrangeModalOpen(false)}
          onSave={applyTcArranged}
          images={tcVms.rearrangeImagePool}
          initialSlotImages={tcVms.rearrangeInitialSlots}
          schema={tcRearrangeSchema}
          title="Rearrange QC Images"
        />
        <TcPreviewDialog />
      </Box>
    );
  }

  // ── LEFT column ────────────────────────────────────────────────────────
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

      {/* Optional Tata CliQ seller-portal account; no master-data lookup.
          Persisted at otherClaimDetails.username. */}
      <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "6px" }}>
        <Typography>Tata CliQ Account Username</Typography>
        <PlatformAccountDropdown
          platform="tataCliq"
          label=""
          value={(formik.values.otherClaimDetails?.username as string) || ""}
          onChange={(v) => formik.setFieldValue("otherClaimDetails.username", v)}
        />
      </Box>

      {/* AWB + Forward AWB + SKU (Tata CliQ has no Customer Order Number). */}
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
            onChange={(e) => tcAuto.onReturnAwbChange(e.target.value)}
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
            onChange={(e) => tcAuto.onForwardAwbChange(e.target.value)}
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

      {/* Remark */}
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
        previews={tcVideoPreviews}
        onPreviewChange={onTcVideoPreview}
        onLinkChange={onTcVideoLink}
      />
    </>
  );
};

export default TataCliqForm;
