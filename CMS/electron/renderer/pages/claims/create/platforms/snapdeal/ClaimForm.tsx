import { Box, CircularProgress, FormHelperText, InputAdornment, TextField, Typography } from "@mui/material";
import { InsertPhotoOutlined } from "../../icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../../toast";
import { debounceAsync } from "../../debounce";
import { lookupSnapdealAwb } from "@renderer/services/snapdealBackup.service";
import FileInput from "../../media/FileInput";
import LeftVideos from "../../LeftVideos";
import VmsRearrangeButton from "../../VmsRearrangeButton";
import RearrangeModal, { type ArrangementField } from "../../RearrangeModal";
import { useVmsScreenshots } from "../../useVmsScreenshots";
import { useCmsAutoFetch } from "../../useCmsAutoFetch";
import { useBlobPreview } from "../../useBlobPreview";
import { type ICms } from "@shared/types/cmsCreate";
import { type PlatformFormProps } from "../ajio/ClaimForm";
import PlatformAccountDropdown from "../../PlatformAccountDropdown";
import { usePlatformAccountAutoSelect } from "../../usePlatformAccountAutoSelect";

const IMAGE_SLOTS: { name: keyof ICms; label: string; required: boolean }[] = [
  { name: "outerPackageImage_1", label: "Outer Package Image 1", required: true },
  { name: "outerPackageImage_2", label: "Outer Package Image 2", required: false },
  { name: "innerPackageImage_1", label: "Inner Package Image 1", required: true },
  { name: "innerPackageImage_2", label: "Inner Package Image 2", required: false },
  { name: "productImage_1", label: "Product Image 1", required: true },
  { name: "productImage_2", label: "Product Image 2", required: false },
  { name: "podImage_1", label: "POD Image 1", required: true },
  { name: "podImage_2", label: "POD Image 2", required: false },
];

/** Worth asking the saved report about — anything shorter is still being typed. */
const AWB_SHAPE = /^[A-Za-z0-9-]{6,40}$/;

type AwbSide = "return" | "forward";

const SNAPDEAL_SCHEMA: ArrangementField[] = [
  { fieldName: "outerPackageImage_1", label: "Outer Package 1", position: "first" },
  { fieldName: "outerPackageImage_2", label: "Outer Package 2", position: "middle" },
  { fieldName: "innerPackageImage_1", label: "Inner Package 1", position: "middle" },
  { fieldName: "innerPackageImage_2", label: "Inner Package 2", position: "middle" },
  { fieldName: "productImage_1", label: "Product Image 1", position: "middle" },
  { fieldName: "productImage_2", label: "Product Image 2", position: "middle" },
  { fieldName: "podImage_1", label: "POD Image 1", position: "middle" },
  { fieldName: "podImage_2", label: "POD Image 2", position: "last" },
];

/**
 * Snapdeal form ported from TrackVid-App/src/renderer/src/pages/SnapdealCMS.tsx.
 * Left: AWB / forward AWB / suborder / videos. Right: 8-slot image grid.
 * Deferred: VMS rearrange, sub-order auto-fill.
 */
