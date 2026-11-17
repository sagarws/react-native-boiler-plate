"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { PACKING_SIDES, type ExistingCmsPreview, type StoredFile, type XbeesPackingImage } from "@/types/cms-create";
import { PlatformAccountDropdown, usePlatformAccountAutoSelect } from "@/features/cms-create/account-select";
import { CostOfMissingArticle, FormText, LeftVideos, RemarkField, SectionTitle, TwoColumn, fileHandlers, type PlatformFormProps } from "@/features/cms-create/form-bits";
import { errorAt, rawErrorAt, stringAt } from "@/features/cms-create/hooks";
import { FileInput } from "@/features/cms-create/media/file-input";
import type { MediaSrc } from "@/features/cms-create/media/media-thumb";
import { BundlePanel, type BundleGroup } from "@/features/cms-create/platforms/bundle-panel";
import { useVideoPreviews } from "@/features/cms-create/platforms/use-video-previews";
import { needsVideo, qcReasonLabel, qcSelectionFromClaimType, TATACLIQ_QC_IMAGE_SLOTS } from "@/features/cms-create/tatacliq-qc";
import { useCmsAutoFetch } from "@/features/cms-create/use-cms-auto-fetch";

/** Left column shared by the bundle platforms: account, AWBs, SKU (when a lookup set one), remark and videos. */
function BundleLeft({ props, accountPlatform, accountLabel, accountPath, autoSelect, isMyntra, top, bottom }: { props: PlatformFormProps; accountPlatform: string; accountLabel: string; accountPath: string; autoSelect?: boolean; isMyntra?: boolean; top?: ReactNode; bottom?: ReactNode }) {
  const { formik, feedId, header, isPartialArticleClaim, skus, existingClaim } = props;
  const videos = useVideoPreviews(existingClaim);
  const auto = useCmsAutoFetch({ formik, isMyntra, onReturnVideoLink: (l) => videos.onLinkChange("returnVideo", l), onForwardVideoLink: (l) => videos.onLinkChange("forwardVideo", l) });
  const account = usePlatformAccountAutoSelect({ platform: accountPlatform, awb: formik.values.AWBNumber, currentValue: stringAt(formik, accountPath), onResolve: (a) => void formik.setFieldValue(accountPath, a) });
  return (
    <>
      {header}
      <SectionTitle icon="clipboard-text" title="Claim details" />
      <div className="c-form-grid tv-cmsc-grid">
        {isPartialArticleClaim ? <CostOfMissingArticle formik={formik} /> : null}
        {top}
        <div className="span-full">
          <PlatformAccountDropdown platform={accountPlatform} label={accountLabel} value={stringAt(formik, accountPath)} onChange={(v) => void formik.setFieldValue(accountPath, v)} />
        </div>
        <FormText
          formik={formik}
          name="AWBNumber"
          label="Return AWB Number"
          required
          placeholder="Enter AWB Number"
          onValue={(v) => {
            auto.onReturnAwbChange(v);
            if (autoSelect) account.onReturnAwb(v);
          }}
        />
        <FormText
          formik={formik}
          name="forwardAWB"
          label="Forward AWB"
          placeholder="Enter Forward AWB"
          onValue={(v) => {
            auto.onForwardAwbChange(v);
            if (autoSelect) account.onForwardAwb(v);
          }}
        />
        {skus.length > 0 ? <FormText formik={formik} name="skuName" label="SKU" placeholder="Select SKU" /> : null}
        <RemarkField formik={formik} placeholder={isMyntra ? "Additional Remark" : "Remark"} />
      </div>
      <SectionTitle icon="video-camera" title="Videos" hint="Upload, record or paste the CCTV link." />
      <LeftVideos formik={formik} feedId={feedId} previews={videos.previews} onPreviewChange={videos.onPreviewChange} onLinkChange={videos.onLinkChange} />
      {bottom}
    </>
  );
}

const other = (c: ExistingCmsPreview) => c.otherClaimDetails;

