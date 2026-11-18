import type { ClaimForm } from "./useClaimForm";
import { debounceAsync } from "./debounce";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "./toast";
import { returnAwbAutofill } from "@renderer/services/claimCreate.service";
import { type ICms } from "@shared/types/cmsCreate";
import {
  getMyntraOrderInfo,
  getOrderByAwb,
  getSnapdealOrderInfo,
  type OrderLookupItem,
  type OrderLookupRecord,
} from "./api";

const LOGISTICS_PARTNER_OPTIONS = new Set([
  "Delhivery",
  "Bluedart",
  "Ecom",
  "Xpressbees",
  "Shadowfax",
  "Valmo",
]);

interface Options {
  formik: ClaimForm<ICms>;
  isMyntra?: boolean;
  isMeesho?: boolean;
  isSnapdeal?: boolean;
  onReturnVideoLink?: (link: string) => void;
  onForwardVideoLink?: (link: string) => void;
  onSkus?: (skus: string[]) => void;
  /**
   * Fired when the /order/{awb} lookup returns >1 masterImport records for
   * the entered AWB (return or forward). AJIO Create-CMS uses this to open
   * a mandatory SKU picker so the operator disambiguates which record the
   * claim belongs to. Not fired for single-record responses — single-record
   * keeps the current auto-fill flow with no user interrupt.
   */
  /**
   * Fires whenever /order lookup returned at least one master-import record
   * for this AWB. The caller decides what to do — AJIO merges across the
   * return + forward lookups, auto-fills the SKU when a single unique value
   * emerges, and opens the picker only once >=2 unique SKUs are known.
   * (Was `onMultipleRecords` and only fired for >1 records; renamed so the
   * caller can also handle the 1-record auto-fill case.)
   */
  onRecords?: (records: OrderLookupRecord[]) => void;
  /**
   * Fields this form has already filled from another source, which the AWB's
   * own record must not overwrite. Omitted means nothing is protected.
   */
  isProtected?: (field: string) => boolean;
  // NOTE: existing-claim lookup (/cms/find-by-awb) is deliberately NOT owned
  // by this hook. `CreateCms.tsx` runs a page-level effect on
  // `formik.values.AWBNumber` + `platformLabel` — that catches every AWB
  // change (typing, prefill, cross-fill from forward AWB, form reset) while
  // this hook's dispatchers only fire on manual typing. Wiring the lookup in
  // both places would double-fire the BE call per keystroke, so keep it in
  // one place. If you're tempted to reintroduce `onExistingClaim` here, delete
  // the page-level effect first.
}

/**
 * Ports the App's CMSPage / MeeshoCMS / SnapdealCMS auto-fill flows. When the
 * user enters an AWB (return or forward), we call `/order/{awb}` and mirror
 * back the cross-side AWB, video link, customer order number, and SKUs. On
 * Meesho/Snapdeal we additionally call `/master/{marketplace}-order-info`
 * with the entered field so the master mapping fills the other two AWBs.
 * On Myntra we call `/master/myntra-order-info` (single-source resolution;
 * the App's two-source chooser dialog is deferred).
 */
