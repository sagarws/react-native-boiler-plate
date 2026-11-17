"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormik } from "formik";
import { CLAIM_SAVE_AND_TICKET_CREATE, UPDATE_EXISTED_CLAIM_FROM_CMS } from "@/config/constant";
import { errorMessage, toast } from "@/lib/events";
import { CmsService } from "@/services/cms-service";
import { createCMS, patchCreatedClaim, settleCreatedClaim, uploadCmsImage } from "@/services/cms-create-service";
import { useDispatch, useSelector } from "@/store";
import { completeScriptProgress, startScriptProgress, updateScriptProgress } from "@/store/script-progress-slice";
import {
  MYNTRA_INITIAL_CLAIM_DETAILS,
  NYKAA_INITIAL_CLAIM_DETAILS,
  OTHER_INITIAL_CLAIM_DETAILS,
  PACKING_SIDES,
  type ExistingCmsPreview,
  type ICmsCreate,
  type INykaaClaimDetails,
  type StoredFile,
  type XbeesPackingImage,
} from "@/types/cms-create";
import type { UpdateCmsPayload } from "@/types/cms";
import { keyOfUrl } from "@/features/cms-create/hooks";
import { isFileSrc, srcLabel, type MediaSrc } from "@/features/cms-create/media/media-thumb";
import { platformAccounts } from "@/features/cms-create/platforms";
import { buildTextPdf } from "@/features/cms-create/simple-pdf";
import {
  amazonCmsValidation,
  cmsValidation,
  delhiveryCmsValidation,
  flipkartCmsValidation,
  meeshoCmsValidation,
  myntraCmsValidation,
  nykaaCmsValidation,
  snapdealCmsValidation,
  tataCliqCmsValidation,
  xbeesCmsValidation,
} from "@/features/cms-create/validation";

export interface CreateCmsFormOptions {
  platformLabel: string;
  skus: string[];
  feedId: string;
  sideImages: MediaSrc[];
  resetSideImages: () => void;
  onSuccess?: () => void;
  /** /cms/update: Save goes to updateCMS whenever a claim is loaded. */
  updateFlowEnabled?: boolean;
  /** /cms/update: keep the form filled after a successful update. */
  keepFormAfterUpdate?: boolean;
}

export const INITIAL_VALUES: ICmsCreate = {
  eCommercePlatform: "",
  AWBNumber: "",
  typeOfClaim: "",
  costOfMissingArticle: "",
  returnOrderId: "",
  skuName: "",
  pobId: "",
  customerOrderNumber: "",
  forwardAWB: "",
  remark: "",
  returnVideo: "",
  returnVideoLink: "",
  forwardVideo: "",
  forwardVideoLink: "",
  sideImages: "",
  returnProductImage: "",
  forwardSentProductImage: "",
  podProof: "",
  eitherVideoOrLink: "",
  additionalFieldTitle: "",
  additionalFieldValue: "",
  myntraClaimDetails: { ...MYNTRA_INITIAL_CLAIM_DETAILS },
  nykaaClaimDetails: { ...NYKAA_INITIAL_CLAIM_DETAILS },
  otherClaimDetails: { ...OTHER_INITIAL_CLAIM_DETAILS },
  ajio_account_email: "",
  meesho_account_email: "",
  snapdeal_account_username: "",
  subOrderNumber: "",
  packetId: "",
  stateOfThePacket: "",
  barcodeImage: "",
  receivedProductImage_1: "",
  reverseWayBillImage: "",
  logisticsPartnerName: "",
  typeOfClaimName: "",
  outerPackageImage_1: "",
  outerPackageImage_2: "",
  innerPackageImage_1: "",
  innerPackageImage_2: "",
  productImage_1: "",
  productImage_2: "",
  podImage_1: "",
  podImage_2: "",
};