/** TrackVid `MyntraForm`: disputed amount / physical SKU by claim type, damaged-product video, shipping label + packing grid. */
export function MyntraForm(props: PlatformFormProps) {
  const { formik, feedId, existingClaim } = props;
  const [damaged, setDamaged] = useState<MediaSrc | null>(null);
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  if (existingClaim && existingClaim._id !== hydratedId) {
    setHydratedId(existingClaim._id);
    const m = existingClaim.myntraClaimDetails;
    setDamaged(m?.damagedProductVideo?.url || m?.damagedProductVideoLink || null);
  }
  const h = fileHandlers(formik);
  const type = formik.values.typeOfClaim;
  const top = (
    <>
      {type === "partial_return" ? <FormText formik={formik} name="myntraClaimDetails.disputedAmount" label="Disputed Amount" required type="number" placeholder="Enter Disputed Amount" full /> : null}
      {type === "wrong_returns_own_product" ? <FormText formik={formik} name="myntraClaimDetails.physicalReceivedSku" label="Physical Received SKU" required placeholder="Enter Physical Received Sku" full /> : null}
    </>
  );
  const bottom = (
    <div className="tv-cmsc-video-card">
      <div className="tv-row-between">
        <span className="tv-cmsc-label">Damaged Product or Outer Packaging</span>
        <span className="tv-field-hint">Optional · max 50MB</span>
      </div>
      <FileInput name="myntraClaimDetails.damagedProductVideo" label="Damaged product video" feedId={feedId} preview={damaged} onFileChange={(_, f) => setDamaged(f)} setFieldValue={h.setFieldValue} setFieldTouched={h.setFieldTouched} isVideo size="md" maxMb={50}>
        <Icon name="video-camera" />
        <span>Upload Video</span>
      </FileInput>
      {!damaged ? (
        <>
          <div className="tv-cmsc-or">or paste link</div>
          <input
            className="tv-input"
            placeholder="Damaged Product Video Link"
            aria-label="Damaged Product Video Link"
            value={formik.values.myntraClaimDetails?.damagedProductVideoLink ?? ""}
            onChange={(e) => {
              const v = e.currentTarget.value;
              void formik.setFieldValue("myntraClaimDetails.damagedProductVideoLink", v);
              setDamaged(v || null);
            }}
          />
        </>
      ) : (
        <button
          type="button"
          className="secondary-button compact-button"
          onClick={() => {
            void formik.setFieldValue("myntraClaimDetails.damagedProductVideo", "");
            void formik.setFieldValue("myntraClaimDetails.damagedProductVideoLink", "");
            setDamaged(null);
          }}
        >
          <Icon name="trash" /> Remove video
        </button>
      )}
    </div>
  );
  const groups: BundleGroup[] = [
    { kind: "single", id: "shippingLabel", path: "myntraClaimDetails.shippingLabelImage", label: "Shipping Label", short: "Shipping Label", required: true, hint: "(Maximum 1 Image, max size 5MB)", maxMb: 5, fromClaim: (c) => c.myntraClaimDetails?.shippingLabelImage },
    { kind: "multi", id: "packing", path: "myntraClaimDetails.packingImages", label: "Product & Outer Packing", short: "Packing", required: true, hint: "(Min 1, Max 10 · 3MB each · drag to reorder)", max: 10, defaultSlots: 3, maxMb: 3, fromClaim: (c) => c.myntraClaimDetails?.packingImages },
  ];
  return (
    <TwoColumn
      left={<BundleLeft props={props} accountPlatform="myntra" accountLabel="Myntra Account Username" accountPath="myntraClaimDetails.username" autoSelect isMyntra top={top} bottom={bottom} />}
      right={<BundlePanel props={props} groups={groups} title="Label & packing" />}
    />
  );
}

/** TrackVid `FlipkartForm`: shipping label + 3–10 evidence images (claim area is in the header cascade). */
export function FlipkartForm(props: PlatformFormProps) {
  const groups: BundleGroup[] = [
    { kind: "single", id: "shippingLabel", path: "otherClaimDetails.shippingLabelImage", label: "Shipping Label", short: "Shipping Label", required: true, hint: "(Maximum 1 Image, max size 5MB)", maxMb: 5, fromClaim: (c) => other(c)?.shippingLabelImage },
    { kind: "multi", id: "packing", path: "otherClaimDetails.packingImages", label: "Evidence of Issue", short: "Packing", required: true, hint: "(Min 3, Max 10 · 3MB each · drag to reorder)", max: 10, defaultSlots: 3, maxMb: 3, fromClaim: (c) => other(c)?.packingImages },
  ];
  return <TwoColumn left={<BundleLeft props={props} accountPlatform="flipkart" accountLabel="Flipkart Account Username" accountPath="otherClaimDetails.username" />} right={<BundlePanel props={props} groups={groups} title="Label & evidence" />} />;
}

