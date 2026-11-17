"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { Banner } from "@/components/ui/banner";
import { Combobox } from "@/components/ui/combobox";
import { TextField } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { EmptyState, LoadingState, Spinner } from "@/components/ui/states";
import { CLAIM_SAVE_AND_TICKET_CREATE, UPDATE_EXISTED_CLAIM_FROM_CMS } from "@/config/constant";
import ROUTE_URLS from "@/config/route";
import { canAccess } from "@/lib/permissions";
import { findCmsByAwb } from "@/services/cms-autofetch-service";
import { getAutomationPlatforms } from "@/services/cms-create-service";
import { useSelector } from "@/store";
import { AMAZON_FULFILLMENT_CHANNEL_OPTIONS, DELHIVERY_DOMESTIC_OPTIONS, DELHIVERY_SHIPMENT_ISSUE, DELHIVERY_SUBCATEGORY_OPTIONS, FLIPKART_CLAIM_AREA_OPTIONS, type ExistingCmsPreview, type IECommercePlatform } from "@/types/cms-create";
import { BulkClaimDialog } from "@/features/cms-create/bulk-claim-dialog";
import { FeedPicker } from "@/features/cms-create/feed-picker";
import { errorAt, useDebounced, useUnmounted } from "@/features/cms-create/hooks";
import { MediaCaptureProvider } from "@/features/cms-create/media/media-capture-provider";
import type { MediaSrc } from "@/features/cms-create/media/media-thumb";
import { automationKey, buildPlatformOptions, isPlatformKey, matchClaimTypeOption, resolvePlatformKey } from "@/features/cms-create/platforms";
import { PLATFORM_COMPONENTS } from "@/features/cms-create/platforms/index";
import { needsSubReason, qcSelectionFromClaimType } from "@/features/cms-create/tatacliq-qc";
import { INITIAL_VALUES, useCreateCmsForm } from "@/features/cms-create/use-create-cms-form";

const options = (list: readonly string[]) => list.map((v) => ({ value: v, label: v }));

/** Every renderable image URL of a loaded claim (carried into the next platform's Rearrange pool on /cms/update). */
function claimImages(claim: ExistingCmsPreview | null): string[] {
  if (!claim) return [];
  const urls: string[] = [];
  const safe = (v: unknown): v is string => typeof v === "string" && /^(https?:\/\/|\/|data:image\/)/i.test(v.trim());
  const push = (v: unknown) => {
    if (safe(v)) urls.push(v);
  };
  push(claim.returnProductImage);
  push(claim.forwardSentProductImage);
  push(claim.podProof);
  for (const slot of [claim.barcodeImage, claim.receivedProductImage_1, claim.reverseWayBillImage, claim.outerPackageImage_1, claim.outerPackageImage_2, claim.innerPackageImage_1, claim.innerPackageImage_2, claim.productImage_1, claim.productImage_2, claim.podImage_1, claim.podImage_2]) push(slot?.url);
  const m = claim.myntraClaimDetails;
  if (m) {
    push(m.shippingLabelImage?.url);
    (m.packingImages ?? []).forEach((p) => push(p?.url));
  }
  const o = claim.otherClaimDetails;
  if (o) {
    push(o.shippingLabelImage?.url);
    (o.packingImages ?? []).forEach((p) => push(p?.url));
    (o.contentsOfReturnImages ?? []).forEach((p) => push(p?.url));
    push(o.serialNumberImage?.url);
  }
  return [...new Set(urls)];
}

/**
 * TrackVid `pages/CreateCms`: `/cms/create` and `/cms/update?awb=&platform=` (full edit). Platform picker, claim-type
 * cascade (parent selection per platform vocabulary), the platform's own two-column form, feed picker, Bulk Claim,
 * Reset, Save / Update Claim and "Create Ticket" (save + auto claim).
 */