const COMMON = new Set([
  "eCommercePlatform",
  "AWBNumber",
  "typeOfClaim",
  "costOfMissingArticle",
  "returnOrderId",
  "skuName",
  "pobId",
  "customerOrderNumber",
  "forwardAWB",
  "remark",
  "returnVideo",
  "returnVideoLink",
  "forwardVideo",
  "forwardVideoLink",
  "returnProductImage",
  "forwardSentProductImage",
  "podProof",
  "eitherVideoOrLink",
  "additionalFieldTitle",
  "additionalFieldValue",
  "ajio_account_email",
]);
const MYNTRA_KEYS = new Set(["eCommercePlatform", "AWBNumber", "typeOfClaim", "forwardAWB", "remark", "returnVideo", "returnVideoLink", "forwardVideo", "forwardVideoLink", "eitherVideoOrLink"]);
const MEESHO_KEYS = new Set([
  "eCommercePlatform",
  "AWBNumber",
  "typeOfClaim",
  "typeOfClaimName",
  "costOfMissingArticle",
  "forwardAWB",
  "remark",
  "returnVideo",
  "returnVideoLink",
  "forwardVideo",
  "forwardVideoLink",
  "subOrderNumber",
  "packetId",
  "stateOfThePacket",
  "barcodeImage",
  "receivedProductImage_1",
  "reverseWayBillImage",
  "eitherVideoOrLink",
  "logisticsPartnerName",
  "meesho_account_email",
]);
const SNAPDEAL_KEYS = new Set([
  "eCommercePlatform",
  "AWBNumber",
  "typeOfClaim",
  "forwardAWB",
  "remark",
  "returnVideo",
  "returnVideoLink",
  "forwardVideo",
  "forwardVideoLink",
  "subOrderNumber",
  "costOfMissingArticle",
  "outerPackageImage_1",
  "outerPackageImage_2",
  "innerPackageImage_1",
  "innerPackageImage_2",
  "productImage_1",
  "productImage_2",
  "podImage_1",
  "podImage_2",
  "eitherVideoOrLink",
  "snapdeal_account_username",
]);
const SNAP_SLOTS = ["outerPackageImage_1", "outerPackageImage_2", "innerPackageImage_1", "innerPackageImage_2", "productImage_1", "productImage_2", "podImage_1", "podImage_2"] as const;

const trimOrUndef = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);
const fileKey = (v: StoredFile | string | null | undefined): string => (!v ? "" : typeof v === "string" ? v : (v.fileKey ?? ""));
const keyList = (v: (StoredFile | null)[] | undefined): string[] => (v ?? []).map(fileKey).filter(Boolean);

/** Same claim always gets the same simulated runner result (≈75% ticket created). */
const runnerSucceeds = (awb: string) => [...awb].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 4 !== 0;

/**
 * Port of TrackVid `useCreateCmsForm`: Formik + the per-platform yup schema; the submit builds the multipart
 * createCMS body (per-platform whitelist, six-side PDF for the common layout, `autoClaim` always sent) or, with a
 * loaded claim, the updateCMS payload. `applyExistingClaim` hydrates the form from a find-by-awb hit.
 */
