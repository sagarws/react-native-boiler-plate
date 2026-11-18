import { Box, FormHelperText, TextField, Typography,
} from "@mui/material";
import {
  InsertDriveFileOutlined,
  InsertPhotoOutlined,
  PictureAsPdfOutlined,
} from "./icons";
import type { ClaimForm } from "./useClaimForm";
import { useEffect, useMemo, useRef, useState } from "react";
import { useClaimFormMode } from "./ClaimFormMode";
import FileInput from "./media/FileInput";
import SixSideImagesInput from "./media/SixSideImagesInput";
import CaptureImages from "./media/CaptureImages";
import VmsRearrangeButton from "./VmsRearrangeButton";
import RearrangeModal, { type ArrangementField } from "./RearrangeModal";
import { useVmsScreenshots } from "./useVmsScreenshots";
import { useBlobPreview } from "./useBlobPreview";
import { type ICms } from "@shared/types/cmsCreate";
import type { ExistingCmsPreview } from "./api";

interface Props {
  formik: ClaimForm<ICms>;
  feedId: string;
  sideImages: File[];
  setSideImages: (files: File[]) => void;
  /** When true, the Rearrange modal is kept closed even if VMS auto-open
   *  fires — used by AJIO to prevent stacking with the SKU picker. */
  blockRearrangeOpen?: boolean;
  /** /cms/update: existing claim record. When present, we render its image
   *  URLs as previews instead of hitting VMS (which is gated off in update
   *  mode inside useVmsScreenshots). */
  existingClaim?: ExistingCmsPreview | null;
  /** URLs handed down by CreateCms after a platform switch on /cms/update;
   *  forwarded to useVmsScreenshots so its Rearrange pool auto-opens with
   *  the carried-over shots from the previous platform. */
  carryOverImages?: string[];
}

const MAX_SIDE_SLOTS = 9;

// Slot schema for the rearrange modal: first = Return Product, middle 1..9 =
// Product Side Images, then POD Proof, last = Forward Sent Product.
const buildSchema = (): ArrangementField[] => [
  { fieldName: "returnProductImage", label: "Return Product", position: "first" },
  ...Array.from({ length: MAX_SIDE_SLOTS }, (_, i) => ({
    fieldName: `sideImages_${i}`,
    label: `Side ${i + 1}`,
    position: "middle" as const,
  })),
  { fieldName: "podProof", label: "POD Proof", position: "middle" },
  {
    fieldName: "forwardSentProductImage",
    label: "Forward Sent",
    position: "last",
  },
];

/**
 * Right-column content shared by Ajio, Nykaa, Amazon and Shopify.
 * Mirrors TrackVid-App/src/renderer/src/components/cms/RightPart.tsx:
 * Return Product Image + Forward Sent Product Image (stacked),
 * Six-Side Product Images, POD Proof + Additional Field (stacked).
 */
