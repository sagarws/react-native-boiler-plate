"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { SelectField, TextField } from "@/components/ui/form-field";
import ROUTE_URLS from "@/config/route";
import { useCredentialsFor } from "@/features/cms/dialogs/simple-dialogs";
import { usernameOf } from "@/features/cms/cms-rules";
import { errorMessage, toast } from "@/lib/events";
import { CmsService, cmsMasterLookup } from "@/services/cms-service";
import type { ICms, UpdateCmsPayload } from "@/types/cms";
import type { IEcommerce } from "@/types/common";

const FULL_FIELD_PLATFORMS = new Set(["meesho", "snapdeal"]);
const DELHIVERY_DOMESTIC_OPTIONS = ["EXPRESS", "SURFACE"] as const;
const isPartialReturnClaim = (v: string) => v === "partial_return" || v === "Partial Return";
const isWrongReturnsOwnClaim = (v: string) => v === "wrong_returns_own_product" || v === "Wrong Returns-Received own product";

interface SkuRecord {
  _id: string;
  sku: string;
  pobId: string;
}

interface Values {
  AWBNumber: string;
  forwardAWB: string;
  subOrderNumber: string;
  typeOfClaim: string;
  disputedAmount: string;
  physicalReceivedSku: string;
  disputeAmount: string;
  domestic: string;
}

/** Same rules as TrackVid's `buildValidationSchema(platform)`. */
function validate(platform: string, v: Values): Partial<Record<keyof Values, string>> {
  const errors: Partial<Record<keyof Values, string>> = {};
  const positive = (raw: string) => Number.isFinite(Number(raw)) && Number(raw) > 0;
  if (isPartialReturnClaim(v.typeOfClaim)) {
    if (!v.disputedAmount.trim()) errors.disputedAmount = "Disputed Amount is required";
    else if (!positive(v.disputedAmount)) errors.disputedAmount = "Disputed Amount must be a positive number";
  }
  if (isWrongReturnsOwnClaim(v.typeOfClaim) && !v.physicalReceivedSku.trim()) errors.physicalReceivedSku = "Physical Received SKU is required";
  if (platform === "xbees") {
    if (!v.disputeAmount.trim()) errors.disputeAmount = "Dispute Amount is required";
    else if (!positive(v.disputeAmount)) errors.disputeAmount = "Dispute Amount must be a positive number";
  }
  if (platform === "delhivery") {
    if (!v.domestic.trim()) errors.domestic = "Domestic is required";
    else if (!(DELHIVERY_DOMESTIC_OPTIONS as readonly string[]).includes(v.domestic)) errors.domestic = "Select a valid Domestic option";
  }
  return errors;
}

