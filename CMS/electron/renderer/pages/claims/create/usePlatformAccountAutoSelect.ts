import { debounceAsync } from "./debounce";
import { useEffect, useMemo, useRef } from "react";
import { getAccountByAwb } from "./api";

interface Options {
  /** Lower-case platform key: "ajio" | "meesho" | "snapdeal" | "myntra". */
  platform: string;
  /**
   * The AWB currently in the form, if any.
   *
   * The lookup used to fire ONLY while the operator typed an AWB. But the
   * platform switcher deliberately PRESERVES the AWB (see CreateCms's
   * platform-switch reset) while wiping the per-platform bundle that holds the
   * account — so switching Ajio → Myntra on a settled AWB left the new
   * platform's username empty and nothing ever went looking for it. The claim
   * saved with no account, and the automation that picked it up could only
   * report "no account attached".
   *
   * Passing the AWB here lets the hook re-run when the PLATFORM changes too.
   */
  awb?: string;
  /** Which AWB field `awb` came from. Master data is keyed differently per direction. */
  awbType?: "Return" | "Forward";
  /** Current formik value at the target field — used to skip auto-select
   *  when the operator has already picked something manually, so we don't
   *  clobber their choice on a re-fetch. */
  currentValue: string;
  /** Called with the account identifier returned by the BE, but ONLY when
   *  currentValue is empty and the lookup found a match. */
  onResolve: (account: string) => void;
}

/**
 * Fires `getAccountByAwb` (BE endpoint) on AWB settle and hands the result
 * back to the caller. Sole responsibility: the debounced network call + a
 * stale-response guard + a "don't overwrite manual selection" gate. The
 * caller decides how to map the returned string onto formik (per-platform
 * field name / bundle path).
 *
 * Only 4 platforms have master-data support today (AJIO / Meesho / Snapdeal
 * / Myntra); passing any other value is a no-op — the BE will respond with
 * `account: null` and this hook simply won't call `onResolve`.
 */
export const usePlatformAccountAutoSelect = ({
  platform,
  awb,
  awbType = "Return",
  currentValue,
  onResolve,
}: Options) => {
  const seqRef = useRef(0);
  const unmountedRef = useRef(false);
  const onResolveRef = useRef(onResolve);
  const currentValueRef = useRef(currentValue);
  useEffect(() => {
    onResolveRef.current = onResolve;
    currentValueRef.current = currentValue;
  }, [onResolve, currentValue]);

  /**
   * Cleared on SETUP as well as set on teardown.
   *
   * React runs an effect setup → cleanup → setup under StrictMode, on purpose,
   * to surface exactly this: a flag that is only ever set by the cleanup stays
   * set, and every lookup afterwards returns early at the `unmountedRef` guard.
   * The symptom is the whole screen going quiet — an AWB is typed and no video,
   * no screenshots and no Rearrange modal ever arrive — while nothing errors.
   *
   * It does not reproduce in a production build, where StrictMode does not
   * double-invoke, so it is a development-only silence. TrackVid-FE carries the
   * same shape and never sees it because its StrictMode is commented out.
   */
  useEffect(() => {
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const debouncedLookup = useMemo(
    () =>
      debounceAsync(async (awb: string, type: "Return" | "Forward") => {
        const value = String(awb || "").trim();
        if (!value) return;
        // Skip when the operator has already picked something — avoids
        // clobbering a manual selection just because they finished typing.
        if (String(currentValueRef.current || "").trim()) return;
        const seq = ++seqRef.current;
        try {
          const response = await getAccountByAwb(value, platform, type);
          if (seq !== seqRef.current || unmountedRef.current) return;
          const account = response?.data?.data?.account || "";
          if (!account) return;
          // Re-check the "already set" gate after the await — the operator
          // may have picked a value while the request was in flight.
          if (String(currentValueRef.current || "").trim()) return;
          onResolveRef.current(account);
        } catch {
          // Silent: the dropdown is optional, so a lookup miss / auth blip
          // shouldn't surface as a toast. Operator can still pick manually.
        }
      }, 500),
    [platform],
  );

  const onReturnAwb = (value: string) => debouncedLookup(value, "Return");
  const onForwardAwb = (value: string) => debouncedLookup(value, "Forward");

  // Re-run when the PLATFORM changes on an AWB that is already filled in.
  //
  // Same guards apply inside `debouncedLookup`: it does nothing when the
  // operator has already picked an account, and a stale response from the
  // previous platform is dropped by the sequence check. So this can only ever
  // fill an empty field.
  useEffect(() => {
    const settled = String(awb || "").trim();

    if (!settled) return;

    debouncedLookup(settled, awbType);
    // Deliberately NOT keyed on `awb`: typing is already handled by the change
    // handlers above, and adding it here would fire a second lookup per
    // keystroke. This effect exists for the platform switch alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, debouncedLookup]);

  useEffect(() => {
    return () => {
      debouncedLookup.cancel();
    };
  }, [debouncedLookup]);

  return { onReturnAwb, onForwardAwb };
};
