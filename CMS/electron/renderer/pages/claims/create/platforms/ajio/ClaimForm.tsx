import {
  Box,
  CircularProgress,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import type { ClaimForm } from "../../useClaimForm";
import { useEffect, useMemo, useRef, useState } from "react";
import LeftVideos from "../../LeftVideos";
import CommonRightPart from "../../CommonRightPart";
import { useCmsAutoFetch } from "../../useCmsAutoFetch";
import { useBlobPreview } from "../../useBlobPreview";
import { type ICms } from "@shared/types/cmsCreate";
import {
  type ExistingCmsPreview,
  type OrderLookupRecord,
} from "../../api";
import AjioSkuPickerModal from "./SkuPickerModal";
import ReturnOrderPickerModal from "./ReturnOrderPickerModal";
import { debounceAsync } from "../../debounce";
import { toast } from "../../toast";
import { ajioReturnOrder } from "@renderer/services/masterDataReport.service";
import { useClaimFormMode } from "../../ClaimFormMode";
import type { AjioReturnOrderLine } from "@shared/types/masterDataReport";
import PlatformAccountDropdown from "../../PlatformAccountDropdown";
import { usePlatformAccountAutoSelect } from "../../usePlatformAccountAutoSelect";

/**
 * Merge two record lists into one, deduplicating by trimmed SKU. Non-empty
 * SKUs collapse to a single row (first occurrence wins). Empty-SKU rows
 * collapse to at most one representative row — the picker's own synthetic
 * blank row provides the "add a new SKU not in master data" slot, so we
 * don't want repeated BE-side empties multiplying it.
 */
/** "RT229843479" — anything shorter is still being typed. */
const RETURN_ORDER_NO = /^[A-Za-z]{1,4}\d{5,}$/;

const mergeRecordsBySku = (
  existing: OrderLookupRecord[],
  incoming: OrderLookupRecord[],
): OrderLookupRecord[] => {
  const seen = new Set<string>();
  const out: OrderLookupRecord[] = [];
  for (const r of [...existing, ...incoming]) {
    const key = (r.sku || "").trim();
    // Both non-empty duplicates and repeated empties collapse via the same
    // Set — empty rows key as "" and only the first one survives.
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
};

export interface PlatformFormProps {
  formik: ClaimForm<ICms>;
  feedId: string;
  sideImages: File[];
  setSideImages: (files: File[]) => void;
  isPartialArticleClaim: boolean;
  claimTypeOptions: { name: string; description: string; key?: string }[];
  skus: string[];
  /**
   * Setter for the parent-owned `skus` list. AJIO's multi-record picker
   * writes into it so the validation branch enforces skuName required.
   * Other platforms don't use it.
   */
  setSkus?: (skus: string[]) => void;
  /** Parent-owned SKU picker visibility. Shared with the right column so the
   *  Rearrange modal defers opening while the picker is on-screen. */
  skuPickerOpen?: boolean;
  setSkuPickerOpen?: (open: boolean) => void;
  side: "left" | "right";
  /**
   * True only when the active platform really is AJIO. AjioForm doubles as the
   * common layout (Nykaa / Shopify wrap it, custom platforms fall back to it),
   * so it can't infer this itself — see the note where CreateCms passes it.
   * Gates the POB ID field, which no other platform has.
   */
  isAjio?: boolean;
  /** Label for the Remark textarea. Nykaa passes "Subject" here. */
  remarkLabel?: string;
  /** /cms/update: the loaded claim record, used to hydrate previews. */
  existingClaim?: ExistingCmsPreview | null;
  /**
   * Image URLs carried over from the previous platform's existingClaim
   * after the operator switches platform on /cms/update. Forwarded to
   * useVmsScreenshots which merges them into the Rearrange pool and pops
   * the modal so the operator can drag them into the new slot layout.
   */
  carryOverImages?: string[];
  /**
   * Override the Account Username row so wrapper platforms (Nykaa Fashion)
   * that render AjioForm can point the dropdown at their own integration
   * account list + formik path. When absent (default), the AJIO account
   * dropdown is rendered with AJIO auto-select via master data.
   */
  accountConfig?: {
    /** Integration provider key ("nykaa", etc). Feeds PlatformAccountDropdown. */
    platform: string;
    /** Display label shown above the dropdown. */
    label: string;
    /** Formik value at the destination path. */
    value: string;
    /** Setter — writes the picked username into the caller's formik path. */
    onChange: (v: string) => void;
  };
}

/**
 * Common / default CMS form used by AJIO and any platform without its own
 * dedicated form (Amazon, Shopify). Ports the App CMSPage.tsx layout
 * with left/right split: AWB/videos/remark on the left, product images +
 * six-side + POD + additional on the right (via CommonRightPart).
 */
const AjioForm = (props: PlatformFormProps) => {
  const {
    formik,
    feedId,
    sideImages,
    setSideImages,
    isPartialArticleClaim,
    skus,
    setSkus,
    skuPickerOpen: skuPickerOpenProp,
    setSkuPickerOpen: setSkuPickerOpenProp,
    side,
    isAjio,
    remarkLabel,
    existingClaim,
    accountConfig,
  } = props;
  const remarkLabelText = remarkLabel || "Remark";

  const blobs = useBlobPreview();
  const [videoPreviews, setVideoPreviews] = useState<{
    returnVideo: string | null;
    forwardVideo: string | null;
  }>({ returnVideo: null, forwardVideo: null });

  // /cms/update hydration: mirror the loaded claim's video URLs into the
  // local preview state so the video slots render an inline playable preview
  // instead of a "Choose a video" placeholder. Guarded by a per-claim-id ref
  // so subsequent manual edits aren't stomped by a re-render.
  const hydratedVideoClaimIdRef = useRef<string | null>(null);
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || hydratedVideoClaimIdRef.current === claimId) return;
    hydratedVideoClaimIdRef.current = claimId;
    setVideoPreviews((prev) => ({
      returnVideo: existingClaim?.returnVideoLink || prev.returnVideo,
      forwardVideo: existingClaim?.forwardVideoLink || prev.forwardVideo,
    }));
  }, [existingClaim]);

  // /cms/update hydration: defensively seed the Account Username field from
  // the loaded claim. `applyExistingClaim` in useCreateCmsForm also writes
  // these (see setIfChanged for ajio_account_email + the nykaaClaimDetails
  // bundle merge), but a batched setFieldValue + reset-effect ordering issue
  // was leaving the field blank on direct /cms/update visits. Writing the
  // stored username here — keyed off the claim id via a ref, so it runs once
  // per loaded claim — is idempotent with applyExistingClaim and guarantees
  // the dropdown preselects. Nykaa reuses AjioForm's dropdown via
  // `accountConfig`, so the same effect covers Nykaa's
  // nykaaClaimDetails.username slot too.
  const hydratedAccountClaimIdRef = useRef<string | null>(null);
  // Use the stable setFieldValue reference (Formik v2 wraps it in
  // useEventCallback) instead of the whole formik object — formik is a fresh
  // object every render, which would make this effect fire every render (the
  // ref-guard would early-return but it's still wasted work). Same reason
  // for reading `accountConfig.value / .onChange` off the ref rather than
  // depending on `accountConfig` — the wrapper (NykaaForm) may or may not
  // stabilize it, so we don't rely on the caller.
  const setFieldValueRef = useRef(formik.setFieldValue);
  setFieldValueRef.current = formik.setFieldValue;
  const accountConfigRef = useRef(accountConfig);
  accountConfigRef.current = accountConfig;
  const currentAjioValueRef = useRef((formik.values.ajio_account_email as string) || "");
  currentAjioValueRef.current = (formik.values.ajio_account_email as string) || "";
  useEffect(() => {
    const claimId = existingClaim?._id || null;
    if (!claimId || hydratedAccountClaimIdRef.current === claimId) return;
    hydratedAccountClaimIdRef.current = claimId;
    const cfg = accountConfigRef.current;
    if (cfg) {
      // Nykaa path: username lives at nykaaClaimDetails.username.
      const nykaa = (existingClaim?.nykaaClaimDetails as any) || null;
      const stored = typeof nykaa?.username === "string" ? nykaa.username.trim() : "";
      if (stored && !cfg.value) cfg.onChange(stored);
      return;
    }
    // Default (AJIO) path: username lives at top-level ajio_account_email.
    const stored =
      typeof existingClaim?.ajio_account_email === "string"
        ? existingClaim.ajio_account_email.trim()
        : "";
    if (stored && !currentAjioValueRef.current) {
      setFieldValueRef.current("ajio_account_email", stored);
    }
  }, [existingClaim]);

  // Multi-record SKU picker state. Opens whenever /order/{awb} returns >1
  // masterImport rows for the return OR forward AWB the operator entered.
  // The picker is mandatory (no dismiss) — see AjioSkuPickerModal.
  // `skuPickerOpen` is lifted to CreateCms so CommonRightPart can gate its
  // Rearrange modal on it. Fall back to local state if unwired.
  const [localSkuPickerOpen, setLocalSkuPickerOpen] = useState(false);
  const skuPickerOpen = skuPickerOpenProp ?? localSkuPickerOpen;
  const setSkuPickerOpen = setSkuPickerOpenProp ?? setLocalSkuPickerOpen;
  const [skuPickerRecords, setSkuPickerRecords] = useState<OrderLookupRecord[]>([]);
  // Latest merged records — the debounced onMultipleRecords callback
  // captures the render-time state closure, so we mirror into a ref to
  // guarantee we read the freshest value when merging back-to-back lookups
  // (return → cross-fill forward). Kept in sync via the setter below.
  const skuPickerRecordsRef = useRef<OrderLookupRecord[]>([]);
  const writeSkuPickerRecords = (next: OrderLookupRecord[]) => {
    skuPickerRecordsRef.current = next;
    setSkuPickerRecords(next);
  };
  // Same stale-closure problem as the records ref above: `onRecords` runs
  // inside the hook's debounced lookup, which captured the render where it
  // was created — reading `formik.values` there yields the values from that
  // render, not the current ones. Mirror the two fields the handler needs
  // into refs so it always reads live values.
  const returnAwbRef = useRef<string>("");
  returnAwbRef.current = ((formik.values.AWBNumber as string) || "");
  const skuNameRef = useRef<string>("");
  skuNameRef.current = ((formik.values.skuName as string) || "");
  const pobIdRef = useRef<string>("");
  pobIdRef.current = ((formik.values.pobId as string) || "");
  // The EAN a Return Order Number lookup wrote into the SKU field. While the
  // field still holds it, the master-data lookup that follows must not replace
  // it or open the SKU picker over it — AJIO's own report is the fresher answer.
  const reportSkuRef = useRef<string>("");

  // Distinct POB IDs offered by the master rows scoped to this claim. Drives
  // the POB field's shape: 0 or 1 option renders a plain text input (auto-
  // filled in the 1 case), 2+ renders a dropdown, because that is the only
  // state where the operator has an actual decision to make.
  //
  // No mirroring ref, unlike skuPickerRecords: nothing reads the previous
  // option list from inside the debounced handler. The staleness check there
  // works off skuPickerRecordsRef (the record set the value came from), which
  // is what actually distinguishes an auto-filled POB from a typed one.
  const [pobOptions, setPobOptions] = useState<string[]>([]);
  const writePobOptions = setPobOptions;

  /**
   * Clear everything derived from the master-data lookup: the merged-record
   * accumulator, the parent skus list, and the previously chosen skuName /
   * pobId. Called from the AWB input onChange handlers only — cross-fill from
   * `applyReturnLookup`/`applyForwardLookup` writes formik directly and never
   * routes through those input onChanges, so this only fires on manual typing
   * (which is exactly when the lookup should start fresh).
   */
  /*
   * A FIELD THE RETURN ORDER LOOKUP FILLED IS NOT THE AWB'S TO CLEAR.
   *
   * The reset below exists because SKU and POB are normally read from the
   * master row of the AWB you type: change the AWB and they are stale. But
   * when they came from a Return Order Number, they belong to the RETURN
   * ORDER — editing the AWB does not make them wrong, and wiping them threw
   * away the lookup's work. The operator typed one number, got five fields,
   * corrected one of them, and watched two others empty themselves.
   *
   * Protection is per-field and ends the moment the operator edits that field
   * by hand: from then on it is theirs, and the ordinary staleness rule
   * applies again.
   */
  const ownedByLookup = (field: string): boolean => filledByLookupRef.current.includes(field);

  const releaseFromLookup = (field: string): void => {
    filledByLookupRef.current = filledByLookupRef.current.filter(name => name !== field);
  };

  const resetMasterRecordState = () => {
    reportSkuRef.current = "";

    const clearSku = !ownedByLookup("skuName");
    const clearPob = !ownedByLookup("pobId");

    if (
      skuPickerRecordsRef.current.length === 0 &&
      (!clearSku || (formik.values.skuName || "") === "") &&
      (!clearPob || (formik.values.pobId || "") === "")
    ) {
      return;
    }
    writeSkuPickerRecords([]);
    setSkus?.([]);
    if (clearSku) formik.setFieldValue("skuName", "");
    // POB is derived from the same master row as the SKU, so it goes stale at
    // exactly the same moment — leaving it behind would file the new AWB's
    // claim under the previous AWB's place of business.
    if (clearPob) {
      writePobOptions([]);
      formik.setFieldValue("pobId", "");
    }
  };

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
    // What the Return Order Number lookup filled stays filled — correcting the
    // AWB afterwards must not re-answer for it. See ownedByLookup.
    isProtected: (field) => filledByLookupRef.current.includes(field),
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
    onRecords: (records) => {
      // Merge with any previously-picked records so the return-AWB lookup and
      // its auto-triggered forward-AWB lookup don't stomp each other. The
      // forward AWB is auto-filled inside `applyReturnLookup` (not via the
      // input's onChange), so we can safely accumulate here — a manual AWB
      // change resets the ref via the input handlers below.
      const merged = mergeRecordsBySku(skuPickerRecordsRef.current, records);

      // Narrow the merged set to the line this claim is actually about.
      //
      // The forward lookup matches masterImport on `order_FWD_AWB_no` OR
      // `order_no`, so a multi-line order answers with every one of its lines
      // — one AJIO forward AWB (13670621947136) returns 5 rows carrying 4
      // different seller SKUs, only one of which came back on the return AWB
      // the operator typed. Offering all of them let a sibling item's SKU be
      // picked (or auto-filled) onto the claim.
      //
      // So: if any row carries the entered return AWB, that row IS the claim
      // — keep only it. If none does (return AWB not in master data yet, or
      // the BE build predates per-record AWBs), keep the full set so the
      // operator can still pick, which is the previous behaviour.
      const typedReturnAwb = returnAwbRef.current.trim().toLowerCase();
      const awbMatches = typedReturnAwb
        ? merged.filter(
            (r) => (r.returnAwb || "").trim().toLowerCase() === typedReturnAwb,
          )
        : [];
      const scoped = awbMatches.length > 0 ? awbMatches : merged;

      // ---- POB ID -------------------------------------------------------
      // Resolved from the same `scoped` set as the SKU so both fields always
      // describe one master row, and resolved BEFORE the SKU branches below
      // because two of them return early — a POB-only master row (SKU column
      // blank in the import file) would otherwise never reach this code.
      //
      // The BE has already normalised these, so a value here is a real POB and
      // not one of parseExcel's "undefined" / "-" placeholders.
      const uniquePobs = Array.from(
        new Set(
          scoped
            .map((r) => (r.pobId || "").trim())
            .filter((pob) => pob.length > 0),
        ),
      );

      // Same stale-value rule as the SKU below: a POB auto-filled from a wider
      // record set that the return AWB has since narrowed is now the wrong
      // line's place of business, so drop it. A POB the operator typed or
      // picked by hand appears in neither record set and is left alone —
      // clearing that would silently undo a deliberate choice.
      let currentPob = pobIdRef.current.trim();
      if (
        currentPob !== "" &&
        !uniquePobs.includes(currentPob) &&
        skuPickerRecordsRef.current.some(
          (r) => (r.pobId || "").trim() === currentPob,
        )
      ) {
        formik.setFieldValue("pobId", "");
        currentPob = "";
      }

      writePobOptions(uniquePobs);

      // Exactly one POB in scope: nothing to disambiguate, so fill it in and
      // leave the field as a plain (still editable) text input. Never stomp a
      // value already on the form.
      if (uniquePobs.length === 1 && !currentPob) {
        formik.setFieldValue("pobId", uniquePobs[0]);
      }
      // uniquePobs.length > 1 needs no write here — the field re-renders as a
      // dropdown and the operator picks. Deliberately NOT auto-picking one:
      // guessing a place of business is how a claim gets filed against the
      // wrong warehouse, and unlike the SKU there is no modal insisting on an
      // answer, so a wrong default would sail through unnoticed.
      // -------------------------------------------------------------------

      // The SKU came from AJIO's return report (the Return Order Number
      // lookup) and is still on the form: leave it, and leave the field as
      // plain text rather than a picker over master-data SKUs.
      if (reportSkuRef.current && skuNameRef.current.trim() === reportSkuRef.current) {
        writeSkuPickerRecords(scoped);
        setSkus?.([]);
        setSkuPickerOpen(false);
        return;
      }

      // Unique non-empty SKU count in the scoped set — this is the number of
      // real ambiguities the operator needs to resolve.
      const uniqueSkus = Array.from(
        new Set(
          scoped
            .map((r) => (r.sku || "").trim())
            .filter((sku) => sku.length > 0),
        ),
      );

      // A SKU auto-filled (or picked) from the wider set before the return
      // AWB narrowed it down is now the wrong line's SKU — drop it. A
      // hand-typed SKU is left alone: it appears in neither record set.
      let currentSku = skuNameRef.current.trim();
      if (
        currentSku !== "" &&
        !uniqueSkus.includes(currentSku) &&
        skuPickerRecordsRef.current.some(
          (r) => (r.sku || "").trim() === currentSku,
        )
      ) {
        formik.setFieldValue("skuName", "");
        currentSku = "";
      }

      writeSkuPickerRecords(scoped);

      if (uniqueSkus.length === 0) {
        // No pickable SKU from master data — nothing to open the modal
        // against. Fall back to the free-text SKU input (skus=[] flips the
        // field back to editable). Also force-close a picker left open from
        // a previous lookup that DID have valid SKUs, and drop the stale
        // records so the field's click-to-open guard doesn't reopen it.
        setSkus?.([]);
        // Unconditional: `skuPickerOpen` here is the captured render's value
        // (see the ref note above), so guarding on it would never close a
        // picker opened by an earlier lookup.
        setSkuPickerOpen(false);
        if (skuPickerRecordsRef.current.length > 0) {
          writeSkuPickerRecords([]);
        }
        return;
      }

      // At least one valid SKU exists — keep the records around so the
      // SKU field renders as click-to-open (skus.length > 0) and the
      // operator can reopen the picker later to change their selection.
      setSkus?.(uniqueSkus);

      if (uniqueSkus.length === 1) {
        // Single SKU: auto-fill so the operator doesn't have to click
        // through, but the field STILL shows as click-to-open (records
        // preserved above). The picker only auto-opens on AWB entry for
        // multi-SKU cases — no forced dialog for the unambiguous case.
        // Never stomp a manual entry.
        if (!currentSku) {
          formik.setFieldValue("skuName", uniqueSkus[0]);
        }
        // Nothing left to disambiguate — close a picker that an earlier,
        // wider lookup had opened.
        setSkuPickerOpen(false);
        return;
      }

      // Two or more distinct SKUs (one from each AWB, or >1 from a single
      // lookup): open the picker so the operator disambiguates. The modal
      // already renders a synthetic empty row for "Other — enter a new SKU",
      // so no extra plumbing is needed here.
      setSkuPickerOpen(true);
    },
  });

  // Account Username dropdown: fires a debounced BE lookup on AWB settle and
  // preselects the matching integration entry. `formik.values.ajio_account_email`
  // acts as the "manual selection" gate — once the operator picks (or the
  // dropdown was preselected) we don't overwrite it on subsequent AWB edits.
  const accountAuto = usePlatformAccountAutoSelect({
    platform: "ajio",
    // The AWB survives a platform switch, so the hook can re-look-up for the
    // new platform instead of leaving its account blank.
    awb: (formik.values.AWBNumber as string) || "",
    currentValue: (formik.values.ajio_account_email as string) || "",
    onResolve: (account) => formik.setFieldValue("ajio_account_email", account),
  });

  // ---- Return Order Number (AJIO) ----------------------------------------
  // Typing an AJIO return order number asks AJIO's own return report for it —
  // AJIO_RETURN_SEARCH_MONTHS windows of 31 days, newest first — and fills the
  // return AWB, forward AWB, SKU (the EAN), POB ID and the customer order
  // number from the line it finds. More than one line opens a picker.
  const [returnOrderLines, setReturnOrderLines] = useState<AjioReturnOrderLine[]>([]);
  const [returnOrderPickerOpen, setReturnOrderPickerOpen] = useState(false);
  const [lookingUpReturnOrder, setLookingUpReturnOrder] = useState(false);
  const returnOrderSeqRef = useRef(0);
  // Typed before an account was chosen: looked up as soon as one is.
  const [pendingReturnOrder, setPendingReturnOrder] = useState("");
  const ajioAccount = ((formik.values.ajio_account_email as string) || "").trim();
  // Read inside the debounced lookup, which closes over its first render.
  const ajioAccountRef = useRef(ajioAccount);
  ajioAccountRef.current = ajioAccount;
  // The header toggle. Same reason for the ref: the lookup is memoised once.
  const { lookupSource } = useClaimFormMode();
  const lookupSourceRef = useRef(lookupSource ?? "api");
  // Matches the page's default (Report). The two are read in different places
  // and a disagreement here is invisible: the toggle would show one source and
  // the lookup would use the other, which is precisely the bug this field was
  // added to fix.
  lookupSourceRef.current = lookupSource ?? "report";

  /**
   * The fields the last return-order lookup filled.
   *
   * Kept so a later lookup that finds NOTHING can take them back. Without it,
   * switching to Report on a machine whose backup is empty left the previous
   * source's answer on screen — a forward AWB and POB the backup could never
   * have produced — which reads as "Report found this" and is the one way this
   * toggle can actively mislead.
   *
   * Only what the lookup itself wrote is cleared; anything typed by hand is
   * left alone, because nobody asked for that to be undone.
   */
  const filledByLookupRef = useRef<string[]>([]);

  const clearLookupFilled = () => {
    for (const field of filledByLookupRef.current) formik.setFieldValue(field, "");

    filledByLookupRef.current = [];
  };

  const applyReturnOrderLine = (line: AjioReturnOrderLine) => {
    // Dropped BEFORE the reset, so the previous lookup's values are cleared as
    // stale rather than protected by their own ownership.
    filledByLookupRef.current = [];
    resetMasterRecordState();

    const filled: string[] = [];

    if (line.fwdAwbNo) filled.push("forwardAWB");
    if (line.ean) filled.push("skuName");
    if (line.pobId) filled.push("pobId");
    if (line.custOrderNo) filled.push("customerOrderNumber");
    if (line.returnAwbNo) filled.push("AWBNumber");

    filledByLookupRef.current = filled;
    /*
     * THROUGH THE SAME PATH AS TYPING IT, like the return AWB below.
     *
     * `setFieldValue` puts the number in the box and nothing else happens:
     * the forward video and the master-data record hang off the field's own
     * change handler, so an auto-filled AWB arrived with no video — and
     * clearing the field and retyping the SAME number fetched it, which is
     * what gave the bug away.
     *
     * `onForwardAwbChange` sets the value and starts the fetch, so both
     * routes into this field now do the same work.
     */
    if (line.fwdAwbNo) {
      // `resetMasterRecordState` already ran at the top of this function.
      auto.onForwardAwbChange(line.fwdAwbNo);
      if (!accountConfig) accountAuto.onForwardAwb(line.fwdAwbNo);
    }
    if (line.ean) {
      reportSkuRef.current = line.ean;
      formik.setFieldValue("skuName", line.ean);
    }
    if (line.pobId) formik.setFieldValue("pobId", line.pobId);
    // The customer's own order number — AJIO's `custOrderNo`, e.g.
    // FN4581806548. It is on the line already, and typing it back in by hand
    // from a number the lookup just read is the kind of copying this form
    // exists to remove.
    if (line.custOrderNo) formik.setFieldValue("customerOrderNumber", line.custOrderNo);
    // Last, and through the same path as typing it: the return AWB still
    // brings in its video link and its existing claim, if there is one.
    if (line.returnAwbNo) auto.onReturnAwbChange(line.returnAwbNo);
  };
  const applyReturnOrderLineRef = useRef(applyReturnOrderLine);
  applyReturnOrderLineRef.current = applyReturnOrderLine;

  const lookUpReturnOrder = useMemo(
    () =>
      debounceAsync(async (returnOrderNo: string, username: string) => {
        const seq = ++returnOrderSeqRef.current;
        setPendingReturnOrder("");
        setLookingUpReturnOrder(true);
        const response = await ajioReturnOrder(username, returnOrderNo, lookupSourceRef.current);
        // The operator has typed something else since — this answer is stale.
        if (seq !== returnOrderSeqRef.current) return;
        setLookingUpReturnOrder(false);

        if (!response.success) {
          toast.error(response.error.message);
          return;
        }
        // Renamed: `username` is already the account the lookup STARTED from.
        const { lines, searched, username: foundUnderRaw } = response.data;
        if (lines.length === 0) {
          /*
           * WHICH SOURCE SAID SO. "Not in the backup" and "not on AJIO" have
           * different fixes — one is a sync that has not run, the other a
           * number that is wrong — and one message for both sends people to
           * check the wrong thing.
           */
          /*
           * WHAT THE PREVIOUS LOOKUP LEFT BEHIND GOES WITH IT.
           *
           * A miss must not leave the form showing another source's answer.
           * Switching to Report on an empty backup used to keep the API's
           * forward AWB and POB on screen — values the backup could never have
           * produced — which reads as "Report found this".
           */
          clearLookupFilled();

          if (lookupSourceRef.current === "report") {
            const { coverage } = response.data;

            // The dates are the rest of the message: a backup that stops in
            // July and an order that does not exist look identical without
            // them, and only one of them is something the operator can fix.
            toast.error(
              coverage
                ? `Record not found — ${returnOrderNo} is not in the report backup, which covers ${coverage.from} to ${coverage.to}. Sync the missing dates, or switch to API.`
                : `Record not found — this machine has no AJIO report backup yet. Run the AJIO report sync, or switch to API.`,
            );
            return;
          }

          toast.error(
            `Record not found — ${returnOrderNo} is on no AJIO account in the last ${searched * 31} days`,
          );
          return;
        }

        /*
         * THE FORM FOLLOWS THE ACCOUNT THE ORDER WAS FOUND UNDER.
         *
         * The lookup sweeps every AJIO login when the chosen one does not have
         * the order. Leaving the picker on the old account would show account
         * B's return against account A — and the claim would then be filed with
         * the wrong login, which AJIO rejects and nobody can explain later.
         *
         * Said out loud too: an account switching under the operator without a
         * word is worse than the dead end it replaces.
         */
        const foundUnder = (foundUnderRaw || "").trim();
        if (foundUnder && foundUnder.toLowerCase() !== ajioAccountRef.current.toLowerCase()) {
          formik.setFieldValue("ajio_account_email", foundUnder);
          toast.info(`${returnOrderNo} belongs to ${foundUnder} — switched to that account`);
        }

        /*
         * THE FORWARD AWB IS ITS OWN ANSWER, AND ITS OWN FAILURE.
         *
         * It comes from a second lookup — the forward report, keyed on the
         * customer order number — and that one can miss while the return
         * lookup succeeded. Said separately because the fix differs: the rest
         * of the row is filled and usable, and only this field needs finding,
         * by hand or by switching source.
         */
        const missingForward = lines.filter(line => !line.fwdAwbNo);

        if (missingForward.length === lines.length) {
          toast.error(
            lookupSourceRef.current === "report"
              ? `Forward AWB not found — ${returnOrderNo} has no forward leg in the report backup. Sync the forward report, or switch to API.`
              : `Forward AWB not found for ${returnOrderNo}`,
          );
        }

        if (lines.length === 1 && lines[0]) {
          applyReturnOrderLineRef.current(lines[0]);
          // Names the source that answered: the two fill the same fields, and
          // "which one was this?" is otherwise unanswerable from the screen.
          toast.success(
            response.data.source === "report"
              ? `Filled from the report backup — return ${returnOrderNo}`
              : `Filled from AJIO — return ${returnOrderNo}`,
          );
          return;
        }
        setReturnOrderLines(lines);
        setReturnOrderPickerOpen(true);
      }, 800),
    [],
  );

  useEffect(
    () => () => {
      lookUpReturnOrder.cancel();
      // Drops any answer still in flight.
      returnOrderSeqRef.current += 1;
    },
    [lookUpReturnOrder],
  );

  /*
   * SWITCHING THE SOURCE RE-ASKS, with the number already in the field.
   *
   * Without this the toggle only changed where the NEXT lookup would read
   * from — so picking Report after typing the number left the API's answer on
   * screen, complete with a forward AWB the backup could never have supplied,
   * and the toggle looked like it did nothing.
   *
   * Skips the first render: mounting the form is not somebody changing their
   * mind, and re-asking there would fire a lookup for a number the operator
   * has not touched.
   */
  const lastSourceRef = useRef<string | null>(null);

  useEffect(() => {
    const source = lookupSource ?? "api";

    if (lastSourceRef.current === null) {
      lastSourceRef.current = source;

      return;
    }

    if (lastSourceRef.current === source) return;

    lastSourceRef.current = source;

    const typed = ((formik.values.returnOrderId as string) || "").trim().toUpperCase();

    if (!isAjio || !RETURN_ORDER_NO.test(typed) || !ajioAccount) return;

    returnOrderSeqRef.current += 1;
    lookUpReturnOrder.cancel();
    lookUpReturnOrder(typed, ajioAccount);
    // `formik.values` and the lookup are stable enough for this to key on the
    // source alone: anything else here would re-ask on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupSource]);

  const onReturnOrderChange = (value: string) => {
    formik.setFieldValue("returnOrderId", value);
    const trimmed = value.trim().toUpperCase();
    // A new value abandons whatever was in flight for the old one.
    returnOrderSeqRef.current += 1;
    setLookingUpReturnOrder(false);
    lookUpReturnOrder.cancel();
    setPendingReturnOrder("");
    if (!isAjio || !RETURN_ORDER_NO.test(trimmed)) return;
    if (!ajioAccount) {
      setPendingReturnOrder(trimmed);
      return;
    }
    lookUpReturnOrder(trimmed, ajioAccount);
  };

  // An account chosen after the number was typed.
  // Debounced, so the state it clears is set after this effect has returned.
  useEffect(() => {
    if (!pendingReturnOrder || !ajioAccount) return;
    lookUpReturnOrder(pendingReturnOrder, ajioAccount);
  }, [pendingReturnOrder, ajioAccount, lookUpReturnOrder]);
  // -------------------------------------------------------------------------

  if (side === "right") {
    return (
      <CommonRightPart
        formik={formik}
        feedId={feedId}
        sideImages={sideImages}
        setSideImages={setSideImages}
        blockRearrangeOpen={skuPickerOpen}
        existingClaim={existingClaim}
        carryOverImages={props.carryOverImages}
      />
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

      {/* Account Username on its own row so it doesn't compress the AWB grid.
          Wrapper platforms (Nykaa) pass `accountConfig` to redirect this row
          at their own integration list + formik path. Auto-select via master
          data only fires for the default AJIO wiring — Nykaa has no master
          data feed so its dropdown is a pure manual pick. */}
      <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "6px" }}>
        <Typography>{accountConfig ? accountConfig.label : "AJIO Account Username"}</Typography>
        <PlatformAccountDropdown
          platform={accountConfig ? accountConfig.platform : "ajio"}
          label=""
          value={
            accountConfig
              ? accountConfig.value
              : (formik.values.ajio_account_email as string) || ""
          }
          onChange={
            accountConfig
              ? accountConfig.onChange
              : (v) => formik.setFieldValue("ajio_account_email", v)
          }
        />
      </Box>

      {/* Return Order Number (AJIO) + AWB + Forward AWB + Customer Order Number + SKU */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "1fr 1fr",
            md: "repeat(4, 1fr)",
          },
          marginBottom: 2,
          gap: "16px",
        }}
      >
        {/*
          Return Order Number — AJIO only, optional, saved on the claim as
          `returnOrderId`. Typing one looks it up on AJIO and fills the fields
          after it.
         */}
        {isAjio && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <Typography>Return Order Number</Typography>
            <TextField
              name="returnOrderId"
              placeholder="Enter Return Order Number"
              size="small"
              fullWidth
              value={formik.values.returnOrderId || ""}
              onChange={(e) => onReturnOrderChange(e.target.value)}
              onBlur={formik.handleBlur}
              helperText={
                lookingUpReturnOrder
                  ? "Searching AJIO…"
                  : pendingReturnOrder && !ajioAccount
                    ? "Choose the AJIO account to look this up"
                    : undefined
              }
              InputProps={{
                endAdornment: lookingUpReturnOrder ? (
                  <InputAdornment position="end">
                    <CircularProgress size={16} />
                  </InputAdornment>
                ) : undefined,
              }}
            />
          </Box>
        )}

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
              resetMasterRecordState();
              auto.onReturnAwbChange(e.target.value);
              // Skip AJIO account auto-select when a wrapper platform (Nykaa)
              // has redirected the account row — the AJIO master lookup
              // wouldn't match a Nykaa AWB anyway, and firing it would emit
              // useless BE traffic on every keystroke.
              if (!accountConfig) accountAuto.onReturnAwb(e.target.value);
            }}
            onBlur={formik.handleBlur}
            error={!!(formik.touched.AWBNumber && formik.errors.AWBNumber)}
            helperText={formik.touched.AWBNumber && (formik.errors.AWBNumber as string)}
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
              resetMasterRecordState();
              auto.onForwardAwbChange(e.target.value);
              if (!accountConfig) accountAuto.onForwardAwb(e.target.value);
            }}
            onBlur={formik.handleBlur}
          />
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Typography>Customer Order Number</Typography>
          <TextField
            name="customerOrderNumber"
            placeholder="Enter Customer Order Number"
            size="small"
            fullWidth
            value={formik.values.customerOrderNumber}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
          />
        </Box>

        {/*
          Seller SKU column. Always visible so the operator can record an SKU
          even when master data has 0 or 1 match. When the multi-record
          picker has fired (skus.length > 0), the input becomes a
          read-only trigger that reopens the picker — direct editing would
          bypass the mandatory disambiguation.
         */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Typography>
            SKU
            {skus.length > 0 && <span style={{ color: "var(--mui-palette-error-main)" }}> *</span>}
          </Typography>
          {skus.length > 0 ? (
            <TextField
              name="skuName"
              placeholder="Select SKU"
              size="small"
              fullWidth
              value={formik.values.skuName}
              onBlur={formik.handleBlur}
              onClick={() => {
                // Belt-and-braces: refuse to open the modal unless the
                // current records actually have at least one non-empty SKU
                // for the operator to pick. Prevents the "single blank row
                // + disabled OK" dead-end even if `skus` and
                // `skuPickerRecords` drift out of sync.
                const hasPickableSku = skuPickerRecords.some(
                  (r) => (r.sku || "").trim().length > 0,
                );
                if (!hasPickableSku) return;
                setSkuPickerOpen(true);
              }}
              InputProps={{ readOnly: true, sx: { cursor: "pointer" } }}
              inputProps={{ style: { cursor: "pointer" } }}
              error={!!(formik.touched.skuName && formik.errors.skuName)}
              helperText={formik.touched.skuName && (formik.errors.skuName as string)}
            />
          ) : (
            <TextField
              name="skuName"
              placeholder="Enter SKU"
              size="small"
              fullWidth
              value={formik.values.skuName}
              onChange={event => {
                // Theirs now — see ownedByLookup.
                releaseFromLookup("skuName");
                formik.handleChange(event);
              }}
              onBlur={formik.handleBlur}
            />
          )}
        </Box>

        {/*
          POB ID column — AJIO only (the wrapper platforms that render this
          form have no such concept). Auto-filled from the master row the AWB
          resolved to; a dropdown instead of a text box once that row set
          offers more than one, which is the only case where the operator has
          a real choice to make. No modal: unlike the SKU there is nothing to
          disambiguate for the claim's identity, so interrupting AWB entry
          with a dialog would cost more than it buys.

          Optional by design. AJIO does reject a POB-less claim, but that gate
          lives on the CMS list's dispatch checkbox (isMissingRequiredPobId),
          where a POB that arrives in a LATER master import can still unblock
          the row. Making it required here would instead refuse to record a
          claim whose master data simply hasn't been imported yet.
         */}
        {isAjio && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <Typography>POB ID</Typography>
            {pobOptions.length > 1 ? (
              <TextField
                select
                name="pobId"
                size="small"
                fullWidth
                value={formik.values.pobId || ""}
                onChange={event => {
                  releaseFromLookup("pobId");
                  formik.handleChange(event);
                }}
                onBlur={formik.handleBlur}
                helperText={`${pobOptions.length} POB IDs match this AWB`}
              >
                {/* Escape hatch back to empty. The field is optional, and
                    without this the operator can never undo a mis-click — a
                    select with no blank option is a one-way door. */}
                <MenuItem value="">
                  <em>Not set</em>
                </MenuItem>
                {pobOptions.map((pob) => (
                  <MenuItem key={pob} value={pob}>
                    {pob}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                name="pobId"
                placeholder="Enter POB ID"
                size="small"
                fullWidth
                value={formik.values.pobId || ""}
                onChange={event => {
                  releaseFromLookup("pobId");
                  formik.handleChange(event);
                }}
                onBlur={formik.handleBlur}
              />
            )}
          </Box>
        )}
      </Box>

      {/* Remark (or Subject for Nykaa) */}
      <Box sx={{ marginBottom: 2, display: "flex", flexDirection: "column", gap: "6px" }}>
        <Typography>{remarkLabelText}</Typography>
        <TextField
          fullWidth
          size="small"
          multiline
          rows={2}
          placeholder={remarkLabelText}
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

      <ReturnOrderPickerModal
        open={returnOrderPickerOpen}
        returnOrderNo={((formik.values.returnOrderId as string) || "").trim().toUpperCase()}
        lines={returnOrderLines}
        onConfirm={(line) => {
          setReturnOrderPickerOpen(false);
          applyReturnOrderLine(line);
        }}
        onCancel={() => setReturnOrderPickerOpen(false)}
      />

      <AjioSkuPickerModal
        open={skuPickerOpen}
        records={skuPickerRecords}
        currentSku={formik.values.skuName}
        onConfirm={(sku) => {
          formik.setFieldValue("skuName", sku);
          setSkuPickerOpen(false);
        }}
        // Always give the operator an escape hatch from the picker. The
        // ambiguity-resolution guarantee is enforced on submit (skuName is
        // required whenever `skus.length > 0`), so a Cancel here just defers
        // the pick to the operator's SKU input — it doesn't let a claim
        // ship without one.
        onCancel={() => setSkuPickerOpen(false)}
      />
    </>
  );
};

export default AjioForm;
