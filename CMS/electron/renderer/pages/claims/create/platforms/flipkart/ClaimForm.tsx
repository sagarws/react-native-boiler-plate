import {
  Box,
  CircularProgress,
  FormHelperText,
  InputAdornment,
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
import { debounceAsync } from "../../debounce";
import { lookupFlipkartAwb } from "@renderer/services/flipkartBackup.service";
import { returnAwbAutofill } from "@renderer/services/claimCreate.service";
import FileInput from "../../media/FileInput";
import { useImagePreviewOverlay } from "../../media/ImagePreviewOverlay";
import LeftVideos from "../../LeftVideos";
import VmsRearrangeButton from "../../VmsRearrangeButton";
import RearrangeModal, { type ArrangementField } from "../../RearrangeModal";
import { useVmsScreenshots } from "../../useVmsScreenshots";
import { useCmsAutoFetch } from "../../useCmsAutoFetch";
import { getIn } from "../../useClaimForm";
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

/** Worth asking the saved report about — anything shorter is still being typed. */
const AWB_SHAPE = /^[A-Za-z0-9-]{6,40}$/;

type AwbSide = "return" | "forward";

/**
 * Flipkart CMS form. Left column mirrors AjioForm minus the Customer Order
 * Number field. Right column is a trimmed-down Myntra layout: Shipping Label
 * (single image) + Product & Outer Packing (1..10 images with drag-reorder).
 * Both write into `otherClaimDetails` on the formik state and travel to
 * the BE as one JSON bundle (matching the myntraClaimDetails pattern).
 */
const FlipkartForm = (props: PlatformFormProps) => {
  const { formik, feedId, isPartialArticleClaim, skus, side, existingClaim } = props;

  // /cms/update: seed shipping-label + packing previews from the loaded
  // claim's otherClaimDetails bundle. BE attaches `.url` to each nested image
  // (findCmsByAwb → withUrl / withUrlArray) so we can drop it straight into
  // preview state. fileKey values are written back into formik so an Update
  // submit re-sends the S3 keys unchanged when the operator doesn't touch a
  // slot. Guarded by a ref keyed on claim id so subsequent uploads /
  // rearranges aren't clobbered on re-render.
  const flipkartHydratedRef = useRef<string | null>(null);

  // ── Left-side (video previews + AWB auto-fetch) ────────────────────────
  const blobs = useBlobPreview();
  const [videoPreviews, setVideoPreviews] = useState<{
    returnVideo: string | null;
    forwardVideo: string | null;
  }>({ returnVideo: null, forwardVideo: null });

  // /cms/update: seed return/forward video previews from the loaded claim so
  // LeftVideos renders the playable preview instead of the empty
  // "Choose a video" placeholder. Own ref so it doesn't collide with the
  // image hydration above.
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

  /*
   * EITHER AWB → THE REST, from the saved Flipkart Orders and Returns reports.
   *
   * The report sync keeps the order item id, SKU and AWB of every row it
   * collected; the order item id joins a return to its order, so a typed
   * return AWB finds the forward AWB and the other way round. Local and exact —
   * no Flipkart call — and only fills a field that is empty or different.
   *
   * Refs for what the debounced callback reads: it is built once and would
   * otherwise see the first render's form forever.
   */
  const [lookingUp, setLookingUp] = useState<AwbSide | null>(null);
  const lookupSeqRef = useRef(0);
  const formikRef = useRef(formik);
  formikRef.current = formik;
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const fillFromReport = useMemo(
    () =>
      debounceAsync(async (awb: string, side: AwbSide) => {
        const seq = ++lookupSeqRef.current;

        setLookingUp(side);
        const response = await lookupFlipkartAwb(awb, side);
        // Something else was typed since — this answer is stale.
        if (seq !== lookupSeqRef.current) return;
        setLookingUp(null);

        if (!response.success) {
          toast.error(response.error.message);
          return;
        }

        const match = response.data;

        if (!match) {
          toast.info(`${awb} is not in the saved Flipkart report`);
          return;
        }

        const form = formikRef.current;
        const values = form.values;
        const same = (current: unknown, next: string) =>
          (typeof current === "string" ? current.trim() : "") === next;
        const filled: string[] = [];

        if (side === "forward" && match.returnAwb && !same(values.AWBNumber, match.returnAwb)) {
          autoRef.current.onReturnAwbChange(match.returnAwb);
          filled.push("return AWB");
        }
        if (side === "return" && match.forwardAwb && !same(values.forwardAWB, match.forwardAwb)) {
          autoRef.current.onForwardAwbChange(match.forwardAwb);
          filled.push("forward AWB");
        }
        // Only into a blank Sub Order ID: Flipkart's own Returns search
        // (askFlipkartOrderIds) is the source for it and replaces this.
        if (match.orderItemId && same(values.subOrderNumber, "")) {
          void form.setFieldValue("subOrderNumber", match.orderItemId);
          filled.push("sub order ID");
        }
        if (match.sku && !same(values.skuName, match.sku)) {
          void form.setFieldValue("skuName", match.sku);
          filled.push("SKU");
        }
        // The account whose report held it — only when none is chosen yet.
        if (match.username && same(values.otherClaimDetails?.username, "")) {
          void form.setFieldValue("otherClaimDetails.username", match.username);
          filled.push("account");
        }

        toast.success(
          filled.length > 0
            ? `Filled ${filled.join(", ")} from the saved Flipkart report`
            : `${awb} matches the saved Flipkart report`,
        );
      }, 600),
    [],
  );

  useEffect(
    () => () => {
      fillFromReport.cancel();
      // Drops any answer still in flight.
      lookupSeqRef.current += 1;
    },
    [fillFromReport],
  );

  const onAwbTyped = (value: string, side: AwbSide) => {
    // A new value abandons whatever was in flight for the old one.
    lookupSeqRef.current += 1;
    fillFromReport.cancel();
    setLookingUp(null);

    const trimmed = value.trim();

    if (AWB_SHAPE.test(trimmed)) fillFromReport(trimmed, side);
  };

  const lookupSpinner = (side: AwbSide) =>
    lookingUp === side
      ? {
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <CircularProgress size={16} />
              </InputAdornment>
            ),
          },
        }
      : undefined;

  // The SKU box shows when there is a list to pick from, or when the saved
  // report has already filled one in.
  const showSku = skus.length > 0 || Boolean(formik.values.skuName);

  /*
   * RETURN AWB → ORDER ID + ORDER ITEM ID, from Flipkart, in the background.
   *
   * Flipkart's Returns search, on the saved session (no sign-in), answers the
   * return AWB with its order id ("OD…") and order item id. They go into the
   * form — the order id into the hidden `customerOrderNumber`, the item id into
   * Sub Order ID (replacing the saved report's guess) — and are saved with
   * the claim by createCMS. Keyed on the AWB VALUE, not on typing, so a return
   * AWB the saved report filled in from the forward side is asked about too.
   *
   * Quiet: a miss or a dead session leaves the form as it was (main logs it).
   * Not on Update — updateCMS does not take these fields.
   */
  const returnAwb = ((formik.values.AWBNumber as string) || "").trim();
  const orderIdSeqRef = useRef(0);
  // The order id this lookup put in, so a new AWB clears it but never one typed.
  const filledOrderIdRef = useRef("");
  const chosenAccountRef = useRef("");
  chosenAccountRef.current = ((formik.values.otherClaimDetails?.username as string) || "").trim();

  const askFlipkartOrderIds = useMemo(
    () =>
      debounceAsync(async (awb: string) => {
        const seq = ++orderIdSeqRef.current;
        const chosen = chosenAccountRef.current;
        const response = await returnAwbAutofill("flipkart", awb, chosen || undefined);

        if (seq !== orderIdSeqRef.current || !response.success || !response.data.found) return;

        const { orderId, subOrderNumber, username } = response.data;
        const form = formikRef.current;
        const current = (path: string) => {
          const value = getIn(form.values, path);
          return typeof value === "string" ? value.trim() : "";
        };

        if (orderId && !current("customerOrderNumber")) {
          filledOrderIdRef.current = orderId;
          void form.setFieldValue("customerOrderNumber", orderId);
        }
        // Flipkart's answer for THIS AWB wins over the saved report's.
        if (subOrderNumber && current("subOrderNumber") !== subOrderNumber) {
          void form.setFieldValue("subOrderNumber", subOrderNumber);
        }
        if (username && !current("otherClaimDetails.username")) {
          void form.setFieldValue("otherClaimDetails.username", username);
        }
      }, 800),
    [],
  );

  useEffect(() => {
    // A different AWB: the old answer is no longer this claim's.
    orderIdSeqRef.current += 1;
    askFlipkartOrderIds.cancel();

    const form = formikRef.current;
    const held = getIn(form.values, "customerOrderNumber");

    if (filledOrderIdRef.current && typeof held === "string" && held.trim() === filledOrderIdRef.current) {
      void form.setFieldValue("customerOrderNumber", "");
    }
    filledOrderIdRef.current = "";

    if (!existingClaim?._id && AWB_SHAPE.test(returnAwb)) askFlipkartOrderIds(returnAwb);
  }, [returnAwb, existingClaim?._id, askFlipkartOrderIds]);

  useEffect(
    () => () => {
      askFlipkartOrderIds.cancel();
      orderIdSeqRef.current += 1;
    },
    [askFlipkartOrderIds],
  );

  // ── Right-side (shipping label + packing images) ───────────────────────
  const [shippingLabelPreview, setShippingLabelPreview] = useState<string | null>(null);
  const [packingPreviews, setPackingPreviews] = useState<(string | null)[]>([]);

  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || flipkartHydratedRef.current === claimId) return;
    const details = (existingClaim?.otherClaimDetails as any) || null;
    if (!details) return;
    flipkartHydratedRef.current = claimId;

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

    // Defensive: mirror the seller-portal account username here too. The
    // shared `applyExistingClaim` spread also merges it, but that runs off
    // `platformFlagsRef.current` which can be stale for one render if the
    // find-by-awb resolves before userProfile has hydrated the platform list
    // (platformLabel then still falls back to "AJIO" and the flipkart branch
    // is skipped). Writing it directly from the loaded claim keeps the
    // Account Username dropdown populated regardless of that race. `claimArea`
    // is hydrated the same way so the top-level Claim Area select preselects.
    if (typeof details.username === "string" && details.username.trim()) {
      formik.setFieldValue("otherClaimDetails.username", details.username);
    }
    if (typeof details.claimArea === "string" && details.claimArea.trim()) {
      formik.setFieldValue("otherClaimDetails.claimArea", details.claimArea);
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

  const flipkartTouched = (formik.touched as any)?.otherClaimDetails || {};
  const flipkartErrors = (formik.errors as any)?.otherClaimDetails || {};
  const shippingError =
    flipkartTouched.shippingLabelImage &&
    typeof flipkartErrors.shippingLabelImage === "string"
      ? (flipkartErrors.shippingLabelImage as string)
      : "";
  const packingError =
    flipkartTouched.packingImages &&
    typeof flipkartErrors.packingImages === "string"
      ? (flipkartErrors.packingImages as string)
      : "";

  // ── VMS screenshot cascade (mirrors MyntraForm) ────────────────────────
  // Slot schema: shipping label first, then packing_0..N. Populate: 1st URL
  // -> shipping label, remaining up to PACKING_MAX -> packing images.
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
    // arranged[0] = shipping label URL; arranged[1..] = packing URLs.
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
    // Preserve any existing S3 keys tied to previews the user already has;
    // fall back to a filename slice for orphan VMS screenshots.
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
        {/* Shipping Label */}
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

        {/* Packing Images */}
        <Box>
          <Typography sx={{ mb: "5px" }}>
            Evidence of Issue <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <FormHelperText sx={{ mb: "5px" }} error={!!packingError}>
            (Min 3, Max {PACKING_MAX} · {PACKING_IMAGE_MAX_MB}MB each · drag to reorder)
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

      {/* Optional Flipkart seller-portal account. No master-data auto-select
          for Flipkart; the operator picks from the Integrations account
          list or leaves blank. Persisted at otherClaimDetails.username. */}
      <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "6px" }}>
        <Typography>Flipkart Account Username</Typography>
        <PlatformAccountDropdown
          platform="flipkart"
          label=""
          value={(formik.values.otherClaimDetails?.username as string) || ""}
          onChange={(v) => formik.setFieldValue("otherClaimDetails.username", v)}
        />
      </Box>

      {/* AWB + Forward AWB + Sub Order ID + SKU — Customer Order Number is
          intentionally not shown for Flipkart per business requirement; it is
          filled in the background with Flipkart's order id (see
          askFlipkartOrderIds). Sub Order ID is optional, filled from the saved
          report or Flipkart. */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "1fr 1fr",
            md: showSku ? "repeat(4, 1fr)" : "repeat(3, 1fr)",
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
            onChange={(e) => {
              auto.onReturnAwbChange(e.target.value);
              onAwbTyped(e.target.value, "return");
            }}
            onBlur={formik.handleBlur}
            error={!!(formik.touched.AWBNumber && formik.errors.AWBNumber)}
            helperText={formik.touched.AWBNumber && (formik.errors.AWBNumber as string)}
            slotProps={lookupSpinner("return")}
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
            onChange={(e) => {
              auto.onForwardAwbChange(e.target.value);
              onAwbTyped(e.target.value, "forward");
            }}
            onBlur={formik.handleBlur}
            slotProps={lookupSpinner("forward")}
          />
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Typography>Sub Order ID</Typography>
          <TextField
            name="subOrderNumber"
            placeholder="Enter Sub Order ID"
            size="small"
            fullWidth
            value={formik.values.subOrderNumber}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
          />
        </Box>

        {showSku && (
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

export default FlipkartForm;