export function CreateCmsPage({ mode }: { mode: "create" | "update" }) {
  const isUpdateMode = mode === "update";
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlAwb = searchParams.get("awb") || "";
  const urlPlatform = searchParams.get("platform") || "";
  const updateFlowEnabled = UPDATE_EXISTED_CLAIM_FROM_CMS || isUpdateMode;
  const user = useSelector((s) => s.profile.userProfile);
  const canView = canAccess(user, ["admin"], ["cms::view"]);
  const canEdit = canAccess(user, ["admin"], ["cms::edit"]);
  const unmounted = useUnmounted();

  const [platformKey, setPlatformKey] = useState<string>(() => (urlPlatform ? resolvePlatformKey(urlPlatform) : "ajio"));
  const [feedId, setFeedId] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [sideImages, setSideImages] = useState<MediaSrc[]>([]);
  const [isPartialArticleClaim, setIsPartialArticleClaim] = useState(false);
  const [skus, setSkus] = useState<string[]>([]);
  const [skuPickerOpen, setSkuPickerOpen] = useState(false);
  const [parentSelection, setParentSelection] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [automationPlatforms, setAutomationPlatforms] = useState<string[]>([]);
  const [carryOverImages, setCarryOverImages] = useState<string[]>([]);

  const platforms: IECommercePlatform[] = (user?.company?.settings?.eCommercePlatform ?? []).map((p, i) => ({
    _id: p._id ?? `platform-${i}`,
    name: p.name,
    typeOfClaims: p.typeOfClaims.map((c) => ({ ...c })),
  }));
  const platformsLoading = !user;
  const settings = user?.company?.settings;
  const increffFlag = (settings as { increffBulkClaim?: boolean } | undefined)?.increffBulkClaim ?? settings?.integrationAccess?.increff === true;
  const showBulkClaimButton = Boolean(increffFlag) && (settings?.increffAllocation ?? []).some((e) => e.allowed && e.platform);

  const platformOptions = buildPlatformOptions(platforms);
  // Snap to the first option when the company has no entry for the current key (no AJIO configured, etc.).
  if (platformOptions.length > 0 && !platformOptions.some((p) => p.key === platformKey)) setPlatformKey(platformOptions[0].key);
  const selectedPlatform = platformOptions.find((p) => p.key === platformKey) ?? platformOptions[0];
  const platformLabel = selectedPlatform?.label || "AJIO";
  const platformLower = platformLabel.trim().toLowerCase();
  const platformDbRecord = platforms.find((p) => p.name.toLowerCase() === platformLower);

  useEffect(() => {
    if (!CLAIM_SAVE_AND_TICKET_CREATE) return;
    let cancelled = false;
    getAutomationPlatforms()
      .then((res) => {
        if (!cancelled && Array.isArray(res.data.platforms)) setAutomationPlatforms(res.data.platforms);
      })
      .catch(() => {
        // Non-fatal: only plain Save renders, and Auto Claim on /cms still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const canAutoClaim = CLAIM_SAVE_AND_TICKET_CREATE && automationPlatforms.includes(automationKey(selectedPlatform?.key ?? ""));

  const allClaims = platformDbRecord?.typeOfClaims ?? [];
  const enabledClaims = allClaims.filter((c) => !c.isDisable);
  const claimTypeOptions = enabledClaims.length > 0 ? enabledClaims : allClaims;
  const parentSelectionOptions = [...new Set(claimTypeOptions.map((c) => c.parentSelection?.trim() ?? "").filter(Boolean))];
  const hasParentSelection = parentSelectionOptions.length > 0;
  const isAmazonCascade = platformLower === "amazon" && hasParentSelection;
  const isTataCliqCascade = (platformLower === "tata cliq" || platformLower === "tatacliq") && hasParentSelection;
  const isXbeesCascade = platformLower === "xbees" && hasParentSelection;
  const parentLabel = isAmazonCascade ? "Type Of Claim" : isTataCliqCascade ? "Reason Of QC Failure" : isXbeesCascade ? "Dispute Reason" : "Issue Area of Affected Item";
  const childLabel = isAmazonCascade ? "Claim Sub-Reason" : isTataCliqCascade ? "Sub Reason Of Failure" : isXbeesCascade ? "Dispute Sub reason" : "Type Of Claim";
  const parentPlaceholder = `Select ${parentLabel === "Issue Area of Affected Item" ? "Issue Area" : parentLabel}`;
  const filteredClaimTypeOptions = hasParentSelection ? (parentSelection ? claimTypeOptions.filter((c) => c.parentSelection === parentSelection) : []) : claimTypeOptions;
  const hideClaimTypeSelect = isTataCliqCascade && Boolean(parentSelection) && !needsSubReason(qcSelectionFromClaimType(parentSelection, "").reason) && filteredClaimTypeOptions.length === 1;

  const { formik, isSubmitting, submitWithAutoClaim, editingCmsId, existingClaim, applyExistingClaim, cancelEditingMode } = useCreateCmsForm({
    platformLabel,
    skus,
    feedId,
    sideImages,
    resetSideImages: () => setSideImages([]),
    updateFlowEnabled,
    keepFormAfterUpdate: isUpdateMode,
    onSuccess: () => {
      if (isUpdateMode) return;
      setIsPartialArticleClaim(false);
      setParentSelection("");
      setSkus([]);
      setSkuPickerOpen(false);
      setResetSignal((n) => n + 1);
    },
  });
  const { setFieldValue } = formik;

  // typeOfClaim must belong to THIS platform (and, once a parent is chosen, to that parent); spelling drift is
  // rewritten to the catalogue's own key.
  const storedType = formik.values.typeOfClaim || "";
  const fullKey = claimTypeOptions.map((c) => `${c.key}|${c.name}`).join(";");
  const narrowKey = filteredClaimTypeOptions.map((c) => `${c.key}|${c.name}`).join(";");
  const live = useRef({ claimTypeOptions, filteredClaimTypeOptions });
  useEffect(() => {
    live.current = { claimTypeOptions, filteredClaimTypeOptions };
  });
  useEffect(() => {
    const { claimTypeOptions: full, filteredClaimTypeOptions: narrow } = live.current;
    if (!storedType || platformsLoading || full.length === 0) return;
    if (!matchClaimTypeOption(full, storedType)) {
      void setFieldValue("typeOfClaim", "");
      void setFieldValue("typeOfClaimName", "");
      return;
    }
    if (narrow.length === 0) return;
    const matched = matchClaimTypeOption(narrow, storedType);
    if (!matched) {
      void setFieldValue("typeOfClaim", "");
      void setFieldValue("typeOfClaimName", "");
      return;
    }
    const canonical = matched.key || matched.name || "";
    if (canonical && canonical !== storedType) {
      void setFieldValue("typeOfClaim", canonical);
      void setFieldValue("typeOfClaimName", matched.name || "");
    }
  }, [storedType, fullKey, narrowKey, platformsLoading, setFieldValue]);

  // Tata CliQ reasons that take no sub-reason and hold a single claim type: transcribe it.
  useEffect(() => {
    if (!hideClaimTypeSelect) return;
    const only = live.current.filteredClaimTypeOptions[0];
    const value = only?.key || only?.name || "";
    if (!value || storedType === value) return;
    void setFieldValue("typeOfClaim", value);
    void setFieldValue("typeOfClaimName", only?.name || "");
    void setFieldValue("remark", only?.description || "");
  }, [hideClaimTypeSelect, narrowKey, storedType, setFieldValue]);

  // Existing-claim lookup on AWB + platform (debounced 800 ms, stale answers dropped).
  const seq = useRef(0);
  const findClaim = useDebounced((awb: string, platform: string) => {
    if (!awb.trim() || !platform.trim()) {
      applyExistingClaim(null);
      return;
    }
    const id = ++seq.current;
    findCmsByAwb(awb.trim(), platform.trim())
      .then((res) => {
        if (id === seq.current && !unmounted.current) applyExistingClaim(res.data);
      })
      .catch(() => {
        if (id === seq.current && !unmounted.current) applyExistingClaim(null);
      });
  }, 800);
  const findCall = findClaim.call;
  const lookupPlatform = platformDbRecord?.name ?? platformLabel;
  useEffect(() => {
    if (!updateFlowEnabled) return;
    findCall(formik.values.AWBNumber || "", lookupPlatform);
  }, [formik.values.AWBNumber, lookupPlatform, updateFlowEnabled, findCall]);

  // /cms/update: a loaded claim's parent selection drives the cascade UI.
  const [syncedClaimId, setSyncedClaimId] = useState<string | null>(null);
  if (existingClaim && existingClaim._id !== syncedClaimId) {
    setSyncedClaimId(existingClaim._id);
    const parent = existingClaim.otherClaimDetails?.parentSelection;
    if (parent && parent.trim()) setParentSelection(parent);
  }

  // Stamp the platform id (arrives with the profile) without resetting the form.
  const platformId = platformDbRecord?._id ?? "";
  useEffect(() => {
    if (platformId && formik.values.eCommercePlatform !== platformId) void setFieldValue("eCommercePlatform", platformId);
  }, [platformId, formik.values.eCommercePlatform, setFieldValue]);

  // /cms/update: seed the AWB from the URL once; the lookup above then hydrates the rest.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !isUpdateMode || !urlAwb || !platformId) return;
    seeded.current = true;
    void setFieldValue("AWBNumber", urlAwb);
  }, [isUpdateMode, urlAwb, platformId, setFieldValue]);

  // Delhivery's fixed shipment issue is persisted on the row.
  const shipmentIssue = formik.values.otherClaimDetails?.shipmentIssue;
  useEffect(() => {
    if (platformLower === "delhivery" && shipmentIssue !== DELHIVERY_SHIPMENT_ISSUE) void setFieldValue("otherClaimDetails.shipmentIssue", DELHIVERY_SHIPMENT_ISSUE);
  }, [platformLower, resetSignal, shipmentIssue, setFieldValue]);

  /** Platform switch: keep the cross-platform fields, wipe the per-platform bundles and cascade state. */
  const changePlatform = (key: string) => {
    if (key === platformKey) return;
    if (isUpdateMode) setCarryOverImages(claimImages(existingClaim));
    else setCarryOverImages([]);
    const v = formik.values;
    const nextRecord = platforms.find((p) => p.name.toLowerCase() === (platformOptions.find((o) => o.key === key)?.label ?? "").toLowerCase());
    formik.resetForm({
      values: {
        ...INITIAL_VALUES,
        eCommercePlatform: nextRecord?._id ?? "",
        AWBNumber: v.AWBNumber || "",
        forwardAWB: v.forwardAWB || "",
        customerOrderNumber: v.customerOrderNumber || "",
        remark: v.remark || "",
        returnVideo: v.returnVideo || "",
        returnVideoLink: v.returnVideoLink || "",
        forwardVideo: v.forwardVideo || "",
        forwardVideoLink: v.forwardVideoLink || "",
        returnProductImage: v.returnProductImage || "",
        forwardSentProductImage: v.forwardSentProductImage || "",
        podProof: v.podProof || "",
        additionalFieldTitle: v.additionalFieldTitle || "",
        additionalFieldValue: v.additionalFieldValue || "",
      },
    });
    setIsPartialArticleClaim(false);
    setParentSelection("");
    setSkus([]);
    setSkuPickerOpen(false);
    setPlatformKey(key);
  };

  const resetAll = () => {
    formik.resetForm({ values: { ...INITIAL_VALUES, eCommercePlatform: platformId } });
    setSideImages([]);
    setIsPartialArticleClaim(false);
    setParentSelection("");
    setSkus([]);
    setSkuPickerOpen(false);
    setCarryOverImages([]);
    cancelEditingMode();
    setResetSignal((n) => n + 1);
  };

  const setOther = useCallback((field: string, value: string) => void setFieldValue(`otherClaimDetails.${field}`, value), [setFieldValue]);

  if (!canView) {
    return (
      <div className="tv-page">
        <EmptyState icon="lock" title="No access" message="You do not have permission to view SPF claims." />
      </div>
    );
  }
  if (platformsLoading) return <LoadingState label="Loading claim form…" />;

  const title = isUpdateMode ? "Update SPF Claim" : "Create SPF Claim";
  const selectedMatch = matchClaimTypeOption(filteredClaimTypeOptions, storedType);
  const childPlaceholder =
    hasParentSelection && !parentSelection ? `Select ${parentLabel === "Issue Area of Affected Item" ? "Issue Area" : parentLabel} first` : `Select ${childLabel}`;

  const header = (
    <div className="c-form-grid tv-cmsc-grid tv-cmsc-header">
      <div className="tv-cmsc-platform">
        <Combobox label="E-commerce Platform" required value={platformKey} onChange={(v) => v && changePlatform(v)} options={platformOptions.map((p) => ({ value: p.key, label: p.label }))} placeholder="Select Platform" />
        {selectedPlatform ? (
          <span className="tv-cmsc-platform-logo">
            <PlatformLogo name={selectedPlatform.label} showName={false} />
          </span>
        ) : null}
      </div>
      {platformLower === "delhivery" ? (
        <Combobox label="Domestic" required value={formik.values.otherClaimDetails?.domestic ?? ""} onChange={(v) => setOther("domestic", v)} options={options(DELHIVERY_DOMESTIC_OPTIONS)} placeholder="Select Domestic" error={errorAt(formik, "otherClaimDetails.domestic", ["otherClaimDetails.domestic", "otherClaimDetails"])} />
      ) : null}
      {platformLower === "flipkart" ? (
        <Combobox label="Claim Area" required value={formik.values.otherClaimDetails?.claimArea ?? ""} onChange={(v) => setOther("claimArea", v)} options={options(FLIPKART_CLAIM_AREA_OPTIONS)} placeholder="Select Claim Area" error={errorAt(formik, "otherClaimDetails.claimArea", ["otherClaimDetails.claimArea", "otherClaimDetails"])} />
      ) : null}
      {platformLower === "amazon" ? (
        <Combobox
          label="Select Fulfillment Channel"
          required
          value={formik.values.otherClaimDetails?.fulfillmentChannel ?? ""}
          onChange={(v) => setOther("fulfillmentChannel", v)}
          options={options(AMAZON_FULFILLMENT_CHANNEL_OPTIONS)}
          placeholder="Select Fulfillment Channel"
          error={errorAt(formik, "otherClaimDetails.fulfillmentChannel", ["otherClaimDetails.fulfillmentChannel", "otherClaimDetails"])}
        />
      ) : null}
      {hasParentSelection ? (
        <Combobox
          label={parentLabel}
          required
          value={parentSelection}
          onChange={(v) => {
            setParentSelection(v);
            setOther("parentSelection", v);
            void setFieldValue("typeOfClaim", "");
            void setFieldValue("typeOfClaimName", "");
            void setFieldValue("remark", "");
            setIsPartialArticleClaim(false);
          }}
          options={options(parentSelectionOptions)}
          placeholder={parentPlaceholder}
        />
      ) : null}
      {platformLower === "delhivery" ? (
        <>
          <TextField label="Shipment Issue" required disabled value={DELHIVERY_SHIPMENT_ISSUE} readOnly />
          <Combobox label="Select a subcategory" required value={formik.values.otherClaimDetails?.subcategory ?? ""} onChange={(v) => setOther("subcategory", v)} options={options(DELHIVERY_SUBCATEGORY_OPTIONS)} placeholder="Select a subcategory" error={errorAt(formik, "otherClaimDetails.subcategory", ["otherClaimDetails.subcategory", "otherClaimDetails"])} />
        </>
      ) : null}
      {!hideClaimTypeSelect ? (
        <Combobox
          label={childLabel}
          required
          value={selectedMatch ? selectedMatch.key || selectedMatch.name : ""}
          onChange={(v) => {
            const hit = filteredClaimTypeOptions.find((c) => (c.key || c.name) === v);
            void setFieldValue("typeOfClaim", hit ? hit.key || hit.name : "");
            void setFieldValue("typeOfClaimName", hit?.name ?? "");
            void setFieldValue("remark", hit?.description ?? "");
            void formik.setFieldTouched("typeOfClaim", true, false);
            setIsPartialArticleClaim(hit?.key === "partial_articles_received");
          }}
          options={filteredClaimTypeOptions.map((c) => ({ value: c.key || c.name, label: c.name }))}
          disabled={hasParentSelection && !parentSelection}
          placeholder={childPlaceholder}
          error={errorAt(formik, "typeOfClaim")}
          hint={claimTypeOptions.length === 0 ? "No claim types are set up for this platform (Settings → E-commerce Settings)." : undefined}
        />
      ) : null}
    </div>
  );

  const ActiveForm = isPlatformKey(platformKey) ? PLATFORM_COMPONENTS[platformKey] : PLATFORM_COMPONENTS.ajio;
  const showTicket = canAutoClaim && !editingCmsId;
  const disabled = isSubmitting || !canEdit;

  return (
    <div className="tv-page tv-cmsc-page">
      <PageHeading
        title={title}
        crumbs={[{ label: "Manage SPF Claims", href: ROUTE_URLS.CMS }]}
        subtitle={isUpdateMode ? "Edit every field of an existing claim. Save writes back to the same row." : "Pick the marketplace, fill the claim and attach the CCTV video and product images."}
        actions={
          <div className="tv-cmsc-actions">
            {isUpdateMode ? (
              <button type="button" className="secondary-button" onClick={() => router.push(ROUTE_URLS.CMS)} aria-label="Back to Manage SPF Claims">
                <Icon name="arrow-left" /> Back
              </button>
            ) : null}
            <FeedPicker feedId={feedId} onChange={setFeedId} />
            {showBulkClaimButton ? (
              <button type="button" className="secondary-button" onClick={() => setBulkOpen(true)} disabled={!canEdit}>
                <Icon name="upload" /> Bulk Claim
              </button>
            ) : null}
            <button type="button" className="secondary-button" onClick={resetAll}>
              <Icon name="refresh" /> Reset
            </button>
            <button type="button" className={showTicket ? "secondary-button" : "primary-button"} disabled={disabled} onClick={() => formik.handleSubmit()}>
              {isSubmitting ? <Spinner /> : <Icon name="floppy-disk" />} {updateFlowEnabled && editingCmsId ? "Update Claim" : "Save"}
            </button>
            {showTicket ? (
              <button type="button" className="primary-button" disabled={disabled} onClick={submitWithAutoClaim}>
                {isSubmitting ? <Spinner /> : <Icon name="paper-plane" />} Create Ticket
              </button>
            ) : null}
          </div>
        }
      />

      {!canEdit ? <Banner tone="warning" title="View only">Your role cannot create or edit SPF claims (cms::edit). Ask an admin for edit access.</Banner> : null}
      {isUpdateMode && !urlAwb ? (
        <Banner tone="info" title="No claim selected">
          Open a claim from <Link href={ROUTE_URLS.CMS}>Manage SPF Claims</Link> and choose Edit Claim, or type its Return AWB below.
        </Banner>
      ) : null}
      {isUpdateMode && urlAwb && !existingClaim && formik.values.AWBNumber === urlAwb ? (
        <Banner tone="info">
          <span className="tv-row">
            <Spinner /> Looking up the claim for AWB {urlAwb}…
          </span>
        </Banner>
      ) : null}
      {editingCmsId && existingClaim ? (
        <Banner
          tone="success"
          title={`Editing claim for AWB ${existingClaim.AWBNumber}`}
          actions={
            !isUpdateMode ? (
              <button type="button" className="secondary-button compact-button" onClick={cancelEditingMode}>
                Cancel edit
              </button>
            ) : undefined
          }
        >
          Status {existingClaim.status}
          {existingClaim.ticketNumber ? ` · Ticket ${existingClaim.ticketNumber}` : ""} · Save will update this claim.
        </Banner>
      ) : null}
      {platformOptions.length === 0 ? (
        <EmptyState icon="storefront" title="No e-commerce platforms" message="Add a marketplace under Settings → E-commerce Settings to create claims." />
      ) : (
        <MediaCaptureProvider feedId={feedId}>
          <form
            className="tv-cmsc-form"
            onSubmit={(e) => {
              e.preventDefault();
              formik.handleSubmit();
            }}
            noValidate
          >
            <fieldset disabled={!canEdit} className="tv-cmsc-fieldset">
              <ActiveForm
                key={`${platformKey}-${resetSignal}`}
                formik={formik}
                feedId={feedId}
                header={header}
                sideImages={sideImages}
                setSideImages={setSideImages}
                isPartialArticleClaim={isPartialArticleClaim}
                skus={skus}
                setSkus={setSkus}
                skuPickerOpen={skuPickerOpen}
                setSkuPickerOpen={setSkuPickerOpen}
                isAjio={platformLower === "ajio"}
                existingClaim={existingClaim}
                carryOverImages={carryOverImages}
                isUpdateMode={isUpdateMode}
              />
            </fieldset>
          </form>
        </MediaCaptureProvider>
      )}
      {bulkOpen ? <BulkClaimDialog onClose={() => setBulkOpen(false)} /> : null}
    </div>
  );
}
