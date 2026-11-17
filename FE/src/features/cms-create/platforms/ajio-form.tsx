"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { SelectField, TextField } from "@/components/ui/form-field";
import type { OrderLookupRecord } from "@/types/cms-create";
import { usePlatformAccountAutoSelect, PlatformAccountDropdown } from "@/features/cms-create/account-select";
import { AjioSkuPickerDialog } from "@/features/cms-create/ajio-sku-picker";
import { CostOfMissingArticle, FormText, ImageSlot, LeftVideos, RearrangeButton, RemarkField, SectionTitle, SixSideImages, TwoColumn, req, fileHandlers, type PlatformFormProps } from "@/features/cms-create/form-bits";
import { errorAt, keyOfUrl, stringAt } from "@/features/cms-create/hooks";
import { FileInput } from "@/features/cms-create/media/file-input";
import type { MediaSrc } from "@/features/cms-create/media/media-thumb";
import { RearrangeDialog, type ArrangementField } from "@/features/cms-create/rearrange-dialog";
import { useCmsAutoFetch } from "@/features/cms-create/use-cms-auto-fetch";
import { useVmsScreenshots } from "@/features/cms-create/use-vms-screenshots";
import { useSlotPreviews, useVideoPreviews } from "@/features/cms-create/platforms/use-video-previews";

const MAX_SIDE_SLOTS = 9;

const COMMON_SCHEMA: ArrangementField[] = [
  { fieldName: "returnProductImage", label: "Return Product", position: "first" },
  ...Array.from({ length: MAX_SIDE_SLOTS }, (_, i) => ({ fieldName: `sideImages_${i}`, label: `Side ${i + 1}`, position: "middle" as const })),
  { fieldName: "podProof", label: "POD Proof", position: "middle" },
  { fieldName: "forwardSentProductImage", label: "Forward Sent", position: "last" },
];
const COMMON_FIELDS = COMMON_SCHEMA.map((s) => s.fieldName);

