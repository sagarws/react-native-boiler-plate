import {
  Autocomplete,
  Box,
  FormHelperText,
  TextField,
  Typography,
} from "@mui/material";
import { InsertPhotoOutlined } from "../../icons";
import { useEffect, useMemo, useRef, useState } from "react";
import FileInput from "../../media/FileInput";
import LeftVideos from "../../LeftVideos";
import VmsRearrangeButton from "../../VmsRearrangeButton";
import RearrangeModal, { type ArrangementField } from "../../RearrangeModal";
import { useVmsScreenshots } from "../../useVmsScreenshots";
import { useCmsAutoFetch } from "../../useCmsAutoFetch";
import { useBlobPreview } from "../../useBlobPreview";
import { type PlatformFormProps } from "../ajio/ClaimForm";
import PlatformAccountDropdown from "../../PlatformAccountDropdown";

const MEESHO_SCHEMA: ArrangementField[] = [
  { fieldName: "barcodeImage", label: "Barcode Image", position: "first" },
  { fieldName: "receivedProductImage_1", label: "Received Image 1", position: "middle" },
  { fieldName: "reverseWayBillImage", label: "Reverse Way Bill", position: "last" },
];

const MEESHO_IMAGE_FIELDS = ["barcodeImage", "receivedProductImage_1", "reverseWayBillImage"];

const LOGISTICS_PARTNER_OPTIONS = [
  "Delhivery",
  "Bluedart",
  "Ecom",
  "Xpressbees",
  "Shadowfax",
  "Valmo",
];

const POD_CLAIM_LABEL =
  "Return/RTO product not received but marked delivered - Need Proof of Delivery";

const STATE_OF_PACKET_OPTIONS = [
  { id: "1", label: "Intact" },
  { id: "2", label: "Tampered" },
];

/**
 * Meesho form ported from TrackVid-App/src/renderer/src/pages/MeeshoCMS.tsx.
 * Left: order info + video. Right: barcode + received + reverse waybill images.
 * Deferred: VMS rearrange, sub-order auto-fill.
 */
