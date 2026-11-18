import { debounceAsync } from "./debounce";
import { useEffect, useMemo, useRef, useState } from "react";
import { useClaimFormMode } from "./ClaimFormMode";
import { getOrderScreenshots } from "./api";

/**
 * Shared VMS-screenshot auto-fetch orchestrator. As soon as the Return AWB
 * settles (debounced) we call /order/screenshot/{awb}?orderType=Return, hand
 * the results to the caller for slot placement, and expose a Rearrange modal
 * so the user can re-shuffle images. `imageFields` is the ordered list of
 * slot fieldNames; `previews` is the fieldName -> current URL map used both
 * to seed the modal and as its "pool" of available images.
 */
export interface VmsScreenshotsOptions {
  awb: string;
  /**
   * Forward AWB screenshots are surfaced in the Rearrange modal AND merged
   * into `fetchedScreenshots` so silent side-image backfill fills BLANK
   * side slots with them. They never displace an already-filled slot —
   * that's the caller's silent-backfill contract (respects `room` +
   * dedups against slot URLs). Return-side `populate` still owns full
   * slot placement on Return AWB entry; forward shots only fill gaps.
   * Every platform form that owns a forwardAWB field should forward it here.
   */
  forwardAwb?: string;
  previews: Record<string, string | null | undefined>;
  imageFields: string[];
  populate: (screenshots: string[]) => void;
  reset: () => void;
  /**
   * Extra image URLs handed in by the parent (CreateCms) after a platform
   * switch on /cms/update. When the reference changes to a non-empty array
   * the hook merges them into `fetchedScreenshots` (dedup preserved) and
   * auto-opens the Rearrange modal so the operator can drag the carried-
   * over shots into the new platform's slot layout without re-uploading.
   */
  carryOverImages?: string[];
  /**
   * When `false`, the hook still merges `carryOverImages` into
   * `fetchedScreenshots` (so the Rearrange button surfaces them) but skips
   * the auto-open of the Rearrange modal. Used by AJIO
   * (CommonRightPart) to silently backfill the Product Side Images grid
   * from its own effect instead of forcing an operator to drag them. Other
   * bundle forms keep the default open-on-carry-over UX. Default: true.
   */
  openModalOnCarryOver?: boolean;
  /**
   * When `true`, the hook still fetches VMS shots and updates
   * `fetchedScreenshots` (so the modal pool stays fresh) but DEFERS all
   * imperative side effects that mutate right-side slot state or open the
   * Rearrange modal — `populate`, `reset`, and `setRearrangeModalOpen`.
   * Used by AJIO (CommonRightPart) to make the SKU picker the *first*
   * process the operator sees on an AWB change: nothing else happens on
   * the right side until they confirm/cancel. When the flag flips back to
   * `false`, any deferred populate/reset is applied automatically (see
   * `pendingShotsRef` below), so no data is lost.
   */
  deferAutoActions?: boolean;
}