export function useCreateCmsForm({ platformLabel, skus, feedId, sideImages, resetSideImages, onSuccess, updateFlowEnabled = false, keepFormAfterUpdate = false }: CreateCmsFormOptions) {
  const user = useSelector((s) => s.profile.userProfile);
  const dispatch = useDispatch();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingCmsId, setEditingCmsId] = useState<string | null>(null);
  const [existingClaim, setExistingClaim] = useState<ExistingCmsPreview | null>(null);
  const autoClaimRef = useRef(false);
  const timers = useRef(new Set<number>());
  const runningJob = useRef<{ jobId: string; cmsId: string; awb: string } | null>(null);

  const label = platformLabel.trim().toLowerCase();
  const isMyntra = label === "myntra";
  const isNykaa = label === "nykaa";
  const isAjio = label === "ajio";
  const isMeesho = label === "meesho";
  const isSnapdeal = label === "snapdeal";
  const isFlipkart = label === "flipkart";
  const isAmazon = label === "amazon";
  const isTataCliq = label === "tata cliq" || label === "tatacliq";
  const isDelhivery = label === "delhivery";
  const isXbees = label === "xbees";
  const usesOther = isFlipkart || isTataCliq || isDelhivery || isAmazon || isXbees;
  const requiresSixSidePdf = !isMyntra && !isMeesho && !isSnapdeal && !usesOther;

  const validationSchema = isMyntra
    ? myntraCmsValidation
    : isNykaa
      ? nykaaCmsValidation(skus)
      : isMeesho
        ? meeshoCmsValidation
        : isSnapdeal
          ? snapdealCmsValidation
          : isAmazon
            ? amazonCmsValidation(skus)
            : isFlipkart
              ? flipkartCmsValidation(skus)
              : isTataCliq
                ? tataCliqCmsValidation(skus)
                : isDelhivery
                  ? delhiveryCmsValidation(skus)
                  : isXbees
                    ? xbeesCmsValidation(skus)
                    : cmsValidation(skus);

  // Runner simulation timers: cleared on unmount; a job still running is settled so the shell widget never hangs.
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const id of set) window.clearTimeout(id);
      set.clear();
      const job = runningJob.current;
      if (job) {
        const ok = runnerSucceeds(job.awb);
        settleCreatedClaim(job.cmsId, ok);
        dispatch(completeScriptProgress({ jobId: job.jobId, total: 1, running: 0, processed: 1, success: ok ? 1 : 0, failed: ok ? 0 : 1, errors: ok ? [] : [{ awbNumber: job.awb, error: "Order not found on the seller portal for this AWB" }], failedAwbNumbers: ok ? [] : [job.awb] }));
        runningJob.current = null;
      }
    };
  }, [dispatch]);

  const schedule = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  };

  /** Simulated `cms:script:progress` for the one claim "Create Ticket" dispatched. */
  const runTicketJob = (jobId: string, cmsId: string, awb: string) => {
    runningJob.current = { jobId, cmsId, awb };
    dispatch(startScriptProgress({ total: 1, running: 1, jobId }));
    dispatch(updateScriptProgress({ jobId, status: "QUEUED", queued: 1, running: 0 }));
    schedule(() => dispatch(updateScriptProgress({ jobId, status: "RUNNING", queued: 0, running: 1 })), 1500);
    schedule(() => {
      const ok = runnerSucceeds(awb);
      const ticket = settleCreatedClaim(cmsId, ok);
      runningJob.current = null;
      dispatch(
        completeScriptProgress({
          jobId,
          total: 1,
          running: 0,
          processed: 1,
          success: ok ? 1 : 0,
          failed: ok ? 0 : 1,
          errors: ok ? [] : [{ awbNumber: awb, error: "Order not found on the seller portal for this AWB" }],
          failedAwbNumbers: ok ? [] : [awb],
        }),
      );
      if (ok) toast.success(`Ticket ${ticket} created for AWB ${awb}`);
      else toast.error(`Auto claim failed for AWB ${awb}. Retry it from Manage SPF Claims.`);
    }, 5000);
  };

  const sixSidePdf = async (): Promise<string | null> => {
    const pdf = buildTextPdf(
      [{ text: `Product side images — AWB ${formik.values.AWBNumber}`, size: 14, bold: true }, ...sideImages.map((img, i) => ({ text: `${i + 1}. ${isFileSrc(img) ? img.name : srcLabel(img).slice(0, 60)}` }))],
      false,
    );
    const fd = new FormData();
    fd.append("file", new File([pdf], `six-side-${Date.now()}.pdf`, { type: "application/pdf" }));
    fd.append("feedId", feedId || "");
    const res = await uploadCmsImage(fd);
    return res.data.key || null;
  };

  const formik = useFormik<ICmsCreate>({
    initialValues: INITIAL_VALUES,
    validationSchema,
    onSubmit: async (submitted) => {
      let values: ICmsCreate = { ...submitted };
      const soleAccount = (): string => {
        const accounts = platformAccounts(user, platformLabel);
        return accounts.length === 1 ? accounts[0] : "";
      };
      if (usesOther && !values.otherClaimDetails?.username?.trim()) {
        const only = soleAccount();
        if (only) values = { ...values, otherClaimDetails: { ...OTHER_INITIAL_CLAIM_DETAILS, ...values.otherClaimDetails, username: only } };
      }
      if (isAjio && !values.ajio_account_email?.trim()) values = { ...values, ajio_account_email: soleAccount() || values.ajio_account_email };
      if (isMeesho && !values.meesho_account_email?.trim()) values = { ...values, meesho_account_email: soleAccount() || values.meesho_account_email };
      if (isSnapdeal && !values.snapdeal_account_username?.trim()) values = { ...values, snapdeal_account_username: soleAccount() || values.snapdeal_account_username };
      if (isMyntra && !values.myntraClaimDetails?.username?.trim()) {
        const only = soleAccount();
        if (only) values = { ...values, myntraClaimDetails: { ...MYNTRA_INITIAL_CLAIM_DETAILS, ...values.myntraClaimDetails, username: only } };
      }

      setIsSubmitting(true);
      const formData = new FormData();
      try {
        if (requiresSixSidePdf) {
          if (values.additionalFieldTitle !== "" && values.additionalFieldValue === "") {
            formik.setFieldError("additionalFieldValue", "*required");
            return;
          }
          if (values.additionalFieldValue !== "" && values.additionalFieldTitle === "") {
            formik.setFieldError("additionalFieldTitle", "*required");
            return;
          }
        }
        values.AWBNumber = values.AWBNumber.split("(")[0];
        if (values.forwardAWB) values.forwardAWB = values.forwardAWB.split("(")[0];

        if ((UPDATE_EXISTED_CLAIM_FROM_CMS || updateFlowEnabled) && editingCmsId) {
          const payload: UpdateCmsPayload = { cmsId: editingCmsId };
          if (requiresSixSidePdf && sideImages.length > 0) {
            if (sideImages.length < 3 || sideImages.length > 9) {
              formik.setFieldTouched("sideImages", true, false);
              formik.setFieldError(
                "sideImages",
                sideImages.length > 9 ? "Maximum nine images allowed" : existingClaim?.sixSideImages ? "Remove the new images to keep the existing PDF, or add at least 3 new images to replace it." : "Minimum three images required",
              );
              return;
            }
            const key = await sixSidePdf();
            if (!key) {
              toast.error("Six-side images upload failed");
              return;
            }
            payload.sixSideImages = key;
            payload.eCommercePlatform = platformLabel;
          }
          const set = (k: string, v: unknown) => {
            if (v !== undefined) payload[k] = v;
          };
          set("AWBNumber", trimOrUndef(values.AWBNumber));
          set("forwardAWB", trimOrUndef(values.forwardAWB));
          set("typeOfClaim", trimOrUndef(values.typeOfClaim));
          set("subOrderNumber", trimOrUndef(values.subOrderNumber));
          const disputed = values.myntraClaimDetails?.disputedAmount;
          if (isMyntra && disputed) payload.disputedAmount = Number(disputed);
          set("physicalReceivedSku", isMyntra ? trimOrUndef(values.myntraClaimDetails?.physicalReceivedSku) : undefined);
          if (isXbees && values.otherClaimDetails?.disputeAmount) payload.disputeAmount = values.otherClaimDetails.disputeAmount;
          set("domestic", isDelhivery ? trimOrUndef(values.otherClaimDetails?.domestic) : undefined);
          set("skuName", trimOrUndef(values.skuName));
          set("pobId", isAjio ? trimOrUndef(values.pobId) : undefined);
          const username =
            trimOrUndef(values.ajio_account_email) ||
            trimOrUndef(values.meesho_account_email) ||
            trimOrUndef(values.snapdeal_account_username) ||
            trimOrUndef(values.myntraClaimDetails?.username) ||
            trimOrUndef(values.nykaaClaimDetails?.username) ||
            trimOrUndef(values.otherClaimDetails?.username);
          if (username) {
            payload.username = username;
            payload.eCommercePlatform = platformLabel;
          }
          if (isMyntra) {
            set("myntraShippingLabelImage", trimOrUndef(values.myntraClaimDetails?.shippingLabelImage));
            payload.myntraPackingImages = (values.myntraClaimDetails?.packingImages ?? []).filter(Boolean);
            const video = trimOrUndef(values.myntraClaimDetails?.damagedProductVideo);
            if (video) payload.myntraDamagedProductVideo = video;
            else set("myntraDamagedProductVideoLink", trimOrUndef(values.myntraClaimDetails?.damagedProductVideoLink));
            payload.eCommercePlatform = platformLabel;
          }
          set("returnProductImage", trimOrUndef(values.returnProductImage));
          set("forwardSentProductImage", trimOrUndef(values.forwardSentProductImage));
          set("podProof", trimOrUndef(values.podProof));
          if (typeof values.remark === "string") payload.remark = values.remark;
          set("returnVideoLink", trimOrUndef(values.returnVideoLink));
          set("forwardVideoLink", trimOrUndef(values.forwardVideoLink));
          if (isMeesho) {
            set("stateOfThePacket", trimOrUndef(values.stateOfThePacket));
            set("packetId", trimOrUndef(values.packetId));
            set("logisticsPartnerName", trimOrUndef(values.logisticsPartnerName));
            const cost = Number(values.costOfMissingArticle);
            if (values.costOfMissingArticle && Number.isFinite(cost) && cost >= 0) payload.costOfMissingArticle = cost;
            set("barcodeImage", trimOrUndef(values.barcodeImage));
            set("receivedProductImage_1", trimOrUndef(values.receivedProductImage_1));
            set("reverseWayBillImage", trimOrUndef(values.reverseWayBillImage));
            payload.eCommercePlatform = platformLabel;
          }
          if (isSnapdeal) {
            for (const f of SNAP_SLOTS) set(f, trimOrUndef(values[f]));
            payload.eCommercePlatform = platformLabel;
          }
          if (isNykaa) {
            set("nykaaVendorCode", trimOrUndef(values.nykaaClaimDetails?.vendorCode));
            set("nykaaSkuId", trimOrUndef(values.nykaaClaimDetails?.skuId));
            set("nykaaReturnType", trimOrUndef(values.nykaaClaimDetails?.returnType));
            payload.eCommercePlatform = platformLabel;
          }
          if (isFlipkart || isTataCliq || isDelhivery || isAmazon) {
            const o = values.otherClaimDetails ?? OTHER_INITIAL_CLAIM_DETAILS;
            set("otherShippingLabelImage", trimOrUndef(o.shippingLabelImage));
            payload.otherPackingImages = (o.packingImages as unknown[]).filter((k): k is string => typeof k === "string" && Boolean(k.trim()));
            if (isAmazon) {
              payload.otherContentsOfReturnImages = o.contentsOfReturnImages.filter(Boolean);
              set("otherSerialNumberImage", trimOrUndef(o.serialNumberImage));
              set("otherFulfillmentChannel", trimOrUndef(o.fulfillmentChannel));
            }
            if (isFlipkart) set("otherClaimArea", trimOrUndef(o.claimArea));
            if (isTataCliq) {
              set("otherQcReason", trimOrUndef(o.qcReason));
              if (typeof o.qcSubReason === "string") payload.otherQcSubReason = o.qcSubReason.trim();
              const cleaned = Object.fromEntries(Object.entries(o.qcImages ?? {}).filter(([, k]) => typeof k === "string" && k.trim()));
              if (Object.keys(cleaned).length) payload.otherQcImages = cleaned;
              if (typeof o.packagingVideoUrl === "string") payload.otherPackagingVideoUrl = o.packagingVideoUrl.trim();
              if (typeof o.unboxingVideoUrl === "string") payload.otherUnboxingVideoUrl = o.unboxingVideoUrl.trim();
            }
            set("otherParentSelection", trimOrUndef(o.parentSelection));
            payload.eCommercePlatform = platformLabel;
          }

          // Session-created rows are not in the list service; update them in the create service instead.
          const patchedLocally = patchCreatedClaim(editingCmsId, {
            AWBNumber: values.AWBNumber,
            forwardAWB: values.forwardAWB ?? "",
            typeOfClaim: values.typeOfClaim,
            remark: values.remark ?? "",
            returnVideoLink: values.returnVideoLink ?? "",
            forwardVideoLink: values.forwardVideoLink ?? "",
            customerOrderNumber: values.customerOrderNumber ?? "",
          });
          const body = patchedLocally ? { isSuccess: true, displayMessage: "Claim updated successfully" } : await CmsService.updateCMS(payload);
          if (body.isSuccess) {
            toast.success(body.displayMessage || "Claim updated successfully");
            if (keepFormAfterUpdate) onSuccess?.();
            else {
              setEditingCmsId(null);
              setExistingClaim(null);
              formik.resetForm({ values: { ...INITIAL_VALUES, eCommercePlatform: values.eCommercePlatform } });
              resetSideImages();
              onSuccess?.();
            }
          } else toast.error(body.displayMessage || "Update failed");
          return;
        }

        if (requiresSixSidePdf) {
          if (sideImages.length >= 3 && sideImages.length <= 9) {
            formik.setFieldError("sideImages", undefined);
            const key = await sixSidePdf();
            if (!key) {
              toast.error("Six-side images upload failed");
              return;
            }
            formData.append("sixSideImages", key);
          } else {
            formik.setFieldTouched("sideImages", true, false);
            formik.setFieldError("sideImages", sideImages.length > 9 ? "Maximum nine images allowed" : "Minimum three images required");
            return;
          }
        }
        if (feedId) formData.append("feedId", feedId);
        const allowed = isMyntra ? MYNTRA_KEYS : isMeesho ? MEESHO_KEYS : isSnapdeal ? SNAPDEAL_KEYS : COMMON;
        for (const [key, value] of Object.entries(values) as [keyof ICmsCreate, unknown][]) {
          if (key === "myntraClaimDetails") {
            if (isMyntra) formData.append(key, JSON.stringify(value));
            continue;
          }
          if (key === "nykaaClaimDetails") {
            if (isNykaa) formData.append(key, JSON.stringify(value));
            continue;
          }
          if (key === "otherClaimDetails") {
            if (usesOther || label === "shopify") formData.append(key, JSON.stringify(value));
            continue;
          }
          if ((key === "pobId" || key === "ajio_account_email") && !isAjio) continue;
          if (!allowed.has(key)) continue;
          if (value !== "" && value !== undefined && value !== null) formData.append(key, String(value));
        }
        const wantsAutoClaim = autoClaimRef.current && CLAIM_SAVE_AND_TICKET_CREATE;
        formData.append("autoClaim", wantsAutoClaim ? "true" : "false");
        const res = await createCMS(formData);
        if (res.autoClaim?.requested && !res.autoClaim.dispatched) toast.warning(res.displayMessage || "Claim created. Auto claim not started.");
        else toast.success(res.displayMessage || "CMS created successfully");
        if (res.autoClaim?.dispatched && res.autoClaim.jobId) runTicketJob(res.autoClaim.jobId, res.data._id, res.data.AWBNumber);
        formik.resetForm({ values: { ...INITIAL_VALUES, eCommercePlatform: values.eCommercePlatform } });
        resetSideImages();
        onSuccess?.();
      } catch (e) {
        toast.error(errorMessage(e, "Something went wrong!"));
      } finally {
        setIsSubmitting(false);
        // Always disarm, so a failed "Create Ticket" can never make the next plain Save dispatch.
        autoClaimRef.current = false;
      }
    },
  });

  const formikRef = useRef(formik);
  useEffect(() => {
    formikRef.current = formik;
  });

  const submitWithAutoClaim = () => {
    autoClaimRef.current = true;
    formik.handleSubmit();
  };

  const lastLoadedId = useRef<string | null>(null);

  /** find-by-awb result → form. Deps-free (reads formik through a ref) so the debounced lookup never loops. */
  const applyExistingClaim = useCallback((claim: ExistingCmsPreview | null) => {
    const f = formikRef.current;
    if (!claim) {
      setEditingCmsId(null);
      setExistingClaim(null);
      lastLoadedId.current = null;
      return;
    }
    setEditingCmsId(claim._id);
    setExistingClaim(claim);
    const setIfChanged = (field: string, value: unknown) => {
      if (value === undefined || value === null || value === "") return;
      const current = (f.values as unknown as Record<string, unknown>)[field];
      if (current === value) return;
      void f.setFieldValue(field, typeof value === "number" ? String(value) : value);
    };
    setIfChanged("typeOfClaim", claim.typeOfClaim);
    setIfChanged("forwardAWB", claim.forwardAWB);
    setIfChanged("customerOrderNumber", claim.customerOrderNumber);
    setIfChanged("remark", claim.remark);
    setIfChanged("returnVideoLink", claim.returnVideoLink);
    setIfChanged("forwardVideoLink", claim.forwardVideoLink);
    setIfChanged("subOrderNumber", claim.subOrderNumber);
    setIfChanged("logisticsPartnerName", claim.logisticsPartnerName);
    setIfChanged("packetId", claim.packetId);
    setIfChanged("stateOfThePacket", claim.stateOfThePacket);
    setIfChanged("costOfMissingArticle", claim.costOfMissingArticle);
    setIfChanged("skuName", claim.skuName);
    setIfChanged("pobId", claim.pobid);
    setIfChanged("ajio_account_email", claim.ajio_account_email);
    setIfChanged("meesho_account_email", claim.meesho_account_email);
    setIfChanged("snapdeal_account_username", claim.snapdeal_account_username);
    // Stored images as keys (previews are hydrated by each platform form).
    setIfChanged("returnProductImage", claim.returnProductImage ? keyOfUrl(claim.returnProductImage) : "");
    setIfChanged("forwardSentProductImage", claim.forwardSentProductImage ? keyOfUrl(claim.forwardSentProductImage) : "");
    setIfChanged("podProof", claim.podProof ? keyOfUrl(claim.podProof) : "");
    for (const slot of ["barcodeImage", "receivedProductImage_1", "reverseWayBillImage", ...SNAP_SLOTS] as const) setIfChanged(slot, fileKey(claim[slot]));

    const p = (claim.eCommercePlatform || "").trim().toLowerCase();
    if (claim.myntraClaimDetails && p === "myntra") {
      const m = claim.myntraClaimDetails;
      void f.setFieldValue("myntraClaimDetails", {
        ...MYNTRA_INITIAL_CLAIM_DETAILS,
        shippingLabelImage: fileKey(m.shippingLabelImage),
        packingImages: keyList(m.packingImages),
        damagedProductVideo: fileKey(m.damagedProductVideo),
        damagedProductVideoLink: m.damagedProductVideoLink ?? "",
        disputedAmount: m.disputedAmount ?? "",
        physicalReceivedSku: m.physicalReceivedSku ?? "",
        username: m.username ?? "",
      });
    }
    if (claim.nykaaClaimDetails && p.startsWith("nykaa")) {
      const n = claim.nykaaClaimDetails;
      const returnType: INykaaClaimDetails["returnType"] = n.returnType === "RTO" || n.returnType === "DTO" || n.returnType === "REPL" ? n.returnType : "";
      void f.setFieldValue("nykaaClaimDetails", { ...NYKAA_INITIAL_CLAIM_DETAILS, vendorCode: n.vendorCode ?? "", skuId: n.skuId ?? "", returnType, username: n.username ?? "" });
    }
    if (claim.otherClaimDetails && ["flipkart", "tata cliq", "tatacliq", "delhivery", "amazon", "xbees", "shopify"].includes(p)) {
      const o = claim.otherClaimDetails;
      const loadedUser = o.username?.trim() ?? "";
      const currentUser = f.values.otherClaimDetails?.username?.trim() ?? "";
      const packing: string[] | XbeesPackingImage[] =
        p === "xbees"
          ? PACKING_SIDES.map((side, i) => {
              const list = o.packingImages ?? [];
              const tagged = list.find((x) => x && (x as StoredFile & { side?: string }).side === side) ?? list[i];
              return { side, fileKey: fileKey(tagged) };
            })
          : keyList(o.packingImages);
      void f.setFieldValue("otherClaimDetails", {
        ...OTHER_INITIAL_CLAIM_DETAILS,
        parentSelection: o.parentSelection ?? "",
        claimArea: o.claimArea ?? "",
        shipmentIssue: o.shipmentIssue ?? "",
        subcategory: o.subcategory ?? "",
        domestic: o.domestic ?? "",
        fulfillmentChannel: o.fulfillmentChannel ?? "",
        disputeAmount: o.disputeAmount ?? "",
        shippingLabelImage: fileKey(o.shippingLabelImage),
        serialNumberImage: fileKey(o.serialNumberImage),
        packingImages: packing,
        contentsOfReturnImages: keyList(o.contentsOfReturnImages),
        qcReason: o.qcReason ?? "",
        qcSubReason: o.qcSubReason ?? "",
        qcImages: Object.fromEntries(Object.entries(o.qcImages ?? {}).map(([k, v]) => [k, fileKey(v)])),
        packagingVideoUrl: o.packagingVideoUrl ?? "",
        unboxingVideoUrl: o.unboxingVideoUrl ?? "",
        // A loaded claim with no account must not erase the one the dropdown already picked.
        username: loadedUser || currentUser,
      });
    }
    if (lastLoadedId.current !== claim._id) {
      lastLoadedId.current = claim._id;
      toast.success("Existing claim loaded — Save will update this claim");
    }
  }, []);

  const cancelEditingMode = useCallback(() => {
    setEditingCmsId(null);
    setExistingClaim(null);
  }, []);

  return { formik, isSubmitting, submitWithAutoClaim, editingCmsId, existingClaim, applyExistingClaim, cancelEditingMode };
}