const MeeshoForm = ({ formik, feedId, isPartialArticleClaim, side, carryOverImages, existingClaim }: PlatformFormProps) => {
  const blobs = useBlobPreview();
  const [previews, setPreviews] = useState<{ [key: string]: string | null }>({
    returnVideo: null,
    forwardVideo: null,
    barcodeImage: null,
    receivedProductImage_1: null,
    reverseWayBillImage: null,
  });

  // /cms/update: seed the 3 Meesho image previews from the loaded claim.
  // BE (findCmsByAwb) returns each slot as `{ fileKey, url }` (withUrl shape),
  // so we drop the `.url` straight into preview state and write the `.fileKey`
  // back into formik so an Update submit re-sends the S3 keys unchanged when
  // the operator doesn't touch the slots. Guarded by a claim-id ref so
  // subsequent uploads / rearranges aren't clobbered on re-render.
  const meeshoHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || meeshoHydratedRef.current === claimId) return;
    meeshoHydratedRef.current = claimId;

    const slots: Array<{
      key: "barcodeImage" | "receivedProductImage_1" | "reverseWayBillImage";
    }> = [
      { key: "barcodeImage" },
      { key: "receivedProductImage_1" },
      { key: "reverseWayBillImage" },
    ];
    slots.forEach(({ key }) => {
      const entry = (existingClaim as any)?.[key];
      if (!entry || !entry.url) return;
      setPreviews((prev) => ({ ...prev, [key]: entry.url }));
      if (entry.fileKey) formik.setFieldValue(key, entry.fileKey);
    });

    // Defensive: seed the Meesho account username. Also handled by
    // useCreateCmsForm.applyExistingClaim (setIfChanged), but writing it here
    // too guarantees the dropdown preselects on direct /cms/update visits
    // regardless of effect ordering / batched setState timing.
    const storedAccount =
      typeof existingClaim?.meesho_account_email === "string"
        ? existingClaim.meesho_account_email.trim()
        : "";
    if (
      storedAccount &&
      !(formik.values.meesho_account_email as string | undefined)
    ) {
      formik.setFieldValue("meesho_account_email", storedAccount);
    }
  }, [existingClaim, formik]);

  const imagePreviews = useMemo(
    () => ({
      barcodeImage: previews.barcodeImage,
      receivedProductImage_1: previews.receivedProductImage_1,
      reverseWayBillImage: previews.reverseWayBillImage,
    }),
    [previews.barcodeImage, previews.receivedProductImage_1, previews.reverseWayBillImage],
  );

  const populate = (screenshots: string[]) => {
    // first -> barcodeImage; middle -> receivedProductImage_1; last -> reverseWayBillImage
    const first = screenshots[0];
    const last = screenshots.length > 1 ? screenshots[screenshots.length - 1] : "";
    const middle = screenshots.length > 2 ? screenshots[1] : "";
    if (first) {
      setPreviews((prev) => {
        blobs.release(prev.barcodeImage);
        return { ...prev, barcodeImage: first };
      });
      formik.setFieldValue("barcodeImage", first.split("/").pop());
    }
    if (middle) {
      setPreviews((prev) => {
        blobs.release(prev.receivedProductImage_1);
        return { ...prev, receivedProductImage_1: middle };
      });
      formik.setFieldValue("receivedProductImage_1", middle.split("/").pop());
    }
    if (last) {
      setPreviews((prev) => {
        blobs.release(prev.reverseWayBillImage);
        return { ...prev, reverseWayBillImage: last };
      });
      formik.setFieldValue("reverseWayBillImage", last.split("/").pop());
    }
  };

  const reset = () => {
    MEESHO_IMAGE_FIELDS.forEach((f) => {
      setPreviews((prev) => {
        blobs.release(prev[f]);
        return { ...prev, [f]: null };
      });
      formik.setFieldValue(f, "");
    });
  };

  const applyArranged = (arranged: string[]) => {
    const [first, middle, last] = arranged;
    setPreviews((prev) => {
      blobs.release(prev.barcodeImage);
      blobs.release(prev.receivedProductImage_1);
      blobs.release(prev.reverseWayBillImage);
      return {
        ...prev,
        barcodeImage: first || null,
        receivedProductImage_1: middle || null,
        reverseWayBillImage: last || null,
      };
    });
    formik.setFieldValue("barcodeImage", first ? first.split("/").pop() : "");
    formik.setFieldValue("receivedProductImage_1", middle ? middle.split("/").pop() : "");
    formik.setFieldValue("reverseWayBillImage", last ? last.split("/").pop() : "");

    const merged = new Set<string>([
      ...vms.fetchedScreenshots,
      ...MEESHO_IMAGE_FIELDS
        .map((f) => imagePreviews[f as keyof typeof imagePreviews])
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
    imageFields: MEESHO_IMAGE_FIELDS,
    populate,
    reset,
  });

  const auto = useCmsAutoFetch({
    formik,
    isMeesho: true,
    onReturnVideoLink: (link) =>
      setPreviews((prev) => {
        blobs.release(prev.returnVideo);
        return { ...prev, returnVideo: link };
      }),
    onForwardVideoLink: (link) =>
      setPreviews((prev) => {
        blobs.release(prev.forwardVideo);
        return { ...prev, forwardVideo: link };
      }),
  });

  // The account is NOT looked up in the master data: the Return AWB's Meesho
  // lookup (useCmsAutoFetch) fills it with the login whose session holds the
  // return, alongside the sub-order number.

  const handleFilePreviewChange = (name: string, file: File | null) => {
    setPreviews((prev) => {
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
              error={!!(formik.touched.costOfMissingArticle && formik.errors.costOfMissingArticle)}
              helperText={
                formik.touched.costOfMissingArticle &&
                (formik.errors.costOfMissingArticle as string)
              }
            />
          </Box>
        )}

        {formik.values.typeOfClaimName === POD_CLAIM_LABEL && (
          <Box sx={{ marginBottom: 2 }}>
            <Typography>
              Logistics Partner Name <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
            </Typography>
            <Autocomplete
              size="small"
              options={LOGISTICS_PARTNER_OPTIONS}
              value={formik.values.logisticsPartnerName || null}
              onChange={(_, value) => {
                formik.setFieldValue("logisticsPartnerName", value ?? "");
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  name="logisticsPartnerName"
                  onBlur={formik.handleBlur}
                  error={!!(formik.touched.logisticsPartnerName && formik.errors.logisticsPartnerName)}
                  helperText={
                    formik.touched.logisticsPartnerName &&
                    (formik.errors.logisticsPartnerName as string)
                  }
                  placeholder="Select Logistics Partner"
                />
              )}
            />
          </Box>
        )}

        <Box sx={{ marginBottom: 2 }}>
          <Typography>Description</Typography>
          <TextField
            fullWidth
            size="small"
            multiline
            rows={2}
            placeholder="Additional Description"
            name="remark"
            value={formik.values.remark}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
          />
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", marginBottom: 3 }}>
          <Box sx={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "5px" }}>
            <Typography>
              Suborder Number <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
            </Typography>
            <TextField
              name="subOrderNumber"
              placeholder="Enter Suborder Number"
              size="small"
              fullWidth
              value={formik.values.subOrderNumber}
              onChange={(e) => auto.onSubOrderChange(e.target.value)}
              onBlur={formik.handleBlur}
              error={!!(formik.touched.subOrderNumber && formik.errors.subOrderNumber)}
              helperText={formik.touched.subOrderNumber && (formik.errors.subOrderNumber as string)}
            />
          </Box>
          <Box sx={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "5px" }}>
            <Typography>
              State of The Packet <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
            </Typography>
            <Autocomplete
              size="small"
              options={STATE_OF_PACKET_OPTIONS}
              getOptionLabel={(option) => option.label}
              value={
                STATE_OF_PACKET_OPTIONS.find((o) => o.id === formik.values.stateOfThePacket) ||
                null
              }
              onChange={(_, value) => {
                formik.setFieldValue("stateOfThePacket", value?.id || "");
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  name="stateOfThePacket"
                  onBlur={formik.handleBlur}
                  error={!!(formik.touched.stateOfThePacket && formik.errors.stateOfThePacket)}
                  helperText={
                    formik.touched.stateOfThePacket && (formik.errors.stateOfThePacket as string)
                  }
                  placeholder="Select State of Packet"
                />
              )}
            />
          </Box>
          <Box sx={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "5px" }}>
            <Typography>Packet ID</Typography>
            <TextField
              name="packetId"
              placeholder="Enter Packet ID"
              size="small"
              fullWidth
              value={formik.values.packetId}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              error={!!(formik.touched.packetId && formik.errors.packetId)}
              helperText={formik.touched.packetId && (formik.errors.packetId as string)}
            />
          </Box>
        </Box>

        {/* Account Username on its own row, above the AWB row. */}
        <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "5px" }}>
          <Typography>Meesho Account Username</Typography>
          <PlatformAccountDropdown
            platform="meesho"
            label=""
            value={(formik.values.meesho_account_email as string) || ""}
            onChange={(v) => formik.setFieldValue("meesho_account_email", v)}
          />
        </Box>

        {/* AWB row — Return AWB + Forward AWB */}
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
              }}
              onBlur={formik.handleBlur}
              error={!!(formik.touched.AWBNumber && formik.errors.AWBNumber)}
              helperText={formik.touched.AWBNumber && (formik.errors.AWBNumber as string)}
            />
          </Box>
          <Box sx={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "5px" }}>
            <Typography>Forward AWB Number</Typography>
            <TextField
              name="forwardAWB"
              placeholder="Enter Forward AWB"
              size="small"
              fullWidth
              value={formik.values.forwardAWB}
              onChange={(e) => {
                auto.onForwardAwbChange(e.target.value);
              }}
              onBlur={formik.handleBlur}
            />
          </Box>
        </Box>

        {/* Return + Forward videos side by side */}
        <LeftVideos
          formik={formik}
          feedId={feedId}
          previews={{
            returnVideo: previews.returnVideo,
            forwardVideo: previews.forwardVideo || null,
          }}
          onPreviewChange={handleFilePreviewChange}
          onLinkChange={(sideKey, value) =>
            setPreviews((prev) => {
              blobs.release(prev[sideKey]);
              return { ...prev, [sideKey]: value };
            })
          }
        />
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
      <Box>
        <Typography sx={{ mb: "5px" }}>Barcode Image</Typography>
        <FileInput
          name="barcodeImage"
          feedId={feedId}
          setFieldValue={formik.setFieldValue}
          setFieldTouched={formik.setFieldTouched}
          height="150px"
          width="100%"
          preview={previews.barcodeImage}
          onFileChange={handleFilePreviewChange}
          error={!!(formik.touched.barcodeImage && formik.errors.barcodeImage)}
        >
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "text.secondary" }}>
            <InsertPhotoOutlined fontSize="large" />
            <Typography variant="caption">Upload</Typography>
          </Box>
        </FileInput>
        {formik.touched.barcodeImage && formik.errors.barcodeImage && (
          <FormHelperText error>{formik.errors.barcodeImage as string}</FormHelperText>
        )}
      </Box>
      <Box>
        <Typography sx={{ mb: "5px" }}>
          Received Product Image <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
        </Typography>
        <FileInput
          name="receivedProductImage_1"
          feedId={feedId}
          setFieldValue={formik.setFieldValue}
          setFieldTouched={formik.setFieldTouched}
          height="150px"
          width="100%"
          preview={previews.receivedProductImage_1}
          onFileChange={handleFilePreviewChange}
          error={!!(formik.touched.receivedProductImage_1 && formik.errors.receivedProductImage_1)}
        >
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "text.secondary" }}>
            <InsertPhotoOutlined fontSize="large" />
            <Typography variant="caption">Upload</Typography>
          </Box>
        </FileInput>
        {formik.touched.receivedProductImage_1 && formik.errors.receivedProductImage_1 && (
          <FormHelperText error>
            {formik.errors.receivedProductImage_1 as string}
          </FormHelperText>
        )}
      </Box>
      <Box>
        <Typography sx={{ mb: "5px" }}>
          Reverse Way Bill <span style={{ color: "var(--mui-palette-error-main)" }}>*</span>
        </Typography>
        <FileInput
          name="reverseWayBillImage"
          feedId={feedId}
          setFieldValue={formik.setFieldValue}
          setFieldTouched={formik.setFieldTouched}
          height="150px"
          width="100%"
          preview={previews.reverseWayBillImage}
          onFileChange={handleFilePreviewChange}
          error={!!(formik.touched.reverseWayBillImage && formik.errors.reverseWayBillImage)}
        >
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "text.secondary" }}>
            <InsertPhotoOutlined fontSize="large" />
            <Typography variant="caption">Upload</Typography>
          </Box>
        </FileInput>
        {formik.touched.reverseWayBillImage && formik.errors.reverseWayBillImage && (
          <FormHelperText error>
            {formik.errors.reverseWayBillImage as string}
          </FormHelperText>
        )}
      </Box>

      <RearrangeModal
        open={vms.rearrangeModalOpen}
        onClose={() => vms.setRearrangeModalOpen(false)}
        onSave={applyArranged}
        images={vms.rearrangeImagePool}
        initialSlotImages={vms.rearrangeInitialSlots}
        schema={MEESHO_SCHEMA}
        title="Rearrange Product Screenshots"
      />
    </Box>
  );
};

export default MeeshoForm;