export const useVmsScreenshots = ({
  awb,
  forwardAwb,
  previews,
  imageFields,
  populate,
  reset,
  carryOverImages,
  openModalOnCarryOver = true,
  deferAutoActions = false,
}: VmsScreenshotsOptions) => {
  const [rearrangeModalOpen, setRearrangeModalOpen] = useState<boolean>(false);
  const [fetchedScreenshots, setFetchedScreenshots] = useState<string[]>([]);
  // Kept apart from `fetchedScreenshots` on purpose — see the forward fetcher
  // below for the reasoning. Only the Rearrange modal reads this; no caller
  // should auto-place these URLs anywhere.
  const [forwardOnlyScreenshots, setForwardOnlyScreenshots] = useState<string[]>([]);
  // Ref mirror of fetchedScreenshots so the forward fetcher (which runs
  // inside a memoised debounce) can cross-dedup without becoming a stale
  // closure over the state value. Without this, a URL that appears in both
  // pools ends up stored twice and every derived selector has to re-filter
  // it out.
  const fetchedScreenshotsRef = useRef<string[]>([]);
  useEffect(() => {
    fetchedScreenshotsRef.current = fetchedScreenshots;
  }, [fetchedScreenshots]);
  const lastFetchedAwb = useRef<string>("");
  // Stale-response guard + unmount signal, mirroring useCmsAutoFetch. Without
  // these, a slow VMS response can (a) overwrite the current preview state
  // for a *different* AWB the user has moved on to, or (b) call
  // setState/populate/reset on a torn-down component.
  const fetchSeqRef = useRef(0);
  const unmountedRef = useRef(false);

  // Populate/reset are recreated by callers every render; keep them in refs
  // so the debounced fetch always sees the latest closure without needing to
  // rebuild the debounce (which would lose its pending state).
  const populateRef = useRef(populate);
  const resetRef = useRef(reset);
  useEffect(() => {
    populateRef.current = populate;
    resetRef.current = reset;
  }, [populate, reset]);

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

  // /cms/update reuses this page as a full-edit surface. When editing an
  // existing claim we DON'T want to populate slots or auto-open the modal
  // (both would clobber the operator's saved selection), but we DO still
  // fetch the VMS screenshots so the Rearrange modal shows them in the pool
  // and the operator can drag one in to replace / reset a slot.
  const { isUpdateMode } = useClaimFormMode();
  const updateModeRef = useRef(isUpdateMode);
  useEffect(() => {
    updateModeRef.current = isUpdateMode;
  }, [isUpdateMode]);

  // Ref-mirror of `deferAutoActions` so the debounced return-side fetch
  // (memoised for the hook's lifetime) always reads the freshest value
  // without becoming a stale closure. Read at the moment the response
  // arrives, so an operator who opens the SKU picker mid-flight still gets
  // their populate deferred.
  const deferAutoActionsRef = useRef(deferAutoActions);
  useEffect(() => {
    deferAutoActionsRef.current = deferAutoActions;
  }, [deferAutoActions]);

  // Deferred-populate cache. `null` = nothing pending. `[]` = the response
  // was empty (deferred `reset`). Non-empty array = deferred `populate`.
  // Consumed by the gate-lift effect below.
  const pendingShotsRef = useRef<string[] | null>(null);

  const debouncedFetch = useMemo(
    () =>
      debounceAsync(async (awbNumber: string) => {
        const value = awbNumber?.trim();
        if (!value) return;
        const seq = ++fetchSeqRef.current;
        const updateMode = updateModeRef.current;
        try {
          const response = await getOrderScreenshots(value, "Return");
          if (seq !== fetchSeqRef.current || unmountedRef.current) return;
          const shots: string[] = response.data?.data || [];
          const defer = deferAutoActionsRef.current;
          if (shots.length > 0) {
            setFetchedScreenshots(shots);
            if (!updateMode) {
              if (defer) {
                // SKU picker is open — hold off on slot mutation and modal
                // pop-up. The gate-lift effect below will apply this the
                // moment the picker closes.
                pendingShotsRef.current = shots;
              } else {
                populateRef.current(shots);
                // Auto-open the Rearrange modal so the user can review /
                // reset the freshly populated slots before proceeding.
                setRearrangeModalOpen(true);
              }
            }
          } else if (!updateMode) {
            setFetchedScreenshots([]);
            if (defer) {
              // Empty response — defer the slot clear too. Empty array
              // sentinel distinguishes "deferred reset" from "no deferred
              // action" (null).
              pendingShotsRef.current = [];
            } else {
              resetRef.current();
            }
          }
          // Update mode with empty shots: leave existing hydrated slots
          // untouched; the pool simply won't gain any new options.
        } catch {
          // Silent: auto-fetch runs on every AWB change, and a missing/invalid
          // VMS record is expected. On create, clear stale VMS state; on
          // update, keep whatever the operator has already selected.
          if (seq !== fetchSeqRef.current || unmountedRef.current) return;
          if (!updateMode) {
            setFetchedScreenshots([]);
            if (deferAutoActionsRef.current) {
              pendingShotsRef.current = [];
            } else {
              resetRef.current();
            }
          }
        }
      }, 800),
    [],
  );

  // Gate-lift: when the SKU picker closes (`deferAutoActions` flips to
  // false), apply whatever populate/reset the debounced fetch cached
  // during the deferred window. Runs even when the deferred payload was
  // an empty array (that's the "response arrived, slots should be
  // cleared" sentinel).
  useEffect(() => {
    if (deferAutoActions) return;
    const pending = pendingShotsRef.current;
    if (pending === null) return;
    pendingShotsRef.current = null;
    if (updateModeRef.current) return;
    if (pending.length === 0) {
      resetRef.current();
    } else {
      populateRef.current(pending);
      setRearrangeModalOpen(true);
    }
  }, [deferAutoActions]);

  useEffect(() => {
    if (!awb) {
      lastFetchedAwb.current = "";
      debouncedFetch.cancel();
      return;
    }
    if (awb === lastFetchedAwb.current) return;
    lastFetchedAwb.current = awb;
    debouncedFetch(awb);
  }, [awb, debouncedFetch]);

  // Forward-AWB fetch. Own seq/last-value refs so a slow forward response
  // can't stomp the return fetch state or vice versa.
  //
  // Forward shots serve two purposes on every platform form:
  //   1. Fill BLANK slots on the right-side image grid — merged into
  //      `fetchedScreenshots`, which CommonRightPart's silent backfill
  //      reads. That backfill respects `room` (only appends to empty side
  //      slots) and dedups against filled slots, so a forward-AWB entry
  //      never displaces a return-side or manually-uploaded image. The
  //      return-side `populate` still owns "auto-set on Return AWB
  //      typing" — this side only ever fills gaps.
  //   2. Stay visible as extra picks in the Rearrange modal — also kept
  //      in `forwardOnlyScreenshots` for backward compatibility with the
  //      per-platform `show={fetchedScreenshots.length > 0 ||
  //      forwardOnlyScreenshots.length > 0}` gates on the Rearrange button.
  const forwardFetchSeqRef = useRef(0);
  const lastFetchedForwardAwb = useRef<string>("");
  const debouncedFetchForward = useMemo(
    () =>
      debounceAsync(async (awbNumber: string) => {
        const value = awbNumber?.trim();
        if (!value) return;
        const seq = ++forwardFetchSeqRef.current;
        try {
          const response = await getOrderScreenshots(value, "Forward");
          if (seq !== forwardFetchSeqRef.current || unmountedRef.current) return;
          const shots: string[] = response.data?.data || [];
          if (shots.length === 0) return;
          // Push into the shared pool so silent side-image backfill picks
          // them up. Dedup preserves URL identity across both pools.
          setFetchedScreenshots((prev) => {
            const seen = new Set(prev);
            const additions = shots.filter((url) => url && !seen.has(url));
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
          setForwardOnlyScreenshots((prev) => {
            // Dedup against BOTH pools: URLs already surfaced by the return
            // fetch (fetchedScreenshotsRef.current) shouldn't get a duplicate
            // entry in the forward pool. Without this, the Rearrange modal's
            // visibility gate could flip based on the same URL living twice.
            const seen = new Set([...prev, ...fetchedScreenshotsRef.current]);
            const additions = shots.filter((url) => url && !seen.has(url));
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
        } catch {
          // Silent by design — every platform's forward-AWB is optional and a
          // missing VMS record is expected. Any error just means the pool
          // doesn't grow; the return-side flow is unaffected.
        }
      }, 800),
    [],
  );

  useEffect(() => {
    const trimmed = (forwardAwb ?? "").trim();
    // Helper — drop the previous forward pool AND remove the same URLs from
    // the shared `fetchedScreenshots` pool so silent backfill doesn't keep
    // re-adding shots for an AWB the operator has moved past. Uses the
    // `forwardOnlyScreenshots` snapshot as the "which URLs came from
    // forward" record so return-side shots in `fetchedScreenshots` are
    // left alone.
    const dropForwardShots = () => {
      setForwardOnlyScreenshots((prev) => {
        if (prev.length === 0) return prev;
        const toRemove = new Set(prev);
        setFetchedScreenshots((all) =>
          all.some((u) => toRemove.has(u))
            ? all.filter((u) => !toRemove.has(u))
            : all,
        );
        return [];
      });
    };
    if (!trimmed) {
      lastFetchedForwardAwb.current = "";
      dropForwardShots();
      debouncedFetchForward.cancel();
      return;
    }
    if (trimmed === lastFetchedForwardAwb.current) return;
    // Switching to a different forward AWB drops the previous shots too.
    dropForwardShots();
    lastFetchedForwardAwb.current = trimmed;
    debouncedFetchForward(trimmed);
  }, [forwardAwb, debouncedFetchForward]);

  // Both debounced fetchers are memoised without deps, so they live for the
  // hook's whole lifetime. Cancel any pending call on unmount to avoid state
  // updates + wasted requests after teardown.
  useEffect(
    () => () => {
      debouncedFetch.cancel();
      debouncedFetchForward.cancel();
    },
    [debouncedFetch, debouncedFetchForward],
  );

  // Carry-over pool: when CreateCms hands us a new array (post platform
  // switch on /cms/update) merge the URLs into fetchedScreenshots and pop
  // the Rearrange modal open. Uses the array *reference* as the trigger, so
  // each caller-side `setCarryOverImages([...urls])` re-fires this effect.
  // Empty / undefined arrays are a no-op — the effect only opens the modal
  // when there's something worth arranging.
  //
  // The auto-open is also gated on `deferAutoActions` so a SKU picker
  // that's currently on-screen keeps the priority "SKU first, then
  // Rearrange" contract even during a platform switch. Pool merge is
  // safe under defer (silent-backfill / modal pool are read-only pools).
  useEffect(() => {
    if (!carryOverImages || carryOverImages.length === 0) return;
    setFetchedScreenshots((prev) => {
      const seen = new Set(prev);
      const next = [...prev];
      for (const url of carryOverImages) {
        if (url && !seen.has(url)) {
          seen.add(url);
          next.push(url);
        }
      }
      return next;
    });
    if (openModalOnCarryOver && !deferAutoActions) setRearrangeModalOpen(true);
  }, [carryOverImages, openModalOnCarryOver, deferAutoActions]);

  // Modal seed: fieldName -> current preview URL (honors manual uploads too).
  const rearrangeInitialSlots = useMemo(
    () =>
      imageFields.reduce<Record<string, string | null>>((acc, f) => {
        acc[f] = previews[f] ?? null;
        return acc;
      }, {}),
    [imageFields, previews],
  );

  // Modal pool: slot contents + orphaned return-side shots + forward-only
  // shots. Order matters — slot contents appear first so the modal shows the
  // operator's existing placements before any new pickables.
  const rearrangeImagePool = useMemo(() => {
    const slotImages = imageFields
      .map((f) => previews[f])
      .filter((v): v is string => Boolean(v));
    const seen = new Set(slotImages);
    const returnOrphans = fetchedScreenshots.filter((img) => img && !seen.has(img));
    returnOrphans.forEach((url) => seen.add(url));
    const forwardOrphans = forwardOnlyScreenshots.filter((img) => img && !seen.has(img));
    return [...slotImages, ...returnOrphans, ...forwardOrphans];
  }, [imageFields, previews, fetchedScreenshots, forwardOnlyScreenshots]);

  return {
    rearrangeModalOpen,
    setRearrangeModalOpen,
    fetchedScreenshots,
    setFetchedScreenshots,
    /**
     * Forward-AWB pool, exposed read-only so a caller can check emptiness
     * (e.g. show/hide the Rearrange button). No setter — the hook owns writes.
     */
    forwardOnlyScreenshots,
    rearrangeInitialSlots,
    rearrangeImagePool,
  };
};