const SnapdealForm = ({ formik, feedId, isPartialArticleClaim, side, carryOverImages, existingClaim }: PlatformFormProps) => {
  const blobs = useBlobPreview();
  const [videoPreviews, setVideoPreviews] = useState<{
    returnVideo: string | null;
    forwardVideo: string | null;
  }>({ returnVideo: null, forwardVideo: null });

  const [imagePreviews, setImagePreviews] = useState<Record<string, string | null>>({
    outerPackageImage_1: null,
    outerPackageImage_2: null,
    innerPackageImage_1: null,
    innerPackageImage_2: null,
    productImage_1: null,
    productImage_2: null,
    podImage_1: null,
    podImage_2: null,
  });

  const imageFields = useMemo(() => IMAGE_SLOTS.map((s) => s.name as string), []);

  // /cms/update: seed the 8 Snapdeal image previews from the loaded claim.
  // BE (findCmsByAwb) returns each slot as `{ fileKey, url }` (withUrl shape),
  // so we drop the `.url` straight into preview state and write the `.fileKey`
  // back into formik so an Update submit re-sends the S3 keys unchanged when
  // the operator doesn't touch the slots. Guarded by a claim-id ref so
  // subsequent uploads / rearranges aren't clobbered on re-render.
  const snapdealHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || snapdealHydratedRef.current === claimId) return;
    snapdealHydratedRef.current = claimId;

    imageFields.forEach((field) => {
      const entry = (existingClaim as any)?.[field];
      if (!entry || !entry.url) return;
      setImagePreviews((prev) => ({ ...prev, [field]: entry.url }));
      if (entry.fileKey) formik.setFieldValue(field, entry.fileKey);
    });

    // Defensive: seed the Snapdeal account username. See MeeshoForm's
    // matching effect for the rationale.
    const storedAccount =
      typeof existingClaim?.snapdeal_account_username === "string"
        ? existingClaim.snapdeal_account_username.trim()
        : "";
    if (
      storedAccount &&
      !(formik.values.snapdeal_account_username as string | undefined)
    ) {
      formik.setFieldValue("snapdeal_account_username", storedAccount);
    }
  }, [existingClaim, formik, imageFields]);

  const populate = (screenshots: string[]) => {
    imageFields.forEach((field, index) => {
      const image = screenshots[index];
      if (image) {
        setImagePreviews((prev) => {
          blobs.release(prev[field]);
          return { ...prev, [field]: image };
        });
        formik.setFieldValue(field, image.split("/").pop());
      }
    });
  };

  const reset = () => {
    imageFields.forEach((field) => {
      setImagePreviews((prev) => {
        blobs.release(prev[field]);
        return { ...prev, [field]: null };
      });
      formik.setFieldValue(field, "");
    });
  };

  const applyArranged = (arranged: string[]) => {
    imageFields.forEach((field, index) => {
      const image = arranged[index];
      setImagePreviews((prev) => {
        blobs.release(prev[field]);
        return { ...prev, [field]: image || null };
      });
      formik.setFieldValue(field, image ? image.split("/").pop() : "");
    });
    const merged = new Set<string>([
      ...vms.fetchedScreenshots,
      ...imageFields
        .map((f) => imagePreviews[f])
        .filter((v): v is string => Boolean(v)),
      ...arranged.filter(Boolean),
    ]);
    vms.setFetchedScreenshots(Array.from(merged));
  };

  const vms = useVmsScreenshots({
    carryOverImages,
    awb: formik.values.AWBNumber,
    // Forward-AWB shots surface only in the Rearrange pool (no slot placement).
    forwardAwb: formik.values.forwardAWB,
    previews: imagePreviews,
    imageFields,
    populate,
    reset,
  });

  const auto = useCmsAutoFetch({
    formik,
    isSnapdeal: true,
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

  // Account Username dropdown auto-select on AWB settle. Snapdeal stores the
  // account under `snapdeal_account_username`; the BE looks it up in
  // SnapdealMasterImport.
  const accountAuto = usePlatformAccountAutoSelect({
    platform: "snapdeal",
    // The AWB survives a platform switch, so the hook can re-look-up for the
    // new platform instead of leaving its account blank.
    awb: (formik.values.AWBNumber as string) || "",
    currentValue: (formik.values.snapdeal_account_username as string) || "",
    onResolve: (account) =>
      formik.setFieldValue("snapdeal_account_username", account),
  });

  /*
   * EITHER AWB → THE REST, from the saved Snapdeal return report.
   *
   * The report backup (`snapdeal-backup-return`) holds the return AWB, forward
   * AWB, sub-order and SKU of every return it collected, so whichever AWB is
   * typed, the other three come from the same row. Local and exact — no
   * Snapdeal call — and quiet about a miss beyond one line, because the backup
   * only covers the windows that were collected.
   *
   * Filled through the same handlers as typing, so the videos, screenshots and
   * account lookup follow. Refs for what the debounced callback reads: it is
   * built once and would otherwise see the first render's form forever.
   */
  const [lookingUp, setLookingUp] = useState<AwbSide | null>(null);
  const lookupSeqRef = useRef(0);
  const formikRef = useRef(formik);
  formikRef.current = formik;
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const accountAutoRef = useRef(accountAuto);
  accountAutoRef.current = accountAuto;

  const fillFromReport = useMemo(
    () =>
      debounceAsync(async (awb: string, side: AwbSide) => {
        const seq = ++lookupSeqRef.current;

        setLookingUp(side);
        const response = await lookupSnapdealAwb(awb, side);
        // Something else was typed since — this answer is stale.
        if (seq !== lookupSeqRef.current) return;
        setLookingUp(null);

        if (!response.success) {
          toast.error(response.error.message);
          return;
        }

        const record = response.data;

        if (!record) {
          toast.info(`${awb} is not in the saved Snapdeal report`);
          return;
        }

        const form = formikRef.current;
        const values = form.values;
        const same = (current: unknown, next: string) =>
          (typeof current === "string" ? current.trim() : "") === next;
        const filled: string[] = [];

        if (side === "forward" && record.reverseAwb && !same(values.AWBNumber, record.reverseAwb)) {
          autoRef.current.onReturnAwbChange(record.reverseAwb);
          accountAutoRef.current.onReturnAwb(record.reverseAwb);
          filled.push("return AWB");
        }
        if (side === "return" && record.awb && !same(values.forwardAWB, record.awb)) {
          autoRef.current.onForwardAwbChange(record.awb);
          accountAutoRef.current.onForwardAwb(record.awb);
          filled.push("forward AWB");
        }
        if (record.subOrderCode && !same(values.subOrderNumber, record.subOrderCode)) {
          autoRef.current.onSubOrderChange(record.subOrderCode);
          filled.push("sub-order");
        }
        if (record.sku && !same(values.skuName, record.sku)) {
          void form.setFieldValue("skuName", record.sku);
          filled.push("SKU");
        }

        toast.success(
          filled.length > 0
            ? `Filled ${filled.join(", ")} from the saved Snapdeal report`
            : `${awb} matches the saved Snapdeal report`,
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

  const handleImagePreview = (name: string, file: File | null) => {
    setImagePreviews((prev) => {
      blobs.release(prev[name]);
      return {
        ...prev,
        [name]: file ? blobs.createObjectURL(file) : null,
      };
    });
  };

  if (side === "left") {
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
            />
          </Box>
        )}

        {/* Account Username on its own row, above the AWB row. */}
        <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "5px" }}>
          <Typography>Snapdeal Account Username</Typography>
          <PlatformAccountDropdown
            platform="snapdeal"
            label=""
            value={(formik.values.snapdeal_account_username as string) || ""}
            onChange={(v) =>
              formik.setFieldValue("snapdeal_account_username", v)
            }
          />
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", marginBottom: 3 }}>
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
                onAwbTyped(e.target.value, "return");
              }}
              onBlur={formik.handleBlur}
              error={!!(formik.touched.AWBNumber && formik.errors.AWBNumber)}
              helperText={formik.touched.AWBNumber && (formik.errors.AWBNumber as string)}
              slotProps={lookupSpinner("return")}
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
                onAwbTyped(e.target.value, "forward");
              }}
              onBlur={formik.handleBlur}
              slotProps={lookupSpinner("forward")}
            />
          </Box>
          <Box sx={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "5px" }}>
            <Typography>Suborder Number</Typography>
            <TextField
              name="subOrderNumber"
              placeholder="Enter Suborder Number"
              size="small"
              fullWidth
              value={formik.values.subOrderNumber}
              onChange={(e) => auto.onSubOrderChange(e.target.value)}
              onBlur={formik.handleBlur}
            />
          </Box>
          <Box sx={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "5px" }}>
            <Typography>SKU</Typography>
            <TextField
              name="skuName"
              placeholder="Enter SKU (optional)"
              size="small"
              fullWidth
              value={formik.values.skuName ?? ""}
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
      </>
    );
  }

  // side === "right" — the 8-slot image grid, 2 per row
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <VmsRearrangeButton
        show={vms.fetchedScreenshots.length > 0 || vms.forwardOnlyScreenshots.length > 0}
        onClick={() => vms.setRearrangeModalOpen(true)}
      />
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
      {IMAGE_SLOTS.map((slot) => {
        const err =
          formik.touched[slot.name as keyof typeof formik.touched] &&
          (formik.errors as any)[slot.name];
        return (
          <Box
            key={slot.name}
            sx={{ flex: "1 1 calc(50% - 0.5rem)", display: "flex", flexDirection: "column", gap: "5px" }}
          >
            <Typography sx={{ fontSize: 13 }}>
              {slot.label}
              {slot.required && <span style={{ color: "var(--mui-palette-error-main)" }}> *</span>}
            </Typography>
            <FileInput
              name={slot.name as string}
              feedId={feedId}
              setFieldValue={formik.setFieldValue}
              setFieldTouched={formik.setFieldTouched}
              height="130px"
              width="100%"
              preview={imagePreviews[slot.name as string]}
              onFileChange={handleImagePreview}
              error={!!err}
            >
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "text.secondary" }}>
                <InsertPhotoOutlined fontSize="large" />
                <Typography variant="caption">Upload</Typography>
              </Box>
            </FileInput>
            {err && <FormHelperText error>{err as string}</FormHelperText>}
          </Box>
        );
      })}
      </Box>

      <RearrangeModal
        open={vms.rearrangeModalOpen}
        onClose={() => vms.setRearrangeModalOpen(false)}
        onSave={applyArranged}
        images={vms.rearrangeImagePool}
        initialSlotImages={vms.rearrangeInitialSlots}
        schema={SNAPDEAL_SCHEMA}
        title="Rearrange Product Screenshots"
      />
    </Box>
  );
};

export default SnapdealForm;
