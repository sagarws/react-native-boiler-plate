import {
  Box,
  Button,
  CircularProgress,
  Divider,
  FormHelperText,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import {
  DeleteRounded,
  DragIndicator,
  InsertPhotoOutlined,
  VideocamOutlined,
} from "../../icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../../toast";
import FileInput from "../../media/FileInput";
import { useImagePreviewOverlay } from "../../media/ImagePreviewOverlay";
import LeftVideos from "../../LeftVideos";
import VmsRearrangeButton from "../../VmsRearrangeButton";
import RearrangeModal, { type ArrangementField } from "../../RearrangeModal";
import { useVmsScreenshots } from "../../useVmsScreenshots";
import { uploadCmsImage } from "../../api";
import { useCmsAutoFetch } from "../../useCmsAutoFetch";
import { useBlobPreview } from "../../useBlobPreview";
import { type PlatformFormProps } from "../ajio/ClaimForm";
import { useMyntraClaim } from "./useMyntraClaim";
import PlatformAccountDropdown from "../../PlatformAccountDropdown";
import { usePlatformAccountAutoSelect } from "../../usePlatformAccountAutoSelect";
import { tint } from "../../tint";
import { debounceAsync } from "../../debounce";
import { returnAwbAutofill } from "@renderer/services/claimCreate.service";

const SHIPPING_LABEL_MAX_MB = 5;
const PACKING_IMAGE_MAX_MB = 3;
const DAMAGED_VIDEO_MAX_MB = 50;
const PACKING_DEFAULT_SLOTS = 3;
const PACKING_MAX = 10;
const PACKING_IMAGE_ACCEPT = "image/jpg,image/png,image/jpeg";
/** Worth asking Myntra about: one token of a plausible length. Mirrors the main process. */
const AWB_SHAPE = /^[A-Za-z0-9-]{6,40}$/;

/** "a@x, b@y and 2 more" — a toast is one line. */
const nameList = (names: string[]): string =>
  names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

/**
 * Myntra form ported from TrackVid-App/src/renderer/src/components/cms/
 * MyntraRightForm.tsx. Left column: AWB / Forward AWB / conditional fields
 * / remark. Right column: shipping label, packing images (drag-reorder),
 * damaged video (upload OR link).
 *
 * Deferred (v2): VMS-screenshot auto-attach + Rearrange modal, two-API video
 * auto-resolution flow (fetchMyntraOrderInfo + /order/{awb} chooser).
 */
const MyntraForm = ({ formik, feedId, side, existingClaim, carryOverImages }: PlatformFormProps) => {
  const {
    shippingLabelPreview,
    setShippingLabelPreview,
    packingPreviews,
    setPackingPreviews,
    damagedVideoPreview,
    setDamagedVideoPreview,
  } = useMyntraClaim();

  // /cms/update: seed shipping-label + packing + damaged-video previews from
  // the loaded claim's myntraClaimDetails. The BE (findCmsByAwb) attaches a
  // resolved `.url` on each nested image so we can drop it straight into
  // preview state; the original `.fileKey` is written back into formik so an
  // Update submit re-sends the S3 keys unchanged when the operator doesn't
  // touch the slots. Guarded by a ref keyed on claim id so subsequent
  // uploads / rearranges aren't clobbered on re-render.
  const myntraHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || myntraHydratedRef.current === claimId) return;
    const details = (existingClaim?.myntraClaimDetails as any) || null;
    if (!details) return;
    myntraHydratedRef.current = claimId;

    const shipping = details.shippingLabelImage;
    if (shipping?.url) {
      setShippingLabelPreview(shipping.url);
      formik.setFieldValue(
        "myntraClaimDetails.shippingLabelImage",
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
      formik.setFieldValue("myntraClaimDetails.packingImages", fileKeys);
    }

    const damaged = details.damagedProductVideo;
    if (damaged?.url) {
      setDamagedVideoPreview(damaged.url);
      formik.setFieldValue(
        "myntraClaimDetails.damagedProductVideo",
        damaged.fileKey || "",
      );
    } else if (details.damagedProductVideoLink) {
      setDamagedVideoPreview(details.damagedProductVideoLink);
      formik.setFieldValue(
        "myntraClaimDetails.damagedProductVideoLink",
        details.damagedProductVideoLink,
      );
    }

    // Defensive: seed the Myntra seller-portal account username. The bundle
    // merge in applyExistingClaim also writes it, but same rationale as the
    // other platform forms — writing it here too guarantees the dropdown
    // preselects on direct /cms/update visits.
    if (typeof details.username === "string" && details.username.trim()) {
      formik.setFieldValue("myntraClaimDetails.username", details.username.trim());
    }
  }, [existingClaim, formik, setShippingLabelPreview, setPackingPreviews, setDamagedVideoPreview]);

  const packingImages = formik.values.myntraClaimDetails?.packingImages || [];
  const filledCount = packingImages.filter((k) => !!k).length;
  const visibleSlotCount = useMemo(
    () => Math.min(PACKING_MAX, Math.max(PACKING_DEFAULT_SLOTS, filledCount + 1)),
    [filledCount],
  );

  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const {
    PreviewButton: PackingPreviewButton,
    PreviewDialog: PackingPreviewDialog,
  } = useImagePreviewOverlay();
  const blobs = useBlobPreview();
  const [videoPreviews, setVideoPreviews] = useState<{
    returnVideo: string | null;
    forwardVideo: string | null;
  }>({ returnVideo: null, forwardVideo: null });

  // /cms/update: seed the return/forward video previews from the loaded
  // claim's stored links so LeftVideos renders the playable preview instead
  // of the empty "Choose a video" placeholder. Kept separate from the image
  // hydration effect above (its own claim-id ref) because videoPreviews is
  // declared further down the component body.
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
    isMyntra: true,
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

  // Account Username dropdown auto-select. Myntra persists the account
  // inside its bundle at `myntraClaimDetails.username`; the BE looks it up
  // in MyntraMasterImport.myntra_account_username.
  const currentMyntraUsername =
    (formik.values.myntraClaimDetails?.username as string) || "";
  const accountAuto = usePlatformAccountAutoSelect({
    platform: "myntra",
    // The AWB survives a platform switch, so the hook can re-look-up for the
    // new platform instead of leaving its account blank.
    awb: (formik.values.AWBNumber as string) || "",
    currentValue: currentMyntraUsername,
    onResolve: (account) =>
      formik.setFieldValue("myntraClaimDetails.username", account),
  });

  /*
   * RETURN AWB → FORWARD AWB, SKU AND ACCOUNT, straight from Myntra.
   *
   * `fetchNewClaim` answers a return AWB with the forward leg's AWB
   * (`trackingId`) and the line's `skuId`. Asked with SAVED sessions only —
   * of the chosen account, or of every Myntra account at once when none is
   * chosen, in which case the one that holds it becomes the account.
   *
   * Refs for everything the debounced callback reads: it is memoised once and
   * would otherwise see the first render's formik and account forever.
   */
  const [autofilling, setAutofilling] = useState(false);
  const autofillSeqRef = useRef(0);
  /**
   * Myntra's `styleInfo.styleBasic.price` for the AWB last looked up — the disputed amount of
   * a partial return. Kept, not only applied, because the claim type is often
   * picked AFTER the AWB: switching to Partial Return then fills it too.
   */
  const [fetchedAmount, setFetchedAmount] = useState<number | null>(null);
  const isPartialReturn = formik.values.typeOfClaim === "partial_return";
  const disputedAmount = formik.values.myntraClaimDetails?.disputedAmount;
  const formikRef = useRef(formik);
  formikRef.current = formik;

  // Fills the disputed amount for a partial return — only when it is empty, so
  // an amount the operator typed is never overwritten.
  useEffect(() => {
    if (!isPartialReturn || fetchedAmount === null) return;
    if (disputedAmount !== undefined && disputedAmount !== null && String(disputedAmount) !== "") return;

    // A STRING, as typing gives: the validator and the payload both read this
    // field as text, and a number here read as "required" while showing 1799.
    void formikRef.current.setFieldValue("myntraClaimDetails.disputedAmount", String(fetchedAmount));
  }, [isPartialReturn, fetchedAmount, disputedAmount]);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const chosenAccountRef = useRef(currentMyntraUsername);
  chosenAccountRef.current = currentMyntraUsername;

  const autofillFromMyntra = useMemo(
    () =>
      debounceAsync(async (awb: string) => {
        const seq = ++autofillSeqRef.current;
        const chosen = chosenAccountRef.current.trim();

        setAutofilling(true);
        const response = await returnAwbAutofill("myntra", awb, chosen || undefined);
        // The operator has typed something else since — this answer is stale.
        if (seq !== autofillSeqRef.current) return;
        setAutofilling(false);

        if (!response.success) {
          toast.error(response.error.message);
          return;
        }

        const { found, username, forwardAwb, sku, price, asked, failures } = response.data;
        const form = formikRef.current;

        // A new AWB's answer replaces the last one's, found or not, so a
        // partial return never inherits another order's amount.
        setFetchedAmount(found ? price : null);

        if (found) {
          // Through the same path as typing it, so the forward video follows.
          if (forwardAwb) autoRef.current.onForwardAwbChange(forwardAwb);
          if (sku) form.setFieldValue("skuName", sku);
          if (username && !chosen) form.setFieldValue("myntraClaimDetails.username", username);

          const filled = [
            forwardAwb && "forward AWB",
            sku && "SKU",
            price !== null && "amount",
          ]
            .filter(Boolean)
            .join(", ");
          toast.success(
            filled
              ? `Fetched ${filled} from Myntra account ${username}`
              : `${awb} is on ${username}, but Myntra gave no forward AWB or SKU`,
          );
          return;
        }

        if (asked === 0) {
          toast.error("No Myntra account is saved for this company — add one under Login");
          return;
        }

        const reason = failures[0]?.reason ?? "";

        if (failures.length === asked) {
          toast.error(
            chosen
              ? `Data not fetched from ${chosen}: ${reason}`
              : `Data not fetched from all ${asked} Myntra accounts — ${reason}`,
          );
          return;
        }

        if (failures.length > 0) {
          toast.error(
            `${awb} not found on ${asked - failures.length} of ${asked} Myntra accounts; ` +
              `could not ask ${nameList(failures.map((f) => f.username))} — ${reason}`,
          );
          return;
        }

        toast.info(
          chosen
            ? `Data not fetched — ${awb} not found on Myntra account ${chosen}`
            : `Data not fetched — ${awb} not found on any of the ${asked} Myntra accounts`,
        );
      }, 800),
    [],
  );

  useEffect(
    () => () => {
      autofillFromMyntra.cancel();
      // Drops any answer still in flight.
      autofillSeqRef.current += 1;
    },
    [autofillFromMyntra],
  );

  const onReturnAwbTyped = (value: string) => {
    // A new value abandons whatever was in flight for the old one.
    autofillSeqRef.current += 1;
    autofillFromMyntra.cancel();
    setAutofilling(false);

    const trimmed = value.trim();

    if (AWB_SHAPE.test(trimmed)) autofillFromMyntra(trimmed);
  };

  const [dragSrcIndex, setDragSrcIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleShippingLabelPreview = (_name: string, file: File | null) => {
    setShippingLabelPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleDamagedVideoPreview = (_name: string, file: File | null) => {
    if (file) {
      setDamagedVideoPreview(URL.createObjectURL(file));
    } else {
      setDamagedVideoPreview(null);
      formik.setFieldValue("myntraClaimDetails.damagedProductVideo", "");
    }
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
        formik.setFieldValue("myntraClaimDetails.packingImages", compact);
        formik.setFieldTouched("myntraClaimDetails.packingImages", true, false);
        setPackingPreviews((prev) => {
          const next = [...prev];
          next[slotIndex] = URL.createObjectURL(file);
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
    formik.setFieldValue("myntraClaimDetails.packingImages", updated);
    setPackingPreviews((prev) => prev.filter((_, i) => i !== slotIndex));
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
    formik.setFieldValue("myntraClaimDetails.packingImages", keys);
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

  const packingError =
    (formik.touched as any)?.myntraClaimDetails?.packingImages &&
    typeof (formik.errors as any)?.myntraClaimDetails?.packingImages === "string"
      ? ((formik.errors as any).myntraClaimDetails.packingImages as string)
      : "";

  const shippingError =
    (formik.touched as any)?.myntraClaimDetails?.shippingLabelImage &&
    typeof (formik.errors as any)?.myntraClaimDetails?.shippingLabelImage === "string"
      ? ((formik.errors as any).myntraClaimDetails.shippingLabelImage as string)
      : "";

  const myntraTouched = (formik.touched as any)?.myntraClaimDetails || {};
  const myntraErrors = (formik.errors as any)?.myntraClaimDetails || {};

  // VMS screenshots + Rearrange modal. Slot schema: shipping label first,
  // then packing_0..N. Populate: 1st screenshot -> shipping, next up to 10
  // -> packing images.
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

  const populateMyntraFromVms = (screenshots: string[]) => {
    const capped = screenshots.slice(0, 11); // 1 shipping + up to 10 packing
    const [shippingUrl, ...packingUrls] = capped;
    if (shippingUrl) {
      formik.setFieldValue(
        "myntraClaimDetails.shippingLabelImage",
        shippingUrl.split("/").pop() || "",
      );
      setShippingLabelPreview(shippingUrl);
    } else {
      formik.setFieldValue("myntraClaimDetails.shippingLabelImage", "");
      setShippingLabelPreview(null);
    }
    const packingKeys = packingUrls.map((u) => u.split("/").pop() || "");
    formik.setFieldValue("myntraClaimDetails.packingImages", packingKeys);
    setPackingPreviews(packingUrls);
  };

  const resetMyntraVms = () => {
    formik.setFieldValue("myntraClaimDetails.shippingLabelImage", "");
    formik.setFieldValue("myntraClaimDetails.packingImages", []);
    setShippingLabelPreview(null);
    setPackingPreviews([]);
  };

  const vms = useVmsScreenshots({
    awb: formik.values.AWBNumber,
    // Forward-AWB shots surface only in the Rearrange pool (no slot placement).
    forwardAwb: formik.values.forwardAWB,
    previews: rearrangeSlotPreviews,
    imageFields: rearrangeImageFields,
    populate: populateMyntraFromVms,
    reset: resetMyntraVms,
    carryOverImages,
  });

  const applyArrangedMyntra = (arranged: string[]) => {
    // arranged[0] = shipping label URL; arranged[1..] = packing URLs.
    const [shippingUrl, ...packingUrls] = arranged;
    if (shippingUrl) {
      formik.setFieldValue(
        "myntraClaimDetails.shippingLabelImage",
        shippingUrl.split("/").pop() || "",
      );
      setShippingLabelPreview(shippingUrl);
    } else {
      formik.setFieldValue("myntraClaimDetails.shippingLabelImage", "");
      setShippingLabelPreview(null);
    }
    // Map preview URL back to existing key when possible; fall back to filename
    // for orphan VMS screenshots.
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
    formik.setFieldValue("myntraClaimDetails.packingImages", newKeys);
    setPackingPreviews(newPreviews);

    const merged = new Set<string>([
      ...vms.fetchedScreenshots,
      ...(shippingLabelPreview ? [shippingLabelPreview] : []),
      ...previewsNow.filter((v): v is string => Boolean(v)),
      ...arranged.filter(Boolean),
    ]);
    vms.setFetchedScreenshots(Array.from(merged));
  };

  if (side === "left") {
    return (
      <>
        {formik.values.typeOfClaim === "partial_return" && (
          <Box sx={{ marginBottom: 2 }}>
            <Typography>
              Disputed Amount <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
            </Typography>
            <TextField
              name="myntraClaimDetails.disputedAmount"
              placeholder="Enter Disputed Amount"
              type="number"
              inputProps={{ min: 0, step: "any" }}
              size="small"
              fullWidth
              value={formik.values.myntraClaimDetails?.disputedAmount || ""}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              error={!!(myntraTouched.disputedAmount && myntraErrors.disputedAmount)}
              helperText={myntraTouched.disputedAmount && (myntraErrors.disputedAmount as string)}
            />
          </Box>
        )}

        {formik.values.typeOfClaim === "wrong_returns_own_product" && (
          <Box sx={{ marginBottom: 2 }}>
            <Typography>
              Physical Received SKU <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
            </Typography>
            <TextField
              name="myntraClaimDetails.physicalReceivedSku"
              placeholder="Enter Physical Received Sku"
              size="small"
              fullWidth
              value={formik.values.myntraClaimDetails?.physicalReceivedSku || ""}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              error={!!(myntraTouched.physicalReceivedSku && myntraErrors.physicalReceivedSku)}
              helperText={
                myntraTouched.physicalReceivedSku && (myntraErrors.physicalReceivedSku as string)
              }
            />
          </Box>
        )}

        {/* Account Username on its own row, above the AWB row. */}
        <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "5px" }}>
          <Typography>Myntra Account Username</Typography>
          <PlatformAccountDropdown
            platform="myntra"
            label=""
            value={currentMyntraUsername}
            onChange={(v) =>
              formik.setFieldValue("myntraClaimDetails.username", v)
            }
          />
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", marginBottom: 2 }}>
          <Box sx={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "5px" }}>
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
                accountAuto.onReturnAwb(e.target.value);
                onReturnAwbTyped(e.target.value);
              }}
              onBlur={formik.handleBlur}
              error={!!(formik.touched.AWBNumber && formik.errors.AWBNumber)}
              helperText={
                (formik.touched.AWBNumber && (formik.errors.AWBNumber as string)) ||
                (autofilling ? "Searching Myntra…" : undefined)
              }
              InputProps={{
                endAdornment: autofilling ? (
                  <InputAdornment position="end">
                    <CircularProgress size={16} />
                  </InputAdornment>
                ) : undefined,
              }}
            />
          </Box>
          <Box sx={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "5px" }}>
            <Typography>Forward AWB</Typography>
            <TextField
              name="forwardAWB"
              placeholder="Enter Forward AWB"
              size="small"
              fullWidth
              value={formik.values.forwardAWB}
              onChange={(e) => {
                auto.onForwardAwbChange(e.target.value);
                accountAuto.onForwardAwb(e.target.value);
              }}
              onBlur={formik.handleBlur}
            />
          </Box>
          {/* Optional. Filled from Myntra's `skuId` when the return AWB is found. */}
          <Box sx={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "5px" }}>
            <Typography>SKU</Typography>
            <TextField
              name="skuName"
              placeholder="Enter SKU"
              size="small"
              fullWidth
              value={formik.values.skuName || ""}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
            />
          </Box>
        </Box>

        <Box sx={{ marginBottom: 2 }}>
          <Typography>Remark</Typography>
          <TextField
            fullWidth
            size="small"
            multiline
            rows={2}
            placeholder="Additional Remark"
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

        {/* Damaged Video — placed on the left column so it fills the space
            under the Return/Forward video row and keeps the right column
            (shipping label + packing images) from towering over the left. */}
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", mb: "4px" }}>
            <Typography sx={{ fontSize: 13 }}>Damaged Product or Outer Packaging</Typography>
            <FormHelperText sx={{ m: 0, fontSize: 11 }}>
              Optional · max {DAMAGED_VIDEO_MAX_MB}MB
            </FormHelperText>
          </Box>
          <FileInput
            name="myntraClaimDetails.damagedProductVideo"
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="110px"
            width="100%"
            preview={damagedVideoPreview}
            onFileChange={handleDamagedVideoPreview}
            error={false}
            isVideo
            disableCapture
          >
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "primary.main" }}>
              <VideocamOutlined fontSize="medium" />
              <Typography variant="caption" fontWeight="bold">Upload Video</Typography>
            </Box>
          </FileInput>
          {!damagedVideoPreview && (
            <Box sx={{ mt: 0.75, display: "flex", alignItems: "center", gap: "8px" }}>
              <Divider sx={{ flex: "0 0 20px", borderColor: "primary.light" }} />
              <Typography variant="caption" color="text.secondary">or paste link</Typography>
              <TextField
                fullWidth
                size="small"
                placeholder="Damaged Product Video Link"
                name="myntraClaimDetails.damagedProductVideoLink"
                value={formik.values.myntraClaimDetails?.damagedProductVideoLink || ""}
                onChange={(e) => {
                  formik.setFieldValue("myntraClaimDetails.damagedProductVideoLink", e.target.value);
                  setDamagedVideoPreview(e.target.value || null);
                }}
                onBlur={formik.handleBlur}
              />
            </Box>
          )}
          {damagedVideoPreview && (
            <Button
              size="small"
              variant="text"
              color="error"
              sx={{ alignSelf: "flex-start", mt: 0.25, fontSize: 12 }}
              onClick={() => {
                formik.setFieldValue("myntraClaimDetails.damagedProductVideo", "");
                formik.setFieldValue("myntraClaimDetails.damagedProductVideoLink", "");
                setDamagedVideoPreview(null);
              }}
            >
              Remove video
            </Button>
          )}
        </Box>
      </>
    );
  }

  // side === "right"
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
          name="myntraClaimDetails.shippingLabelImage"
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
          Product &amp; Outer Packing <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
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
        onSave={applyArrangedMyntra}
        images={vms.rearrangeImagePool}
        initialSlotImages={vms.rearrangeInitialSlots}
        schema={rearrangeSchema}
        title="Rearrange Packing Images"
      />
      <PackingPreviewDialog />
    </Box>
  );
};

export default MyntraForm;