/** Dedupe by trimmed SKU; repeated empty-SKU rows collapse to one. */
const mergeRecordsBySku = (existing: OrderLookupRecord[], incoming: OrderLookupRecord[]): OrderLookupRecord[] => {
  const seen = new Set<string>();
  const out: OrderLookupRecord[] = [];
  for (const r of [...existing, ...incoming]) {
    const key = (r.sku || "").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
};

/**
 * TrackVid `CommonRightPart` (AJIO, Nykaa, Shopify, custom platforms): Return + Forward-sent product images,
 * 3–9 product side images, POD proof and an additional titled file. VMS frames for the Return AWB fill the slots
 * and open the Rearrange dialog.
 */
function CommonRightPart({ formik, feedId, sideImages, setSideImages, skuPickerOpen, existingClaim, carryOverImages, isUpdateMode }: PlatformFormProps) {
  const [previews, setPreviews] = useSlotPreviews(existingClaim, (c) => ({ returnProductImage: c.returnProductImage || null, forwardSentProductImage: c.forwardSentProductImage || null, podProof: c.podProof || null }));
  const h = fileHandlers(formik);
  const onFile = (name: string, file: File | null) => setPreviews((p) => ({ ...p, [name]: file }));
  const manualFiles = sideImages.filter((s): s is File => typeof s !== "string");

  const slotPreviews: Record<string, MediaSrc | null> = {
    returnProductImage: previews.returnProductImage ?? null,
    forwardSentProductImage: previews.forwardSentProductImage ?? null,
    podProof: previews.podProof ?? null,
  };
  sideImages.slice(0, MAX_SIDE_SLOTS).forEach((s, i) => {
    slotPreviews[`sideImages_${i}`] = s;
  });

  const vms = useVmsScreenshots({
    awb: formik.values.AWBNumber,
    forwardAwb: formik.values.forwardAWB,
    previews: slotPreviews,
    imageFields: COMMON_FIELDS,
    carryOverImages,
    openModalOnCarryOver: false,
    deferAutoActions: skuPickerOpen,
    isUpdateMode,
    populate: (shots) => {
      const first = shots[0];
      const last = shots.length > 1 ? shots[shots.length - 1] : "";
      const middle = shots.length > 2 ? shots.slice(1, -1) : [];
      setPreviews((p) => ({ ...p, returnProductImage: first || p.returnProductImage || null, forwardSentProductImage: last || p.forwardSentProductImage || null }));
      if (first) void formik.setFieldValue("returnProductImage", keyOfUrl(first));
      if (last) void formik.setFieldValue("forwardSentProductImage", keyOfUrl(last));
      setSideImages([...middle.slice(0, MAX_SIDE_SLOTS), ...manualFiles].slice(0, MAX_SIDE_SLOTS));
    },
    reset: () => {
      setPreviews((p) => ({ ...p, returnProductImage: null, forwardSentProductImage: null, podProof: null }));
      void formik.setFieldValue("returnProductImage", "");
      void formik.setFieldValue("forwardSentProductImage", "");
      setSideImages(manualFiles);
    },
  });

  const applyArranged = (arranged: (MediaSrc | null)[]) => {
    const first = arranged[0] ?? null;
    const last = arranged[arranged.length - 1] ?? null;
    const pod = arranged[arranged.length - 2] ?? null;
    const middle = arranged.slice(1, arranged.length - 2).filter((v): v is MediaSrc => Boolean(v));
    setPreviews((p) => ({ ...p, returnProductImage: first, forwardSentProductImage: last, podProof: pod ?? p.podProof ?? null }));
    // Strings carry their own key; a local File keeps the key of the slot it was uploaded into.
    const keyFor = (src: MediaSrc | null): string => {
      if (!src) return "";
      if (typeof src === "string") return keyOfUrl(src);
      const from = (["returnProductImage", "forwardSentProductImage", "podProof"] as const).find((f) => previews[f] === src);
      return from ? stringAt(formik, from) : "";
    };
    void formik.setFieldValue("returnProductImage", keyFor(first));
    void formik.setFieldValue("forwardSentProductImage", keyFor(last));
    if (pod) void formik.setFieldValue("podProof", keyFor(pod));
    vms.setFetchedScreenshots((prev) => [...prev, ...arranged.filter((u): u is string => typeof u === "string" && Boolean(u) && !prev.includes(u))]);
    setSideImages(middle.slice(0, MAX_SIDE_SLOTS));
  };

  const sideError = errorAt(formik, "sideImages");
  const additionalTitleErr = errorAt(formik, "additionalFieldTitle");
  const additionalValueErr = errorAt(formik, "additionalFieldValue");

  return (
    <>
      <SectionTitle icon="image" title="Product images" hint="VMS screenshots for the Return AWB fill these slots automatically." />
      <RearrangeButton show={vms.rearrangeImagePool.length > 0} onClick={() => vms.setRearrangeModalOpen(true)} />
      <div className="tv-grid-2">
        <ImageSlot formik={formik} feedId={feedId} name="returnProductImage" label="Return Product Image" required preview={previews.returnProductImage} onFileChange={onFile} />
        <ImageSlot formik={formik} feedId={feedId} name="forwardSentProductImage" label="Forward Sent Product Image" preview={previews.forwardSentProductImage} onFileChange={onFile} />
      </div>
      <div className="tv-cmsc-field">
        <span className="tv-cmsc-label tv-row-between">
          {req("Product Side Images")}
          <em className={sideError ? "is-error" : ""}>Min 3 · Max 9</em>
        </span>
        <SixSideImages sideImages={sideImages} setSideImages={setSideImages} existingPdfUrl={isUpdateMode && existingClaim?.sixSideImages ? existingClaim.sixSideImages : undefined} />
        {sideError ? <span className="tv-field-error">{sideError}</span> : null}
      </div>
      <div className="tv-grid-2">
        <ImageSlot formik={formik} feedId={feedId} name="podProof" label="POD Proof" preview={previews.podProof} onFileChange={onFile} disableCapture />
        <div className="tv-cmsc-field">
          <span className="tv-cmsc-label">Additional Field</span>
          <input className="tv-input" name="additionalFieldTitle" placeholder="Enter title" aria-label="Additional field title" value={stringAt(formik, "additionalFieldTitle")} onChange={(e) => void formik.setFieldValue("additionalFieldTitle", e.currentTarget.value)} onBlur={() => void formik.setFieldTouched("additionalFieldTitle", true)} />
          {additionalTitleErr ? <span className="tv-field-error">{additionalTitleErr}</span> : null}
          <FileInput name="additionalFieldValue" label="Additional file" feedId={feedId} preview={previews.additionalFieldValue} onFileChange={onFile} setFieldValue={h.setFieldValue} setFieldTouched={h.setFieldTouched} error={Boolean(additionalValueErr)} size="sm" disableCapture>
            <Icon name="paperclip" />
            <span>Add File</span>
          </FileInput>
          {additionalValueErr ? <span className="tv-field-error">{additionalValueErr}</span> : null}
        </div>
      </div>
      {vms.rearrangeModalOpen && !skuPickerOpen ? (
        <RearrangeDialog title="Rearrange Product Screenshots" schema={COMMON_SCHEMA} images={vms.rearrangeImagePool} initialSlotImages={vms.rearrangeInitialSlots} onSave={applyArranged} onClose={() => vms.setRearrangeModalOpen(false)} />
      ) : null}
    </>
  );
}

export interface AccountConfig {
  platform: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}

/**
 * TrackVid `AjioForm` — the common layout used by AJIO and every platform without its own form (Nykaa and Shopify
 * wrap it, custom platforms fall back to it). Left: account, AWB / forward AWB / customer order / SKU / POB ID,
 * remark, videos. AJIO's AWB lookup feeds the multi-record SKU picker and the POB ID field.
 */
export function AjioForm(props: PlatformFormProps & { accountConfig?: AccountConfig; remarkLabel?: string; extraLeft?: ReactNode }) {
  const { formik, feedId, header, isPartialArticleClaim, skus, setSkus, skuPickerOpen, setSkuPickerOpen, isAjio, existingClaim, accountConfig, remarkLabel = "Remark", extraLeft } = props;
  const videos = useVideoPreviews(existingClaim);
  const [records, setRecords] = useState<OrderLookupRecord[]>([]);
  const [pobOptions, setPobOptions] = useState<string[]>([]);
  const live = useRef({ records, awb: formik.values.AWBNumber, sku: formik.values.skuName ?? "", pob: formik.values.pobId ?? "" });
  useEffect(() => {
    live.current = { ...live.current, awb: formik.values.AWBNumber, sku: formik.values.skuName ?? "", pob: formik.values.pobId ?? "" };
  });

  const writeRecords = (next: OrderLookupRecord[]) => {
    live.current.records = next;
    setRecords(next);
  };

  const resetMasterRecordState = () => {
    if (live.current.records.length === 0 && !formik.values.skuName && !formik.values.pobId) return;
    writeRecords([]);
    setSkus([]);
    void formik.setFieldValue("skuName", "");
    setPobOptions([]);
    void formik.setFieldValue("pobId", "");
  };

  const auto = useCmsAutoFetch({
    formik,
    onReturnVideoLink: (link) => videos.onLinkChange("returnVideo", link),
    onForwardVideoLink: (link) => videos.onLinkChange("forwardVideo", link),
    onRecords: (incoming) => {
      const merged = mergeRecordsBySku(live.current.records, incoming);
      const typed = live.current.awb.trim().toLowerCase();
      const awbMatches = typed ? merged.filter((r) => (r.returnAwb || "").trim().toLowerCase() === typed) : [];
      const scoped = awbMatches.length > 0 ? awbMatches : merged;

      const uniquePobs = [...new Set(scoped.map((r) => (r.pobId || "").trim()).filter(Boolean))];
      let currentPob = live.current.pob.trim();
      if (currentPob && !uniquePobs.includes(currentPob) && live.current.records.some((r) => (r.pobId || "").trim() === currentPob)) {
        void formik.setFieldValue("pobId", "");
        currentPob = "";
      }
      setPobOptions(uniquePobs);
      if (uniquePobs.length === 1 && !currentPob) void formik.setFieldValue("pobId", uniquePobs[0]);

      const uniqueSkus = [...new Set(scoped.map((r) => (r.sku || "").trim()).filter(Boolean))];
      let currentSku = live.current.sku.trim();
      if (currentSku && !uniqueSkus.includes(currentSku) && live.current.records.some((r) => (r.sku || "").trim() === currentSku)) {
        void formik.setFieldValue("skuName", "");
        currentSku = "";
      }
      writeRecords(scoped);
      if (uniqueSkus.length === 0) {
        setSkus([]);
        setSkuPickerOpen(false);
        writeRecords([]);
        return;
      }
      setSkus(uniqueSkus);
      if (uniqueSkus.length === 1) {
        if (!currentSku) void formik.setFieldValue("skuName", uniqueSkus[0]);
        setSkuPickerOpen(false);
        return;
      }
      setSkuPickerOpen(true);
    },
  });

  const accountAuto = usePlatformAccountAutoSelect({
    platform: "ajio",
    awb: formik.values.AWBNumber,
    currentValue: formik.values.ajio_account_email ?? "",
    onResolve: (account) => void formik.setFieldValue("ajio_account_email", account),
  });

  const left = (
    <>
      {header}
      <SectionTitle icon="clipboard-text" title="Claim details" />
      {extraLeft}
      <div className="c-form-grid tv-cmsc-grid">
        {isPartialArticleClaim ? <CostOfMissingArticle formik={formik} /> : null}
        <div className="span-full">
          {accountConfig ? (
            <PlatformAccountDropdown platform={accountConfig.platform} label={accountConfig.label} value={accountConfig.value} onChange={accountConfig.onChange} />
          ) : (
            <PlatformAccountDropdown platform="ajio" label="AJIO Account Username" value={formik.values.ajio_account_email ?? ""} onChange={(v) => void formik.setFieldValue("ajio_account_email", v)} />
          )}
        </div>
        <FormText
          formik={formik}
          name="AWBNumber"
          label="Return AWB Number"
          required
          placeholder="Enter AWB Number"
          onValue={(v) => {
            resetMasterRecordState();
            auto.onReturnAwbChange(v);
            if (!accountConfig) accountAuto.onReturnAwb(v);
          }}
        />
        <FormText
          formik={formik}
          name="forwardAWB"
          label="Forward AWB"
          placeholder="Enter Forward AWB"
          onValue={(v) => {
            resetMasterRecordState();
            auto.onForwardAwbChange(v);
            if (!accountConfig) accountAuto.onForwardAwb(v);
          }}
        />
        <FormText formik={formik} name="customerOrderNumber" label="Customer Order Number" placeholder="Enter Customer Order Number" />
        {skus.length > 0 ? (
          <FormText
            formik={formik}
            name="skuName"
            label="SKU"
            required
            placeholder="Select SKU"
            readOnly
            hint="Click to change the SKU"
            onClick={() => {
              if (records.some((r) => (r.sku || "").trim())) setSkuPickerOpen(true);
            }}
          />
        ) : (
          <FormText formik={formik} name="skuName" label="SKU" placeholder="Enter SKU" />
        )}
        {isAjio ? (
          pobOptions.length > 1 ? (
            <SelectField
              label="POB ID"
              value={formik.values.pobId ?? ""}
              onChange={(e) => void formik.setFieldValue("pobId", e.currentTarget.value)}
              options={pobOptions.map((p) => ({ value: p, label: p }))}
              placeholder="Not set"
              hint={`${pobOptions.length} POB IDs match this AWB`}
            />
          ) : (
            <TextField label="POB ID" placeholder="Enter POB ID" value={formik.values.pobId ?? ""} onChange={(e) => void formik.setFieldValue("pobId", e.currentTarget.value)} />
          )
        ) : null}
        <RemarkField formik={formik} label={remarkLabel} />
      </div>
      <SectionTitle icon="video-camera" title="Videos" hint="Upload, record or paste the CCTV link." />
      <LeftVideos formik={formik} feedId={feedId} previews={videos.previews} onPreviewChange={videos.onPreviewChange} onLinkChange={videos.onLinkChange} />
      {skuPickerOpen ? (
        <AjioSkuPickerDialog
          records={records}
          currentSku={formik.values.skuName ?? ""}
          onConfirm={(sku) => {
            void formik.setFieldValue("skuName", sku);
            setSkuPickerOpen(false);
          }}
          onCancel={() => setSkuPickerOpen(false)}
        />
      ) : null}
    </>
  );

  return <TwoColumn left={left} right={<CommonRightPart {...props} />} />;
}