/** TrackVid `DelhiveryForm`: shipping label + 1–10 evidence images (domestic / subcategory are in the header). */
export function DelhiveryForm(props: PlatformFormProps) {
  const groups: BundleGroup[] = [
    { kind: "single", id: "shippingLabel", path: "otherClaimDetails.shippingLabelImage", label: "Shipping Label", short: "Shipping Label", required: true, hint: "(Maximum 1 Image, max size 5MB)", maxMb: 5, fromClaim: (c) => other(c)?.shippingLabelImage },
    { kind: "multi", id: "packing", path: "otherClaimDetails.packingImages", label: "Evidence of Issue", short: "Packing", required: true, hint: "(Min 1, Max 10 · 3MB each · drag to reorder)", max: 10, defaultSlots: 3, maxMb: 3, fromClaim: (c) => other(c)?.packingImages },
  ];
  return <TwoColumn left={<BundleLeft props={props} accountPlatform="delhivery" accountLabel="Delhivery Account Username" accountPath="otherClaimDetails.username" />} right={<BundlePanel props={props} groups={groups} title="Label & evidence" />} />;
}

/** TrackVid `AmazonForm`: 1–2 return-contents photos, the shipping-label photo and an optional serial-number photo. */
export function AmazonForm(props: PlatformFormProps) {
  const groups: BundleGroup[] = [
    { kind: "multi", id: "contents", path: "otherClaimDetails.contentsOfReturnImages", label: "Photograph of the contents of the return", short: "Contents", required: true, hint: "(max files allowed : 2)", max: 2, defaultSlots: 2, maxMb: 5, fromClaim: (c) => other(c)?.contentsOfReturnImages },
    { kind: "single", id: "shippingLabel", path: "otherClaimDetails.shippingLabelImage", label: "Photograph of the returned package with the shipping label affixed", short: "Shipping Label", required: true, hint: "(max files allowed : 1)", maxMb: 5, fromClaim: (c) => other(c)?.shippingLabelImage },
    { kind: "single", id: "serialNumber", path: "otherClaimDetails.serialNumberImage", label: "Serial number of the item", short: "Serial Number", hint: "(max files allowed : 1)", maxMb: 5, fromClaim: (c) => other(c)?.serialNumberImage },
  ];
  return <TwoColumn left={<BundleLeft props={props} accountPlatform="amazon" accountLabel="Amazon Account Username" accountPath="otherClaimDetails.username" />} right={<BundlePanel props={props} groups={groups} title="Return photographs" />} />;
}

/**
 * TrackVid `TataCliqForm`: the portal's QC Fail form. Reason / sub-reason codes are derived from the cascade in the
 * header (never asked twice); six named slots (four required) keyed into `otherClaimDetails.qcImages`, mirrored into
 * the legacy shipping-label / packing fields; packaging + unboxing video URLs only for reasons that take footage.
 */