export const useCmsAutoFetch = ({
  formik,
  isMyntra,
  isMeesho,
  isSnapdeal,
  onReturnVideoLink,
  onForwardVideoLink,
  onSkus,
  onRecords,
  isProtected,
}: Options) => {
  /*
   * A FIELD SOMETHING ELSE OWNS IS NOT OURS TO OVERWRITE.
   *
   * This hook fills the form from the record of whichever AWB was typed, which
   * is right until another source has already answered for that field. AJIO's
   * Return Order Number lookup fills five fields at once; correcting the AWB
   * afterwards then re-filled two of them from the AWB's own record and the
   * operator lost what they had asked for.
   *
   * The caller decides — the rule belongs to the form that knows where its
   * values came from, not to a hook shared by every platform. Nobody passing
   * it keeps today's behaviour exactly.
   */
  const mayWrite = (field: string): boolean => !isProtected?.(field)
  // Guard against infinite fetch loops when cross-fills trigger the opposite
  // side's auto-fetch. We snapshot the last value we fired for each side and
  // skip if the current input matches.
  const lastReturnRef = useRef<string>("");
  const lastForwardRef = useRef<string>("");
  const lastSubOrderRef = useRef<string>("");

  // Stale-response guard. Every dispatched lookup increments a per-side seq
  // token; the response is applied only if the token still matches the
  // latest. Without this, a slow response for the previous AWB overwrites the
  // AWB the user has just typed.
  const returnSeqRef = useRef(0);
  const forwardSeqRef = useRef(0);
  const meeshoSeqRef = useRef(0);
  const snapdealSeqRef = useRef(0);
  const myntraSeqRef = useRef(0);
  // Set to true on unmount so late-firing debounces don't call
  // formik.setFieldValue on a torn-down form.
  const unmountedRef = useRef(false);

  const applyReturnLookup = (
    items: OrderLookupItem[],
    skus?: string[],
    records?: OrderLookupRecord[],
  ) => {
    if (!items || items.length === 0) return;
    // For simplicity, take the first match. The App shows a picker for
    // multi-order responses; that's a v2 enhancement.
    const data = items[0];

    if (!data) return;

    if (data.return_video_link) {
      formik.setFieldValue("returnVideoLink", data.return_video_link);
      onReturnVideoLink?.(data.return_video_link);
    }
    if (data.return_awb) {
      formik.setFieldValue("AWBNumber", data.return_awb);
    }
    if (data.customerOrderNumber && mayWrite("customerOrderNumber")) {
      formik.setFieldValue("customerOrderNumber", data.customerOrderNumber);
    }
    if (data.forward_awb && data.forward_awb !== lastForwardRef.current && mayWrite("forwardAWB")) {
      // Cross-fill: pull the forward side too.
      lastForwardRef.current = data.forward_awb;
      formik.setFieldValue("forwardAWB", data.forward_awb);
      fetchForwardAwbData(data.forward_awb);
    }
    if (skus && skus.length > 0) onSkus?.(skus);
    if (records && records.length > 0) onRecords?.(records);
  };

  const applyForwardLookup = (
    items: OrderLookupItem[],
    skus?: string[],
    records?: OrderLookupRecord[],
  ) => {
    if (!items || items.length === 0) return;
    const data = items[0];

    if (!data) return;

    // Forward-AWB entry must never erase existing form data — the contract is
    // "fill blanks, don't replace". Only overwrite a formik field when the
    // current value is empty. Critical for `AWBNumber`: overwriting it kicks
    // off the Return-side VMS fetch which on /cms/create replaces the
    // right-side image slots. Trimmed emptiness so a whitespace-only value
    // doesn't count as filled.
    const isBlank = (v: unknown): boolean =>
      typeof v !== "string" || v.trim() === "";
    if (data.forward_video_link && isBlank(formik.values.forwardVideoLink)) {
      formik.setFieldValue("forwardVideoLink", data.forward_video_link);
      onForwardVideoLink?.(data.forward_video_link);
    }
    if (data.forward_awb && isBlank(formik.values.forwardAWB)) {
      formik.setFieldValue("forwardAWB", data.forward_awb);
    }
    if (
      data.customerOrderNumber &&
      isBlank(formik.values.customerOrderNumber)
    ) {
      formik.setFieldValue("customerOrderNumber", data.customerOrderNumber);
    }
    if (
      data.return_awb &&
      data.return_awb !== lastReturnRef.current &&
      isBlank(formik.values.AWBNumber)
    ) {
      lastReturnRef.current = data.return_awb;
      formik.setFieldValue("AWBNumber", data.return_awb);
      fetchReturnAwbData(data.return_awb);
    }
    if (skus && skus.length > 0) onSkus?.(skus);
    if (records && records.length > 0) onRecords?.(records);
  };

  const fetchReturnAwbData = useMemo(
    () =>
      debounceAsync(async (awb: string) => {
        const value = awb?.trim();
        if (!value) return;
        const seq = ++returnSeqRef.current;
        try {
          const response = await getOrderByAwb(value, "Return");
          // Response arrived out of order (user has moved on) or the hook has
          // unmounted — silently drop instead of overwriting current state.
          if (seq !== returnSeqRef.current || unmountedRef.current) return;
          if (response.status === 200) {
            const items = (response.data?.data || []) as OrderLookupItem[];
            applyReturnLookup(
              items,
              response.data?.skus || [],
              response.data?.records || [],
            );
            if (items.length > 0) toast.success("Video found");
          }
        } catch (err: any) {
          if (seq !== returnSeqRef.current || unmountedRef.current) return;
          // Only surface a "not found" toast for a real 404; network errors
          // and 401s were being surfaced as "Video not found" which is
          // misleading.
          if (value !== "" && err?.response?.status === 404) {
            toast.error("Video not found");
          }
        }
      }, 800),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const fetchForwardAwbData = useMemo(
    () =>
      debounceAsync(async (awb: string) => {
        const value = awb?.trim();
        if (!value) return;
        const seq = ++forwardSeqRef.current;
        try {
          const response = await getOrderByAwb(value, "Forward");
          if (seq !== forwardSeqRef.current || unmountedRef.current) return;
          if (response.status === 200) {
            const items = (response.data?.data || []) as OrderLookupItem[];
            applyForwardLookup(
              items,
              response.data?.skus || [],
              response.data?.records || [],
            );
            if (items.length > 0) toast.success("Video found");
          }
        } catch (err: any) {
          if (seq !== forwardSeqRef.current || unmountedRef.current) return;
          if (value !== "" && err?.response?.status === 404) {
            toast.error("Video not found");
          }
        }
      }, 800),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const meeshoAccountRef = useRef("");

  useEffect(() => {
    meeshoAccountRef.current = String(formik.values.meesho_account_email || "").trim();
  }, [formik.values.meesho_account_email]);

  /**
   * Meesho's Returns search, asked through the main process.
   *
   * The supplier portal's Returns search (through the main process, on each
   * account's SAVED session — no sign-in while someone is typing) names the
   * return's sub-order number, and which account holds it. Only for a return
   * AWB: that is what the search is keyed on here, and the master lookup
   * already covers the other two identifiers when they are known.
   */
  const askMeeshoForSubOrder = async (returnAwbNo: string, seq: number): Promise<void> => {
    // Through the ref: this runs inside a debounce memoised on first render, and
    // `formik.values` there is the FIRST render's — an account picked since
    // would be ignored, and then overwritten.
    const chosen = meeshoAccountRef.current;
    const response = await returnAwbAutofill("meesho", returnAwbNo, chosen || undefined);

    if (seq !== meeshoSeqRef.current || unmountedRef.current) return;

    if (!response.success) {
      console.warn("[meesho-order-info] Meesho lookup failed", response.error.message);
      return;
    }

    const { found, subOrderNumber, username, failures } = response.data;

    if (found && subOrderNumber) {
      if (subOrderNumber !== lastSubOrderRef.current) {
        lastSubOrderRef.current = subOrderNumber;
        formik.setFieldValue("subOrderNumber", subOrderNumber);
      }
      if (username && !chosen) formik.setFieldValue("meesho_account_email", username);
      // "Xpress Bees" and "Xpressbees" are one carrier: compared without case or spaces.
      const carrier = response.data.logisticsPartner;
      const partner = carrier
        ? [...LOGISTICS_PARTNER_OPTIONS].find(
            (option) => option.toLowerCase().replace(/\s+/g, "") === carrier.toLowerCase().replace(/\s+/g, ""),
          )
        : undefined;
      if (partner) formik.setFieldValue("logisticsPartnerName", partner);
      toast.success(`Suborder ${subOrderNumber} found on Meesho${username ? ` (${username})` : ""}`);
      return;
    }

    // Not found on any account. Named only when an account could not be asked —
    // "not found" alone is the normal answer for a mistyped AWB.
    if (failures.length > 0) {
      toast.error(
        `Suborder not found — ${failures.length} Meesho login${failures.length === 1 ? "" : "s"} could not be asked (${failures[0]?.username}: ${failures[0]?.reason})`,
      );
    }
  };

  /**
   * Meesho: the RETURN AWB is asked of Meesho itself — never the master data.
   *
   * The master import only knows a return once it has run past it, and until
   * then a Meesho claim was created with no account and no sub-order number:
   * "No Meesho account on this claim … import the master data". Meesho's own
   * Returns search knows the return the moment it exists, names its sub-order
   * and carrier, and — scoped to each login's session — which account holds it.
   */
  const fetchMeeshoInfo = useMemo(
    () =>
      debounceAsync(async (returnAwbNo: string) => {
        const awb = returnAwbNo.trim();
        if (!awb) return;
        const seq = ++meeshoSeqRef.current;
        await askMeeshoForSubOrder(awb, seq);
      }, 800),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const fetchSnapdealInfo = useMemo(
    () =>
      debounceAsync(
        async (params: {
          subOrderNo?: string;
          returnAwbNo?: string;
          forwardAwbNo?: string;
        }) => {
          const hasVal = Object.values(params).some((v) => v && v.trim() !== "");
          if (!hasVal) return;
          const seq = ++snapdealSeqRef.current;
          try {
            const response = await getSnapdealOrderInfo(params);
            if (seq !== snapdealSeqRef.current || unmountedRef.current) return;
            if (response.status === 200 && response.data?.isSuccess) {
              const { subOrderNo, returnAwbNo, forwardAwbNo } =
                response.data.data || {};
              if (subOrderNo && subOrderNo !== lastSubOrderRef.current) {
                lastSubOrderRef.current = subOrderNo;
                formik.setFieldValue("subOrderNumber", subOrderNo);
              }
              if (returnAwbNo && returnAwbNo !== lastReturnRef.current) {
                lastReturnRef.current = returnAwbNo;
                formik.setFieldValue("AWBNumber", returnAwbNo);
                fetchReturnAwbData(returnAwbNo);
              }
              if (forwardAwbNo && forwardAwbNo !== lastForwardRef.current) {
                lastForwardRef.current = forwardAwbNo;
                formik.setFieldValue("forwardAWB", forwardAwbNo);
                fetchForwardAwbData(forwardAwbNo);
              }
            }
          } catch (err) {
            console.warn("[snapdeal-order-info] lookup failed", err);
          }
        },
        800,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const fetchMyntraInfo = useMemo(
    () =>
      debounceAsync(
        async (params: {
          returnTrackingNumber?: string;
          forwardTrackingNumber?: string;
        }) => {
          const hasVal = Object.values(params).some((v) => v && v.trim() !== "");
          if (!hasVal) return;
          const seq = ++myntraSeqRef.current;
          try {
            const response = await getMyntraOrderInfo(params);
            if (seq !== myntraSeqRef.current || unmountedRef.current) return;
            if (response.status === 200 && response.data?.isSuccess) {
              const {
                returnTrackingNumber,
                forwardTrackingNumber,
                returnVideoLink,
                forwardVideoLink,
              } = response.data.data || {};
              if (
                returnTrackingNumber &&
                returnTrackingNumber !== lastReturnRef.current
              ) {
                lastReturnRef.current = returnTrackingNumber;
                formik.setFieldValue("AWBNumber", returnTrackingNumber);
              }
              if (
                forwardTrackingNumber &&
                forwardTrackingNumber !== lastForwardRef.current
              ) {
                lastForwardRef.current = forwardTrackingNumber;
                formik.setFieldValue("forwardAWB", forwardTrackingNumber);
              }
              if (returnVideoLink) {
                formik.setFieldValue("returnVideoLink", returnVideoLink);
                onReturnVideoLink?.(returnVideoLink);
              }
              if (forwardVideoLink) {
                formik.setFieldValue("forwardVideoLink", forwardVideoLink);
                onForwardVideoLink?.(forwardVideoLink);
              }
            }
          } catch (err) {
            console.warn("[myntra-order-info] lookup failed", err);
          }
        },
        800,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Dispatchers exposed to form fields. Each one fires the generic /order/{awb}
  // lookup plus the marketplace-specific master lookup when applicable.
  // Existing-claim lookup (/cms/find-by-awb) is owned by CreateCms.tsx — see
  // the note on `Options` above; do not add it here.
  const onReturnAwbChange = (value: string) => {
    formik.setFieldValue("AWBNumber", value);
    lastReturnRef.current = value;
    fetchReturnAwbData(value);
    if (isMyntra) fetchMyntraInfo({ returnTrackingNumber: value });
    if (isMeesho) fetchMeeshoInfo(value);
    if (isSnapdeal) fetchSnapdealInfo({ returnAwbNo: value });
  };

  const onForwardAwbChange = (value: string) => {
    formik.setFieldValue("forwardAWB", value);
    lastForwardRef.current = value;
    fetchForwardAwbData(value);
    if (isMyntra) fetchMyntraInfo({ forwardTrackingNumber: value });
    if (isSnapdeal) fetchSnapdealInfo({ forwardAwbNo: value });
  };

  const onSubOrderChange = (value: string) => {
    formik.setFieldValue("subOrderNumber", value);
    lastSubOrderRef.current = value;
    if (isSnapdeal) fetchSnapdealInfo({ subOrderNo: value });
  };

  /**
   * Cancel any pending debounces on unmount so a late fire doesn't call
   * setFieldValue on a torn-down form. The seq-token guard covers the await
   * path; this covers the "still waiting for the debounce to fire" case.
   *
   * THE FLAG IS CLEARED ON SETUP TOO. React runs an effect setup → cleanup →
   * setup under StrictMode, on purpose, to surface exactly this: a flag only
   * ever set by the cleanup stays set, and every lookup afterwards returns
   * early at the `unmountedRef` guard. The symptom is the whole screen going
   * quiet — an AWB is typed and no forward AWB, no video, no screenshots and no
   * Rearrange modal ever arrive — while nothing errors.
   *
   * It does not reproduce in a production build, where StrictMode does not
   * double-invoke, so it is a development-only silence. TrackVid-FE carries the
   * same shape and never sees it because its StrictMode is commented out.
   */
  useEffect(() => {
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;
      fetchReturnAwbData.cancel();
      fetchForwardAwbData.cancel();
      fetchMeeshoInfo.cancel();
      fetchSnapdealInfo.cancel();
      fetchMyntraInfo.cancel();
    };
  }, [
    fetchReturnAwbData,
    fetchForwardAwbData,
    fetchMeeshoInfo,
    fetchSnapdealInfo,
    fetchMyntraInfo,
  ]);

  return {
    onReturnAwbChange,
    onForwardAwbChange,
    onSubOrderChange,
  };
};
