import {
  Box,
  CircularProgress,
  FormHelperText,
  TextField,
  Typography,
} from "@mui/material";
import {
  DeleteRounded,
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

const CONTENTS_MAX_FILES = 2;
const CONTENTS_IMAGE_MAX_MB = 5;
const CONTENTS_IMAGE_ACCEPT = "image/jpg,image/png,image/jpeg";

/**
 * Amazon CMS form. Left column mirrors AjioForm. Right column is Amazon-only:
 *  1. Photograph of the contents of the return (1..2 images, required)
 *  2. Photograph of the returned package with the shipping label affixed (1)
 *  3. Serial number of the item (0..1, optional)
 *
 * All three fields land under `otherClaimDetails.*` in formik and travel to
 * the BE as one JSON bundle, matching the myntra / flipkart pattern.
 */
const AmazonForm = (props: PlatformFormProps) => {
  const { formik, feedId, isPartialArticleClaim, skus, side, existingClaim } = props;

  // /cms/update: seed contents-of-return + shipping-label + serial-number
  // previews from the loaded claim's otherClaimDetails bundle. See
  // FlipkartForm hydration comment for the wider rationale.
  const amazonHydratedRef = useRef<string | null>(null);

  // ── Left-side (video previews + AWB auto-fetch) ────────────────────────
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

  // ── Right-side previews ────────────────────────────────────────────────
  const [contentsPreviews, setContentsPreviews] = useState<(string | null)[]>([]);
  const [shippingLabelPreview, setShippingLabelPreview] = useState<string | null>(null);
  const [serialNumberPreview, setSerialNumberPreview] = useState<string | null>(null);

  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || amazonHydratedRef.current === claimId) return;
    const details = (existingClaim?.otherClaimDetails as any) || null;
    if (!details) return;
    amazonHydratedRef.current = claimId;

    const contents = Array.isArray(details.contentsOfReturnImages)
      ? details.contentsOfReturnImages
      : [];
    if (contents.length > 0) {
      const previewUrls: (string | null)[] = contents.map((p: any) => p?.url || null);
      const fileKeys: string[] = contents
        .map((p: any) => p?.fileKey || "")
        .filter((k: string) => !!k);
      setContentsPreviews(previewUrls);
      formik.setFieldValue("otherClaimDetails.contentsOfReturnImages", fileKeys);
    }

    const shipping = details.shippingLabelImage;
    if (shipping?.url) {
      setShippingLabelPreview(shipping.url);
      formik.setFieldValue(
        "otherClaimDetails.shippingLabelImage",
        shipping.fileKey || "",
      );
    }

    const serial = details.serialNumberImage;
    if (serial?.url) {
      setSerialNumberPreview(serial.url);
      formik.setFieldValue(
        "otherClaimDetails.serialNumberImage",
        serial.fileKey || "",
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
    PreviewButton: ContentsPreviewButton,
    PreviewDialog: ContentsPreviewDialog,
  } = useImagePreviewOverlay();
  const [uploadingContentsSlot, setUploadingContentsSlot] = useState<number | null>(null);
  const contentsInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const contentsKeys: string[] =
    formik.values.otherClaimDetails?.contentsOfReturnImages || [];
  const contentsFilled = contentsKeys.filter((k) => !!k).length;
  const contentsVisibleSlots = Math.min(
    CONTENTS_MAX_FILES,
    contentsFilled + 1,
  );

  const uploadContentsImage = async (file: File, slotIndex: number) => {
    if (file.size > CONTENTS_IMAGE_MAX_MB * 1024 * 1024) {
      toast.error(`Each image must be less than ${CONTENTS_IMAGE_MAX_MB}MB`);
      return;
    }
    setUploadingContentsSlot(slotIndex);
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
        const updated = [...contentsKeys];
        updated[slotIndex] = key;
        const compact = updated.filter((v) => !!v).slice(0, CONTENTS_MAX_FILES);
        formik.setFieldValue(
          "otherClaimDetails.contentsOfReturnImages",
          compact,
        );
        formik.setFieldTouched(
          "otherClaimDetails.contentsOfReturnImages",
          true,
          false,
        );
        setContentsPreviews((prev) => {
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
      setUploadingContentsSlot(null);
    }
  };

  const removeContentsImage = (slotIndex: number) => {
    const updated = contentsKeys.filter((_, i) => i !== slotIndex);
    formik.setFieldValue("otherClaimDetails.contentsOfReturnImages", updated);
    setContentsPreviews((prev) => {
      blobs.release(prev[slotIndex]);
      return prev.filter((_, i) => i !== slotIndex);
    });
    if (contentsInputRefs.current[slotIndex]) {
      contentsInputRefs.current[slotIndex]!.value = "";
    }
  };

  const onContentsFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    slotIndex: number,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void uploadContentsImage(file, slotIndex);
  };

  const handleShippingLabelPreview = (_name: string, file: File | null) => {
    setShippingLabelPreview((prev) => {
      blobs.release(prev);
      return file ? blobs.createObjectURL(file) : null;
    });
  };

  const handleSerialNumberPreview = (_name: string, file: File | null) => {
    setSerialNumberPreview((prev) => {
      blobs.release(prev);
      return file ? blobs.createObjectURL(file) : null;
    });
  };

  const amazonTouched = (formik.touched as any)?.otherClaimDetails || {};
  const amazonErrors = (formik.errors as any)?.otherClaimDetails || {};
  const contentsError =
    amazonTouched.contentsOfReturnImages &&
    typeof amazonErrors.contentsOfReturnImages === "string"
      ? (amazonErrors.contentsOfReturnImages as string)
      : "";
  const shippingError =
    amazonTouched.shippingLabelImage &&
    typeof amazonErrors.shippingLabelImage === "string"
      ? (amazonErrors.shippingLabelImage as string)
      : "";

  // ── VMS screenshot cascade (Amazon slot map) ───────────────────────────
  // Slot schema: contents_0, contents_1, shippingLabel, serialNumber. The
  // rearrange modal + VMS auto-populate use the same fieldName-based order.
  const rearrangeSchema = useMemo<ArrangementField[]>(
    () => [
      { fieldName: "contents_0", label: "Contents 1", position: "first" },
      { fieldName: "contents_1", label: "Contents 2", position: "middle" },
      { fieldName: "shippingLabel", label: "Shipping Label", position: "middle" },
      { fieldName: "serialNumber", label: "Serial Number", position: "last" },
    ],
    [],
  );
  const rearrangeImageFields = useMemo(
    () => rearrangeSchema.map((s) => s.fieldName),
    [rearrangeSchema],
  );
  const rearrangeSlotPreviews = useMemo<Record<string, string | null>>(
    () => ({
      contents_0: contentsPreviews[0] ?? null,
      contents_1: contentsPreviews[1] ?? null,
      shippingLabel: shippingLabelPreview ?? null,
      serialNumber: serialNumberPreview ?? null,
    }),
    [contentsPreviews, shippingLabelPreview, serialNumberPreview],
  );

  const populateAmazonFromVms = (screenshots: string[]) => {
    // Up to 4 URLs: 0,1 → contents, 2 → shipping label, 3 → serial number.
    const capped = screenshots.slice(0, 4);
    const contentsUrls = capped.slice(0, 2).filter(Boolean);
    const shippingUrl = capped[2] || "";
    const serialUrl = capped[3] || "";

    const contentsKeysNew = contentsUrls
      .map((u) => u.split("/").pop() || "")
      .filter(Boolean);
    formik.setFieldValue(
      "otherClaimDetails.contentsOfReturnImages",
      contentsKeysNew,
    );
    setContentsPreviews((prev) => {
      prev.forEach((u) => blobs.release(u));
      return contentsUrls.length ? contentsUrls : [];
    });

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

    if (serialUrl) {
      formik.setFieldValue(
        "otherClaimDetails.serialNumberImage",
        serialUrl.split("/").pop() || "",
      );
      setSerialNumberPreview((prev) => {
        blobs.release(prev);
        return serialUrl;
      });
    } else {
      formik.setFieldValue("otherClaimDetails.serialNumberImage", "");
      setSerialNumberPreview((prev) => {
        blobs.release(prev);
        return null;
      });
    }
  };

  const resetAmazonVms = () => {
    formik.setFieldValue("otherClaimDetails.contentsOfReturnImages", []);
    formik.setFieldValue("otherClaimDetails.shippingLabelImage", "");
    formik.setFieldValue("otherClaimDetails.serialNumberImage", "");
    setContentsPreviews((prev) => {
      prev.forEach((u) => blobs.release(u));
      return [];
    });
    setShippingLabelPreview((prev) => {
      blobs.release(prev);
      return null;
    });
    setSerialNumberPreview((prev) => {
      blobs.release(prev);
      return null;
    });
  };

  const vms = useVmsScreenshots({
    carryOverImages: props.carryOverImages,
    awb: formik.values.AWBNumber,
    // Forward-AWB shots surface only in the Rearrange pool (no slot placement).
    forwardAwb: formik.values.forwardAWB,
    previews: rearrangeSlotPreviews,
    imageFields: rearrangeImageFields,
    populate: populateAmazonFromVms,
    reset: resetAmazonVms,
  });

  const applyArrangedAmazon = (arranged: string[]) => {
    // arranged order matches rearrangeSchema:
    // [contents_0, contents_1, shippingLabel, serialNumber]
    const [c0 = "", c1 = "", shippingUrl = "", serialUrl = ""] = arranged;

    const contentsUrls = [c0, c1].filter(Boolean);
    // Preserve existing S3 keys tied to previews the user already has;
    // fall back to filename slice for orphan VMS screenshots.
    const contentsPrevNow = contentsPreviews;
    const contentsKeysNow = contentsKeys;
    const newContentsKeys: string[] = [];
    const newContentsPreviews: (string | null)[] = [];
    contentsUrls.forEach((url) => {
      const oldIdx = contentsPrevNow.indexOf(url);
      if (oldIdx >= 0) {
        newContentsKeys.push(contentsKeysNow[oldIdx] || "");
        newContentsPreviews.push(url);
      } else {
        newContentsKeys.push(url.split("/").pop() || "");
        newContentsPreviews.push(url);
      }
    });
    formik.setFieldValue(
      "otherClaimDetails.contentsOfReturnImages",
      newContentsKeys,
    );
    setContentsPreviews((prev) => {
      prev.forEach((u) => blobs.release(u));
      return newContentsPreviews;
    });

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

    if (serialUrl) {
      formik.setFieldValue(
        "otherClaimDetails.serialNumberImage",
        serialUrl.split("/").pop() || "",
      );
      setSerialNumberPreview((prev) => {
        blobs.release(prev);
        return serialUrl;
      });
    } else {
      formik.setFieldValue("otherClaimDetails.serialNumberImage", "");
      setSerialNumberPreview((prev) => {
        blobs.release(prev);
        return null;
      });
    }

    const merged = new Set<string>([
      ...vms.fetchedScreenshots,
      ...contentsPrevNow.filter((v): v is string => Boolean(v)),
      ...(shippingLabelPreview ? [shippingLabelPreview] : []),
      ...(serialNumberPreview ? [serialNumberPreview] : []),
      ...arranged.filter(Boolean),
    ]);
    vms.setFetchedScreenshots(Array.from(merged));
  };

  if (side === "right") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <VmsRearrangeButton
          show={vms.fetchedScreenshots.length > 0 || vms.forwardOnlyScreenshots.length > 0}
          onClick={() => vms.setRearrangeModalOpen(true)}
        />
        {/* 1) Photograph of the contents of the return */}
        <Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: "6px" }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
              Photograph of the contents of the return
              <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
            </Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              (max files allowed : {CONTENTS_MAX_FILES})
            </Typography>
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "12px",
            }}
          >
            {Array.from({ length: contentsVisibleSlots }).map((_, slotIndex) => {
              const filled = !!contentsKeys[slotIndex];
              const preview = contentsPreviews[slotIndex];
              const isUploading = uploadingContentsSlot === slotIndex;
              return (
                <Box
                  key={slotIndex}
                  sx={{
                    position: "relative",
                    width: "100%",
                    height: 140,
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
                    ref={(el) => { contentsInputRefs.current[slotIndex] = el }}
                    type="file"
                    accept={CONTENTS_IMAGE_ACCEPT}
                    style={{ display: "none" }}
                    onChange={(e) => onContentsFileChange(e, slotIndex)}
                  />
                  {isUploading ? (
                    <CircularProgress size={22} color="primary" />
                  ) : filled && preview ? (
                    <>
                      <img
                        src={preview}
                        alt={`contents-${slotIndex + 1}`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          borderRadius: "8px",
                        }}
                      />
                      <ContentsPreviewButton src={preview} />
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
                          removeContentsImage(slotIndex);
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
                        cursor: "pointer",
                        width: "100%",
                        height: "100%",
                        justifyContent: "center",
                      }}
                      onClick={() =>
                        contentsInputRefs.current[slotIndex]?.click()
                      }
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
          {contentsError && (
            <FormHelperText error sx={{ ml: 1, mt: "5px" }}>
              {contentsError}
            </FormHelperText>
          )}
        </Box>

        {/* 2) Photograph of the returned package with the shipping label affixed */}
        <Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: "6px" }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
              Photograph of the returned package with the shipping label affixed
              <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
            </Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              (max files allowed : 1)
            </Typography>
          </Box>
          <FileInput
            name="otherClaimDetails.shippingLabelImage"
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="140px"
            width="100%"
            preview={shippingLabelPreview}
            onFileChange={handleShippingLabelPreview}
            error={!!shippingError}
          >
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "primary.main" }}>
              <InsertPhotoOutlined fontSize="medium" />
              <Typography variant="caption" fontWeight="bold">Upload</Typography>
            </Box>
          </FileInput>
          {shippingError && (
            <FormHelperText error sx={{ ml: 1 }}>{shippingError}</FormHelperText>
          )}
        </Box>

        {/* 3) Serial number of the item (optional) */}
        <Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: "6px" }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
              Serial number of the item
            </Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              (max files allowed : 1)
            </Typography>
          </Box>
          <FileInput
            name="otherClaimDetails.serialNumberImage"
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="140px"
            width="100%"
            preview={serialNumberPreview}
            onFileChange={handleSerialNumberPreview}
            error={false}
          >
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "primary.main" }}>
              <InsertPhotoOutlined fontSize="medium" />
              <Typography variant="caption" fontWeight="bold">Upload</Typography>
            </Box>
          </FileInput>
        </Box>

        <RearrangeModal
          open={vms.rearrangeModalOpen}
          onClose={() => vms.setRearrangeModalOpen(false)}
          onSave={applyArrangedAmazon}
          images={vms.rearrangeImagePool}
          initialSlotImages={vms.rearrangeInitialSlots}
          schema={rearrangeSchema}
          title="Rearrange Amazon Screenshots"
        />
        <ContentsPreviewDialog />
      </Box>
    );
  }

  // side === "left"
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

      {/* Optional Amazon seller-portal account. Amazon has no master-data
          feed for account resolution, so the operator picks manually from
          the Integrations list (empty if none configured). Persisted at
          otherClaimDetails.username. */}
      <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "6px" }}>
        <Typography>Amazon Account Username</Typography>
        <PlatformAccountDropdown
          platform="amazon"
          label=""
          value={(formik.values.otherClaimDetails?.username as string) || ""}
          onChange={(v) => formik.setFieldValue("otherClaimDetails.username", v)}
        />
      </Box>

      {/* AWB + Forward AWB + SKU — Customer Order Number is intentionally
          omitted for Amazon per business requirement. */}
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
        previews={videoPreviews}
        onPreviewChange={handleVideoPreview}
        onLinkChange={handleVideoLink}
      />
    </>
  );
};

export default AmazonForm;