export function TataCliqForm(props: PlatformFormProps) {
  const { formik } = props;
  const parent = formik.values.otherClaimDetails?.parentSelection ?? "";
  const typeOfClaim = formik.values.typeOfClaim;
  const derived = qcSelectionFromClaimType(parent, typeOfClaim);
  const reason = formik.values.otherClaimDetails?.qcReason ?? "";
  const subReason = formik.values.otherClaimDetails?.qcSubReason ?? "";
  const qcImages = formik.values.otherClaimDetails?.qcImages;
  const lastReason = useRef<string | null>(null);
  const setFieldValue = formik.setFieldValue;

  // Mirror the derived codes into the form; clear a sub-reason only when the reason itself moves on.
  useEffect(() => {
    if (derived.reason !== reason) void setFieldValue("otherClaimDetails.qcReason", derived.reason);
    const changed = lastReason.current !== null && lastReason.current !== derived.reason;
    lastReason.current = derived.reason;
    if (derived.subReason) {
      if (derived.subReason !== subReason) void setFieldValue("otherClaimDetails.qcSubReason", derived.subReason);
    } else if (changed && subReason) void setFieldValue("otherClaimDetails.qcSubReason", "");
  }, [derived.reason, derived.subReason, reason, subReason, setFieldValue]);

  // Legacy fields read by the claim viewer: packing slip → shippingLabelImage, the rest (slot order) → packingImages.
  const mirrorKey = JSON.stringify(qcImages ?? {});
  useEffect(() => {
    const images = (JSON.parse(mirrorKey) as Record<string, string>) ?? {};
    void setFieldValue("otherClaimDetails.shippingLabelImage", images.packingSlip || "");
    void setFieldValue(
      "otherClaimDetails.packingImages",
      TATACLIQ_QC_IMAGE_SLOTS.filter((s) => s.key !== "packingSlip")
        .map((s) => images[s.key])
        .filter((k): k is string => Boolean(k)),
    );
  }, [mirrorKey, setFieldValue]);

  const reasonError = parent && !derived.reason ? `"${parent}" is not one of Tata CliQ's QC failure reasons — pick a reason the portal accepts.` : undefined;
  const qcError = formik.submitCount > 0 || formik.touched.otherClaimDetails ? rawErrorAt(formik, "otherClaimDetails.qcImages") : undefined;
  const qcStored = (c: ExistingCmsPreview, key: string): StoredFile | string | null => c.otherClaimDetails?.qcImages?.[key] ?? null;

  const groups: BundleGroup[] = TATACLIQ_QC_IMAGE_SLOTS.map((s) => ({ kind: "single", id: s.key, path: `otherClaimDetails.qcImages.${s.key}`, label: `${s.slot}. ${s.label}`, short: s.label, required: s.required, maxMb: 3, fromClaim: (c: ExistingCmsPreview) => qcStored(c, s.key) }));

  const extra = needsVideo(reason) ? (
    <div className="c-form-grid">
      <FormText formik={formik} name="otherClaimDetails.packagingVideoUrl" label="Add Packaging Video URL" placeholder="Enter URL" full />
      <FormText formik={formik} name="otherClaimDetails.unboxingVideoUrl" label="Add Unboxing Video URL" placeholder="Enter URL" full />
    </div>
  ) : null;

  return (
    <TwoColumn
      left={<BundleLeft props={props} accountPlatform="tataCliq" accountLabel="Tata CliQ Account Username" accountPath="otherClaimDetails.username" />}
      right={
        <BundlePanel
          props={props}
          groups={groups}
          title="QC Images"
          hint={`The four starred slots are required · 3MB each.${reason ? ` Filing as: ${qcReasonLabel(reason)} (${reason}${subReason ? ` / ${subReason}` : ""}).` : ""}`}
          groupError={reasonError ?? qcError ?? errorAt(formik, "otherClaimDetails.qcSubReason")}
          extra={extra}
        />
      }
    />
  );
}

/** TrackVid `XbeesForm`: dispute amount + four positional package photos (Top / Right / Bottom / Left). */
export function XbeesForm(props: PlatformFormProps) {
  const { formik } = props;
  const packing = formik.values.otherClaimDetails?.packingImages ?? [];
  const shaped = packing.length === PACKING_SIDES.length && packing.every((p, i) => typeof p === "object" && p !== null && (p as XbeesPackingImage).side === PACKING_SIDES[i]);
  const setFieldValue = formik.setFieldValue;
  const packingKey = JSON.stringify(packing);
  useEffect(() => {
    if (shaped) return;
    const current = JSON.parse(packingKey) as unknown[];
    const bySide = new Map<string, string>();
    for (const p of current) if (p && typeof p === "object") bySide.set(String((p as { side?: unknown }).side ?? ""), String((p as { fileKey?: unknown }).fileKey ?? ""));
    void setFieldValue(
      "otherClaimDetails.packingImages",
      PACKING_SIDES.map((side) => ({ side, fileKey: bySide.get(side) ?? "" })),
    );
  }, [shaped, packingKey, setFieldValue]);

  const sideFromClaim = (c: ExistingCmsPreview, side: string, index: number): StoredFile | null => {
    const list = c.otherClaimDetails?.packingImages ?? [];
    const tagged = list.find((p) => p && (p as StoredFile & { side?: string }).side === side);
    return tagged ?? list[index] ?? null;
  };

  const groups: BundleGroup[] = PACKING_SIDES.map((side, i) => ({
    kind: "single",
    id: `evidence_${side}`,
    path: `otherClaimDetails.packingImages.${i}.fileKey`,
    label: side[0].toUpperCase() + side.slice(1),
    short: side[0].toUpperCase() + side.slice(1),
    required: true,
    maxMb: 3,
    fromClaim: (c: ExistingCmsPreview) => sideFromClaim(c, side, i),
  }));
  const packErr = formik.submitCount > 0 ? rawErrorAt(formik, "otherClaimDetails.packingImages") : undefined;
  const top = <FormText formik={formik} name="otherClaimDetails.disputeAmount" label="Dispute Amount" required type="number" placeholder="Enter Dispute Amount" full />;
  return (
    <TwoColumn
      left={<BundleLeft props={props} accountPlatform="xbees" accountLabel="Xbees Account Username" accountPath="otherClaimDetails.username" top={top} />}
      right={<BundlePanel props={props} groups={groups} title="Upload package photos" hint="Upload one photo per side · 3MB each" groupError={packErr} />}
    />
  );
}