const CommonRightPart = ({ formik, feedId, sideImages, setSideImages, blockRearrangeOpen, existingClaim, carryOverImages }: Props) => {
  // Gate the "existing PDF stored" hint to the /cms/update page only —
  // the duplicate-AWB flow on /cms/create can also hydrate `existingClaim`
  // but the operator there is landing on a create surface, so the hint
  // would be misleading. CommonRightPart is only mounted by AjioForm /
  // NykaaForm (the only two platforms that generate the six-side PDF), so
  // it's already scoped away from Myntra / Delhivery / Xbees / Snapdeal /
  // Meesho / Flipkart / Amazon / TataCliQ.
  const { isUpdateMode: isUpdateModePath } = useClaimFormMode();
  // `undefined` alongside `null` because this is read by slot name and a slot
  // nobody has filled is simply absent. See FileInput's `preview` prop.
  const [previews, setPreviews] = useState<{ [key: string]: string | null | undefined }>({
    returnProductImage: null,
    forwardSentProductImage: null,
    podProof: null,
    additionalFieldValue: null,
  });

  const [captureOpen, setCaptureOpen] = useState<{ open: boolean; index: number | null }>({
    open: false,
    index: null,
  });
  const currType = useRef<string>("");

  const handleFilePreviewChange = (name: string, file: File | null) => {
    setPreviews((prev) => ({
      ...prev,
      [name]: file ? URL.createObjectURL(file) : null,
    }));
  };

  // /cms/update hydration: seed the preview slots from the loaded claim's
  // stored URLs once per claim id, so the operator sees the images that are
  // actually on the CMS row (not fresh VMS captures — which are gated off in
  // update mode). Guarded by a ref so subsequent edits (manual re-upload,
  // Rearrange) aren't clobbered by a re-render.
  //
  // We also write the fileKey back into formik. Nykaa (and other bundle-less
  // platforms rendering CommonRightPart) require returnProductImage in their
  // Yup schema — leaving formik empty means the moment ANYTHING marks the
  // field touched (a Save click, a validate-on-blur elsewhere, a
  // formik.validateForm anywhere), `error` flips true and FileInput's render
  // logic (`(!preview || error) && children`) hides the hydrated preview,
  // making the image *appear* to have been removed even though `previews.*`
  // still holds the URL. Writing the fileKey keeps the value truthy so
  // validation passes and the img stays visible. The BE update endpoint
  // (updateCMS) doesn't accept image fields, so the fileKey never round-trips
  // — this is a pure client-side validation guard.
  // Local seed for the Rearrange pool — merged into vms.fetchedScreenshots
  // below via a companion effect. Kept in local state (instead of writing
  // directly into vms.setFetchedScreenshots) so the merge survives VMS
  // auto-fetch overwriting the pool.
  //
  // DECLARED ABOVE THE EFFECT THAT WRITES IT: a setter read before its
  // declaration cannot be updated when it changes, and the hydration effect
  // just below seeds the pool from the loaded claim.
  const [poolSeed, setPoolSeed] = useState<string[]>([]);

  const hydratedClaimIdRef = useRef<string | null>(null);
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || hydratedClaimIdRef.current === claimId) return;
    hydratedClaimIdRef.current = claimId;
    const returnUrl = existingClaim?.returnProductImage || "";
    const forwardUrl = existingClaim?.forwardSentProductImage || "";
    const podUrl = existingClaim?.podProof || "";
    setPreviews((prev) => ({
      ...prev,
      returnProductImage: returnUrl || prev.returnProductImage,
      forwardSentProductImage: forwardUrl || prev.forwardSentProductImage,
      podProof: podUrl || prev.podProof,
    }));
    // fromNested() on the BE returns a plain S3 URL of the form
    // `https://<host>/<bucket>/<fileKey>` — no query string — so the last
    // path segment IS the fileKey. `split('/').pop()` matches the extraction
    // used everywhere else this pattern is applied (populate(), applyArranged()).
    const extractKey = (u: string) => u.split("/").pop() || "";
    if (returnUrl && !formik.values.returnProductImage) {
      formik.setFieldValue("returnProductImage", extractKey(returnUrl));
    }
    if (forwardUrl && !formik.values.forwardSentProductImage) {
      formik.setFieldValue("forwardSentProductImage", extractKey(forwardUrl));
    }
    if (podUrl && !formik.values.podProof) {
      formik.setFieldValue("podProof", extractKey(podUrl));
    }
    // Also seed the Rearrange pool with the hydrated URLs so an accidental
    // clear (or a Rearrange save that dropped a slot) can be recovered by
    // reopening the modal — the URLs are still in `fetchedScreenshots` for
    // drag-back into a slot.
    const hydratedUrls = [returnUrl, forwardUrl, podUrl].filter(
      (u): u is string => Boolean(u),
    );
    if (hydratedUrls.length > 0) {
      setPoolSeed((prev) => {
        const seen = new Set(prev);
        const next = [...prev];
        for (const u of hydratedUrls) {
          if (!seen.has(u)) {
            seen.add(u);
            next.push(u);
          }
        }
        return next;
      });
    }
  }, [existingClaim, formik]);

  // VMS side URLs are tracked in a LOCAL state so the modal's initialSlotImages
  // reflect them within the same render cycle as populate() runs — the parent
  // `sideImages` prop can lag by one commit when populate + open-modal are
  // batched, which was leaving the modal's middle slots empty.
  const [vmsSideUrls, setVmsSideUrls] = useState<string[]>([]);

  const manualSideFiles = useMemo(
    () =>
      (sideImages as unknown as (File | string)[]).filter(
        (img): img is File => typeof img !== "string",
      ),
    [sideImages],
  );

  // Manual side uploads live as `File` objects in `sideImages`; the modal
  // needs displayable URLs. Track blob URLs per File so previews stay stable
  // across renders and get revoked when the File leaves the list.
  const blobs = useBlobPreview();
  const fileToUrlRef = useRef<Map<File, string>>(new Map());
  const urlToFileRef = useRef<Map<string, File>>(new Map());
  const [sideImagesUrls, setSideImagesUrls] = useState<string[]>([]);

  useEffect(() => {
    const activeFiles = new Set<File>();
    const urls: string[] = [];
    (sideImages as unknown as (File | string)[]).forEach((img) => {
      if (typeof img === "string") {
        urls.push(img);
        return;
      }
      activeFiles.add(img);
      let url = fileToUrlRef.current.get(img);
      if (!url) {
        url = blobs.createObjectURL(img);
        fileToUrlRef.current.set(img, url);
        urlToFileRef.current.set(url, img);
      }
      urls.push(url);
    });
    // Revoke URLs whose Files were removed from the list.
    fileToUrlRef.current.forEach((url, file) => {
      if (!activeFiles.has(file)) {
        blobs.release(url);
        urlToFileRef.current.delete(url);
        fileToUrlRef.current.delete(file);
      }
    });
    setSideImagesUrls(urls);
  }, [sideImages, blobs]);

  const schema = useMemo(() => buildSchema(), []);
  const imageFields = useMemo(() => schema.map((s) => s.fieldName), [schema]);

  // Build the fieldName -> preview URL map (for modal seed + pool). Side
  // slots reflect the union of VMS-derived URLs and manual uploads; when a
  // VMS fetch has replaced sideImages we prefer that arrangement, otherwise
  // we fall back to the raw sideImagesUrls so manual-only uploads still show.
  const slotPreviews = useMemo(() => {
    const map: Record<string, string | null> = {
      returnProductImage: previews.returnProductImage ?? null,
      forwardSentProductImage: previews.forwardSentProductImage ?? null,
      podProof: previews.podProof ?? null,
    };
    const sideSlot = sideImagesUrls.length > 0 ? sideImagesUrls : vmsSideUrls;
    sideSlot.forEach((url, i) => {
      if (i < MAX_SIDE_SLOTS) map[`sideImages_${i}`] = url;
    });
    return map;
  }, [
    previews.returnProductImage,
    previews.forwardSentProductImage,
    previews.podProof,
    vmsSideUrls,
    sideImagesUrls,
  ]);

  const populate = (screenshots: string[]) => {
    // 1st -> Return Product; last -> Forward Sent; middle -> side slots.
    const first = screenshots[0];
    const last = screenshots.length > 1 ? screenshots[screenshots.length - 1] : "";
    const middle =
      screenshots.length > 2 ? screenshots.slice(1, -1) : [];

    if (first) {
      setPreviews((prev) => ({ ...prev, returnProductImage: first }));
      formik.setFieldValue("returnProductImage", first.split("/").pop());
    }
    if (last) {
      setPreviews((prev) => ({ ...prev, forwardSentProductImage: last }));
      formik.setFieldValue("forwardSentProductImage", last.split("/").pop());
    }
    const capped = middle.slice(0, MAX_SIDE_SLOTS);
    setVmsSideUrls(capped);
    setSideImages([
      ...(capped as unknown as File[]),
      ...manualSideFiles,
    ]);
  };

  const reset = () => {
    setPreviews((prev) => ({
      ...prev,
      returnProductImage: null,
      forwardSentProductImage: null,
      podProof: null,
    }));
    formik.setFieldValue("returnProductImage", "");
    formik.setFieldValue("forwardSentProductImage", "");
    setVmsSideUrls([]);
    setSideImages(manualSideFiles);
  };

  const vms = useVmsScreenshots({
    awb: formik.values.AWBNumber,
    // Forward-AWB screenshots surface only in the Rearrange pool (no slot
    // placement, no auto-open) — see useVmsScreenshots.
    forwardAwb: formik.values.forwardAWB,
    previews: slotPreviews,
    imageFields,
    populate,
    reset,
    carryOverImages,
    // AJIO / Nykaa / Shopify silently backfill the Product Side Images grid
    // from the carry-over pool (see effect below) instead of popping the
    // Rearrange modal on every platform switch — the operator can still
    // open it manually via the "Rearrange Images" button if they need to.
    openModalOnCarryOver: false,
    // While the AJIO SKU picker is open (parent-owned `blockRearrangeOpen`)
    // the operator must resolve SKU disambiguation FIRST. Defer every VMS
    // auto-action — populate, reset, Rearrange modal auto-open — until
    // they close the picker. The hook caches the deferred payload and
    // applies it the moment the picker closes.
    deferAutoActions: blockRearrangeOpen,
  });

  // Merge the hydration-seeded URLs into the Rearrange pool. Kept as a
  // separate effect (instead of writing inline during hydration) so a later
  // VMS auto-fetch — which calls setFetchedScreenshots(shots) and would
  // otherwise wipe the seed — doesn't strand the hydrated URLs. Idempotent:
  // re-fires only when the seed grows or the pool actually changes, and
  // dedups on both sides so the same URL never doubles. `vms` object itself
  // is a new reference each render (custom hook return) so we deliberately
  // depend on the primitives / stable setters instead of the whole object.
  const vmsSetFetchedScreenshots = vms.setFetchedScreenshots;
  const vmsFetchedScreenshots = vms.fetchedScreenshots;
  useEffect(() => {
    if (poolSeed.length === 0) return;
    const missing = poolSeed.filter((u) => !vmsFetchedScreenshots.includes(u));
    if (missing.length === 0) return;
    vmsSetFetchedScreenshots([...vmsFetchedScreenshots, ...missing]);
  }, [poolSeed, vmsFetchedScreenshots, vmsSetFetchedScreenshots]);

  // Silent backfill: any URL that shows up in the Rearrange pool
  // (`vms.fetchedScreenshots`) and isn't already occupying a top-level slot
  // or a side-grid slot gets appended to the free tail of the Product Side
  // Images grid. Covers both entry points into the pool: VMS auto-fetch
  // (fires on /cms/update too now — the hook seeds fetchedScreenshots
  // without opening the modal) and the platform-switch carry-over
  // (`carryOverImages`, which useVmsScreenshots merges into fetchedScreenshots
  // when `openModalOnCarryOver: false`).
  //
  // Bounded by MAX_SIDE_SLOTS (9). Existing filled side slots are preserved,
  // so an operator's manual picks or captures aren't stomped. Dedup against
  // string entries in `current` prevents the effect from re-adding a URL it
  // just appended when the sideImages state change re-triggers the effect.
  useEffect(() => {
    // On /cms/update with a stored six-side PDF the grid MUST start empty and
    // stay empty until the operator explicitly picks new images (via Rearrange
    // or Upload/Capture) — otherwise the update path (see useCreateCmsForm)
    // treats the auto-populated tiles as "new files" and either re-uploads a
    // stale PDF or trips the min-3 validator when only 1-2 shots came back.
    // The stored PDF is shown as a single "View PDF" tile by SixSideImagesInput.
    if (isUpdateModePath && existingClaim?.sixSideImages) return;
    // SKU picker takes priority — no side-image mutation until the operator
    // resolves it. When they close it, the effect re-fires (blockRearrangeOpen
    // is in the dep list below) and the backfill applies against the
    // then-current pool.
    if (blockRearrangeOpen) return;

    const pool = vms.fetchedScreenshots;
    if (!pool || pool.length === 0) return;
    const current = (sideImages as unknown as (File | string)[]) || [];
    const filledCount = current.filter(Boolean).length;
    const room = MAX_SIDE_SLOTS - filledCount;
    if (room <= 0) return;
    // Also exclude URLs that BELONG to the top-level slots on the loaded
    // claim, even if `previews.*` hasn't been updated yet — VMS auto-fetch
    // can resolve before the hydration effect above sets those preview
    // slots, so a race was silently duplicating the Return / Forward /
    // POD image into the Product Side Images grid.
    const inSlots = new Set<string>(
      [
        previews.returnProductImage,
        previews.forwardSentProductImage,
        previews.podProof,
        existingClaim?.returnProductImage,
        existingClaim?.forwardSentProductImage,
        existingClaim?.podProof,
        ...current.filter((v): v is string => typeof v === "string"),
      ].filter((v): v is string => Boolean(v)),
    );
    const toAdd = pool.filter((u) => u && !inSlots.has(u)).slice(0, room);
    if (toAdd.length === 0) return;
    setSideImages([...(current as any[]), ...(toAdd as any[])] as unknown as File[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    vms.fetchedScreenshots,
    previews.returnProductImage,
    previews.forwardSentProductImage,
    previews.podProof,
    existingClaim?.returnProductImage,
    existingClaim?.forwardSentProductImage,
    existingClaim?.podProof,
    // Included so a claim swap on /cms/update (e.g. AWB change re-hydrates a
    // different existingClaim) re-evaluates the "has stored PDF" guard.
    existingClaim?.sixSideImages,
    isUpdateModePath,
    // Backfill deferred until the SKU picker closes (see early-return above).
    blockRearrangeOpen,
  ]);

  const applyArranged = (arranged: string[]) => {
    // arranged is in schema order: [returnProductImage, side_0..8, podProof, forwardSentProductImage]
    const first = arranged[0] || "";
    const last = arranged[arranged.length - 1] || "";
    const podUrl = arranged[arranged.length - 2] || "";
    const middle = arranged
      .slice(1, arranged.length - 2)
      .filter((v): v is string => Boolean(v));

    setPreviews((prev) => ({
      ...prev,
      returnProductImage: first || null,
      forwardSentProductImage: last || null,
      podProof: podUrl || prev.podProof,
    }));
    formik.setFieldValue("returnProductImage", first ? first.split("/").pop() : "");
    formik.setFieldValue("forwardSentProductImage", last ? last.split("/").pop() : "");
    if (podUrl) formik.setFieldValue("podProof", podUrl.split("/").pop());

    // Preserve orphans in the fetchedScreenshots pool for future rearranges.
    // Skip manual (blob-URL) entries — they aren't valid VMS screenshots.
    const merged = new Set<string>([
      ...vms.fetchedScreenshots,
      ...vmsSideUrls,
      ...arranged.filter(
        (u) => Boolean(u) && !urlToFileRef.current.has(u),
      ),
    ]);
    vms.setFetchedScreenshots(Array.from(merged));

    // Split arranged side URLs back into (a) VMS URLs (strings) and (b)
    // manual File references, preserving the arranged order in sideImages so
    // the six-side grid + next open of the modal reflect the new layout.
    const cappedMiddle = middle.slice(0, MAX_SIDE_SLOTS);
    const newVmsUrls: string[] = [];
    const newSideMixed: (File | string)[] = cappedMiddle.map((url) => {
      const file = urlToFileRef.current.get(url);
      if (file) return file;
      newVmsUrls.push(url);
      return url;
    });
    setVmsSideUrls(newVmsUrls);
    setSideImages(newSideMixed as unknown as File[]);
  };

  const openCaptureFor = (type: string) => {
    currType.current = type;
    setCaptureOpen({ open: true, index: type === "sideImages" ? 0 : null });
  };

  const handleSideImageCameraClick = (
    _e: React.MouseEvent<HTMLButtonElement>,
    _index: number,
    imgType?: string,
  ) => {
    openCaptureFor(imgType || "sideImages");
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Show whenever the pool has anything to reshuffle: VMS-fetched shots
          (create flow), manual uploads (create flow), or existing-claim images
          hydrated on /cms/update. Gating on fetchedScreenshots alone hid the
          button in update mode where the operator most needs it to reset a
          slot. */}
      <VmsRearrangeButton
        show={vms.rearrangeImagePool.length > 0}
        onClick={() => vms.setRearrangeModalOpen(true)}
      />
      {/* Return + Forward Product Images (paired) */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr" },
          gap: "12px",
        }}
      >
        <Box>
          <Typography sx={{ mb: "6px", fontSize: 13 }}>
            Return Product Image <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <FileInput
            name="returnProductImage"
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="110px"
            width="100%"
            preview={previews.returnProductImage}
            onFileChange={handleFilePreviewChange}
            error={!!(formik.touched.returnProductImage && formik.errors.returnProductImage)}
          >
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "text.secondary" }}>
              <InsertPhotoOutlined fontSize="medium" />
              <Typography variant="caption">Upload</Typography>
            </Box>
          </FileInput>
          {formik.touched.returnProductImage && formik.errors.returnProductImage && (
            <FormHelperText error>{formik.errors.returnProductImage as string}</FormHelperText>
          )}
        </Box>

        <Box>
          <Typography sx={{ mb: "6px", fontSize: 13 }}>Forward Sent Product Image</Typography>
          <FileInput
            name="forwardSentProductImage"
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="110px"
            width="100%"
            preview={previews.forwardSentProductImage}
            onFileChange={handleFilePreviewChange}
            error={!!formik.errors.forwardSentProductImage}
          >
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "text.secondary" }}>
              <InsertPhotoOutlined fontSize="medium" />
              <Typography variant="caption">Upload</Typography>
            </Box>
          </FileInput>
        </Box>
      </Box>

      {/* Six-Side Images */}
      <Box>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <Typography sx={{ fontSize: 13 }}>
            Product Side Images <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
          </Typography>
          <FormHelperText
            error={!!(formik.touched.sideImages && formik.errors.sideImages)}
            sx={{ m: 0, fontSize: 11 }}
          >
            Min 3 · Max 9
          </FormHelperText>
        </Box>
        <SixSideImagesInput
          handleCameraClick={handleSideImageCameraClick}
          sideImages={sideImages}
          setSideImages={setSideImages}
          // Only forward the stored PDF URL on the dedicated /cms/update
          // surface — the create-page duplicate-AWB flow hydrates
          // existingClaim too, but the operator there is landing on a create
          // surface and a "View PDF" tile would be misleading. Only reaches
          // the grid at all for Ajio / Nykaa (the two platforms that mount
          // CommonRightPart / generate the six-side PDF).
          existingPdfUrl={
            isUpdateModePath && existingClaim?.sixSideImages
              ? existingClaim.sixSideImages
              : undefined
          }
        />
        {formik.touched.sideImages && formik.errors.sideImages && (
          <FormHelperText error>{formik.errors.sideImages as string}</FormHelperText>
        )}
      </Box>

      {/* POD Proof + Additional Field (paired) */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: "12px",
        }}
      >
        <Box>
          <Typography sx={{ mb: "6px", fontSize: 13 }}>POD Proof</Typography>
          <FileInput
            name="podProof"
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="110px"
            width="100%"
            preview={previews.podProof}
            onFileChange={handleFilePreviewChange}
            error={!!formik.errors.podProof}
            disableCapture
          >
            <Box sx={{ display: "flex", alignItems: "center", color: "primary.main", gap: "6px" }}>
              <PictureAsPdfOutlined fontSize="small" />
              <Typography variant="caption" fontWeight="bold">PDF</Typography>
              <Typography variant="caption">/</Typography>
              <InsertPhotoOutlined fontSize="small" />
              <Typography variant="caption" fontWeight="bold">JPEG</Typography>
            </Box>
          </FileInput>
        </Box>

        <Box>
          <Typography sx={{ mb: "6px", fontSize: 13 }}>Additional Field</Typography>
          <TextField
            name="additionalFieldTitle"
            placeholder="Enter title"
            size="small"
            fullWidth
            value={formik.values.additionalFieldTitle}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            error={!!(formik.touched.additionalFieldTitle && formik.errors.additionalFieldTitle)}
            helperText={
              formik.touched.additionalFieldTitle && (formik.errors.additionalFieldTitle as string)
            }
            sx={{ mb: "6px" }}
          />
          <FileInput
            name="additionalFieldValue"
            feedId={feedId}
            setFieldValue={formik.setFieldValue}
            setFieldTouched={formik.setFieldTouched}
            height="56px"
            width="100%"
            preview={previews.additionalFieldValue}
            onFileChange={handleFilePreviewChange}
            error={!!(formik.touched.additionalFieldValue && formik.errors.additionalFieldValue)}
            disableCapture
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: "6px", color: "primary.main" }}>
              <InsertDriveFileOutlined fontSize="small" />
              <Typography variant="caption" fontWeight="bold">Add File</Typography>
            </Box>
          </FileInput>
        </Box>
      </Box>

      <CaptureImages
        open={captureOpen}
        handleClose={() => setCaptureOpen({ open: false, index: null })}
        handleFilePreviewChange={handleFilePreviewChange}
        setFieldValue={formik.setFieldValue}
        setFieldTouched={formik.setFieldTouched}
        currType={currType}
        feedId={feedId}
        setSideImages={setSideImages}
        sideImages={sideImages}
      />

      <RearrangeModal
        open={vms.rearrangeModalOpen && !blockRearrangeOpen}
        onClose={() => vms.setRearrangeModalOpen(false)}
        onSave={applyArranged}
        images={vms.rearrangeImagePool}
        initialSlotImages={vms.rearrangeInitialSlots}
        schema={schema}
        title="Rearrange Product Screenshots"
      />
    </Box>
  );
};

export default CommonRightPart;