/** TrackVid `EditCmsFieldsModal`: quick edit of a claim's key fields, AJIO SKU / POB pickers, username, "Full Edit Claim". */
export function EditFieldsDialog({ row, platforms, onClose, onSaved }: { row: ICms; platforms: readonly IEcommerce[]; onClose: () => void; onSaved: () => void }) {
  const router = useRouter();
  const platform = row.eCommercePlatform.toLowerCase();
  const isAjio = platform === "ajio";
  const isMyntra = platform === "myntra";
  const isXbees = platform === "xbees";
  const isDelhivery = platform === "delhivery";
  const showsExtraFields = FULL_FIELD_PLATFORMS.has(platform);
  const credentials = useCredentialsFor(row.eCommercePlatform);
  const claimTypes = platforms.find((p) => p.name.toLowerCase().trim() === platform)?.typeOfClaims ?? [];
  const initialUsername = usernameOf(row);

  const [values, setValues] = useState<Values>({
    AWBNumber: row.AWBNumber ?? "",
    forwardAWB: row.forwardAWB ?? "",
    subOrderNumber: row.subOrderNumber ?? "",
    typeOfClaim: row.typeOfClaim ?? "",
    disputedAmount: row.myntraClaimDetails?.disputedAmount != null ? String(row.myntraClaimDetails.disputedAmount) : "",
    physicalReceivedSku: row.myntraClaimDetails?.physicalReceivedSku ?? "",
    disputeAmount: row.otherClaimDetails?.disputeAmount != null ? String(row.otherClaimDetails.disputeAmount) : "",
    domestic: row.otherClaimDetails?.domestic ?? "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState(initialUsername);

  // AJIO SKU / POB (master-data lookup on both AWBs).
  const [skuRecords, setSkuRecords] = useState<SkuRecord[]>([]);
  const [skuValues, setSkuValues] = useState<string[]>([]);
  const [selectedSkuIndex, setSelectedSkuIndex] = useState<number | null>(null);
  const [sellerSkuOptional, setSellerSkuOptional] = useState(row.seller_sku ?? "");
  const [pobIdValue, setPobIdValue] = useState(row.pobid ?? "");
  const [pobOptions, setPobOptions] = useState<string[]>([]);
  const [pobIdTouched, setPobIdTouched] = useState(false);

  useEffect(() => {
    if (!isAjio) return;
    const returnAwb = row.AWBNumber?.trim();
    const forwardAwb = row.forwardAWB?.trim();
    if (!returnAwb && !forwardAwb) return;
    let cancelled = false;
    const safeLookup = async (awb: string | undefined, side: "Return" | "Forward"): Promise<SkuRecord[]> => {
      if (!awb) return [];
      try {
        return (await cmsMasterLookup.getOrderByAwb(awb, side)).records;
      } catch {
        // 404 = no master data for this side; the other side may still answer.
        return [];
      }
    };
    void Promise.all([safeLookup(returnAwb, "Return"), safeLookup(forwardAwb, "Forward")]).then(([ret, fwd]) => {
      if (cancelled) return;
      const seen = new Set<string>();
      const merged: SkuRecord[] = [];
      for (const r of [...ret, ...fwd]) {
        const key = r.sku.trim();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(r);
      }
      setSkuRecords(merged);
      setSkuValues(merged.map((r) => r.sku));
      const current = (row.seller_sku ?? "").trim();
      const preIdx = current ? merged.findIndex((r) => r.sku.trim() === current) : -1;
      setSelectedSkuIndex(preIdx >= 0 ? preIdx : null);
      const uniquePobs = [...new Set(merged.map((r) => r.pobId.trim()).filter(Boolean))];
      setPobOptions(uniquePobs);
      if (!(row.pobid ?? "").trim() && uniquePobs.length === 1) setPobIdValue(uniquePobs[0]);
    });
    return () => {
      cancelled = true;
    };
  }, [isAjio, row.AWBNumber, row.forwardAWB, row.seller_sku, row.pobid]);

  const hasEmpty = skuRecords.some((r) => !r.sku.trim());
  const effectiveSkuRecords = skuRecords.length && !hasEmpty ? [...skuRecords, { _id: "__ajio-picker-extra__", sku: "", pobId: "" }] : skuRecords;
  const showMultiRecordPicker = isAjio && skuRecords.length > 1;
  const showOptionalSkuInput = isAjio && !showMultiRecordPicker;
  const errors = submitted ? validate(platform, values) : {};
  const set = (key: keyof Values) => (e: { currentTarget: { value: string } }) => {
    const next = e.currentTarget.value;
    setValues((v) => ({ ...v, [key]: next }));
  };

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(validate(platform, values)).length) return;
    if (showMultiRecordPicker) {
      const chosen = selectedSkuIndex !== null ? (skuValues[selectedSkuIndex] ?? "").trim() : "";
      if (!chosen) {
        toast.error("Please select an SKU for this claim (multiple master data records match this AWB).");
        return;
      }
    }
    const payload: UpdateCmsPayload = { cmsId: row._id, eCommercePlatform: row.eCommercePlatform };
    if (showMultiRecordPicker && selectedSkuIndex !== null) payload.skuName = (skuValues[selectedSkuIndex] ?? "").trim();
    else if (showOptionalSkuInput && sellerSkuOptional.trim()) payload.skuName = sellerSkuOptional.trim();
    if (isAjio && pobIdTouched && pobIdValue.trim()) payload.pobId = pobIdValue.trim();
    if (values.AWBNumber.trim()) payload.AWBNumber = values.AWBNumber.trim();
    if (showsExtraFields) {
      if (values.forwardAWB.trim()) payload.forwardAWB = values.forwardAWB.trim();
      if (values.subOrderNumber.trim()) payload.subOrderNumber = values.subOrderNumber.trim();
    }
    const claim = values.typeOfClaim.trim();
    if (claim && claim !== (row.typeOfClaim ?? "")) payload.typeOfClaim = claim;
    if (isMyntra) {
      if (isPartialReturnClaim(claim)) payload.disputedAmount = Number(values.disputedAmount);
      else if (isWrongReturnsOwnClaim(claim) && values.physicalReceivedSku.trim()) payload.physicalReceivedSku = values.physicalReceivedSku.trim();
    }
    if (isXbees && values.disputeAmount.trim()) payload.disputeAmount = values.disputeAmount.trim();
    if (isDelhivery && values.domestic.trim()) payload.domestic = values.domestic.trim();
    if (selectedUsername) payload.username = selectedUsername;
    else if (initialUsername) payload.clearUsername = true;
    setBusy(true);
    try {
      const res = await CmsService.updateCMS(payload);
      toast.success(res.displayMessage || "Updated successfully");
      onClose();
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update record"));
      setBusy(false);
    }
  };

  return (
    <AppDialog
      title={`Edit ${row.eCommercePlatform} Claim`}
      onClose={onClose}
      locked={busy}
      footer={
        <div className="tv-row-between" style={{ width: "100%" }}>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              onClose();
              router.push(`${ROUTE_URLS.CMS_UPDATE}?awb=${encodeURIComponent(row.AWBNumber)}&platform=${encodeURIComponent(row.eCommercePlatform)}`);
            }}
          >
            <Icon name="pencil" /> Full Edit Claim
          </button>
          <span className="tv-row">
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="cms-edit-fields" className="primary-button" disabled={busy}>
              {busy ? <span className="tv-spinner small" aria-hidden="true" /> : null}
              Submit
            </button>
          </span>
        </div>
      }
    >
      <form
        id="cms-edit-fields"
        className="tv-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField label="Return AWB" value={values.AWBNumber} onChange={set("AWBNumber")} />
        {showsExtraFields ? (
          <>
            <TextField label="Forward AWB" value={values.forwardAWB} onChange={set("forwardAWB")} />
            <TextField label="Sub Order No" value={values.subOrderNumber} onChange={set("subOrderNumber")} />
          </>
        ) : null}
        <SelectField
          label="Type of Claim"
          value={values.typeOfClaim}
          onChange={set("typeOfClaim")}
          disabled={claimTypes.length === 0}
          placeholder={claimTypes.length ? "Select type of claim" : `No claim types configured for ${row.eCommercePlatform}`}
          options={claimTypes.map((c) => ({ value: c.name, label: c.name }))}
        />
        {isDelhivery ? (
          <SelectField
            label="Domestic"
            required
            value={values.domestic}
            onChange={set("domestic")}
            placeholder="Select Domestic"
            options={DELHIVERY_DOMESTIC_OPTIONS.map((o) => ({ value: o, label: o }))}
            error={errors.domestic}
          />
        ) : null}
        {isMyntra && isPartialReturnClaim(values.typeOfClaim) ? (
          <TextField
            label="Disputed Amount"
            required
            type="number"
            min={0}
            step="any"
            value={values.disputedAmount}
            onChange={set("disputedAmount")}
            error={errors.disputedAmount}
            hint="Auto-filled into Myntra's Disputed Amount input on claim submission"
          />
        ) : null}
        {isXbees ? (
          <TextField
            label="Dispute Amount"
            required
            type="number"
            min={0}
            step="any"
            value={values.disputeAmount}
            onChange={set("disputeAmount")}
            error={errors.disputeAmount}
            hint="Auto-filled into Xbees's Dispute Amount input on claim submission"
          />
        ) : null}
        {isMyntra && isWrongReturnsOwnClaim(values.typeOfClaim) ? (
          <TextField
            label="Physical Received SKU"
            required
            value={values.physicalReceivedSku}
            onChange={set("physicalReceivedSku")}
            error={errors.physicalReceivedSku}
            hint="Auto-filled into Myntra's Physical Received Sku input on claim submission"
          />
        ) : null}
        {showMultiRecordPicker ? (
          <fieldset className="tv-cms-fieldset">
            <legend>
              Seller SKU <small className="tv-cms-required">*</small>
            </legend>
            <div className="tv-cms-choice-list">
              {effectiveSkuRecords.map((record, idx) => {
                const isEmptyRow = !record.sku.trim();
                const rowValue = skuValues[idx] ?? "";
                const selectable = rowValue.trim().length > 0;
                return (
                  <div key={record._id || idx} className={`tv-cms-choice ${selectedSkuIndex === idx ? "is-selected" : ""}`.trim()}>
                    <input
                      type="radio"
                      name="cms-sku-pick"
                      aria-label={`Use SKU ${rowValue || "entered below"}`}
                      checked={selectedSkuIndex === idx}
                      disabled={!selectable}
                      onChange={() => selectable && setSelectedSkuIndex(idx)}
                    />
                    <input
                      className="tv-input"
                      value={rowValue}
                      disabled={!isEmptyRow}
                      placeholder={isEmptyRow ? "Enter SKU for this record" : ""}
                      aria-label="SKU"
                      onChange={(e) => {
                        const next = e.currentTarget.value;
                        setSkuValues((prev) => {
                          const copy = prev.slice();
                          copy[idx] = next;
                          return copy;
                        });
                        if (selectedSkuIndex === idx && !next.trim()) setSelectedSkuIndex(null);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        {showOptionalSkuInput ? (
          <TextField
            label="Seller SKU"
            value={sellerSkuOptional}
            onChange={(e) => setSellerSkuOptional(e.currentTarget.value)}
            hint={
              skuRecords.length === 1 && skuRecords[0].sku.trim()
                ? "Editable. Overrides the SKU auto-detected from master data."
                : "Optional. Use this when the SKU isn't tracked in master data."
            }
          />
        ) : null}
        {isAjio ? (
          pobOptions.length > 1 ? (
            <SelectField
              label="POB ID"
              value={pobIdValue}
              onChange={(e) => {
                setPobIdTouched(true);
                setPobIdValue(e.currentTarget.value);
              }}
              placeholder="Select POB ID"
              options={[
                ...(pobIdValue.trim() && !pobOptions.includes(pobIdValue) ? [{ value: pobIdValue, label: `${pobIdValue} (current)` }] : []),
                ...pobOptions.map((p) => ({ value: p, label: p })),
              ]}
              hint={`${pobOptions.length} POB IDs match this AWB. AJIO rejects a claim filed under the wrong one.`}
            />
          ) : (
            <TextField
              label="POB ID"
              value={pobIdValue}
              onChange={(e) => {
                setPobIdTouched(true);
                setPobIdValue(e.currentTarget.value);
              }}
              hint={
                pobOptions.length === 1
                  ? "Editable. Overrides the POB ID auto-detected from master data."
                  : "Optional. AJIO claims need one to dispatch — import the master data carrying it, or enter it here."
              }
            />
          )
        ) : null}
        <fieldset className="tv-cms-fieldset">
          <legend>Username</legend>
          {credentials.length === 0 ? (
            <p className="tv-muted tv-small">No credentials found for {row.eCommercePlatform || "this platform"}. Add credentials in Settings first.</p>
          ) : (
            <div className="tv-cms-choice-list">
              {credentials.map((cred) => (
                <label key={cred.username} className={`tv-cms-choice ${selectedUsername === cred.username ? "is-selected" : ""}`.trim()}>
                  <input type="checkbox" checked={selectedUsername === cred.username} onChange={() => setSelectedUsername((prev) => (prev === cred.username ? "" : cred.username))} />
                  <span>{cred.username}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {platform === "nykaa" ? (
          <fieldset className="tv-cms-fieldset">
            <legend>Nykaa Fashion Claim Details (read-only)</legend>
            <dl className="tv-kv">
              <dt>Vendor Code</dt>
              <dd>{row.nykaaClaimDetails?.vendorCode || "- - -"}</dd>
              <dt>SKU ID</dt>
              <dd>{row.nykaaClaimDetails?.skuId || "- - -"}</dd>
              <dt>Return Type</dt>
              <dd>{row.nykaaClaimDetails?.returnType || "- - -"}</dd>
            </dl>
          </fieldset>
        ) : null}
      </form>
    </AppDialog>
  );
}
