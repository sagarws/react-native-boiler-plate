"use client";

import { useEffect, useRef, useState } from "react";
import { getOrderScreenshots } from "@/services/cms-autofetch-service";
import { useDebounced, useUnmounted } from "@/features/cms-create/hooks";
import type { MediaSrc } from "@/features/cms-create/media/media-thumb";

export interface VmsScreenshotsOptions {
  awb: string;
  forwardAwb?: string;
  /** Current preview per slot field (feeds the Rearrange dialog's initial layout and pool). */
  previews: Record<string, MediaSrc | null | undefined>;
  imageFields: string[];
  /** Spread fetched shots into the platform's slots. */
  populate: (screenshots: string[]) => void;
  /** Clear the slots a previous AWB filled. */
  reset: () => void;
  /** /cms/update: shots carried over from the previous platform after a switch. */
  carryOverImages?: string[];
  openModalOnCarryOver?: boolean;
  /** Hold populate + auto-open while another modal (AJIO SKU picker) is on screen. */
  deferAutoActions?: boolean;
  /** /cms/update: VMS auto-fill is off; stored images are shown instead. */
  isUpdateMode: boolean;
}

/**
 * TrackVid `useVmsScreenshots`: when the Return AWB settles, fetch its VMS frames, populate the slots and pop the
 * Rearrange dialog (create mode only). Forward-AWB frames join the pool without auto-filling. Debounced 800 ms;
 * stale responses are dropped by a sequence number.
 */
export function useVmsScreenshots({ awb, forwardAwb, previews, imageFields, populate, reset, carryOverImages, openModalOnCarryOver = true, deferAutoActions = false, isUpdateMode }: VmsScreenshotsOptions) {
  const [rearrangeModalOpen, setRearrangeModalOpen] = useState(false);
  const [fetchedScreenshots, setFetchedScreenshots] = useState<string[]>([]);
  const [forwardOnlyScreenshots, setForwardOnlyScreenshots] = useState<string[]>([]);
  const unmounted = useUnmounted();
  const latest = useRef({ populate, reset, isUpdateMode, deferAutoActions });
  const seq = useRef(0);
  const forwardSeq = useRef(0);
  const lastAwb = useRef("");
  const lastForward = useRef("");
  const pending = useRef<string[] | null>(null);

  useEffect(() => {
    latest.current = { populate, reset, isUpdateMode, deferAutoActions };
  });

  const apply = (shots: string[]) => {
    const { populate: pop, reset: rst, deferAutoActions: defer, isUpdateMode: update } = latest.current;
    if (update) return;
    if (defer) {
      pending.current = shots;
      return;
    }
    if (shots.length) {
      pop(shots);
      setRearrangeModalOpen(true);
    } else rst();
  };

  const fetchReturn = useDebounced((value: string) => {
    const id = ++seq.current;
    getOrderScreenshots(value, "Return")
      .then((res) => {
        if (id !== seq.current || unmounted.current) return;
        const shots = res.data ?? [];
        if (shots.length || !latest.current.isUpdateMode) setFetchedScreenshots(shots);
        apply(shots);
      })
      .catch(() => {
        if (id !== seq.current || unmounted.current) return;
        if (!latest.current.isUpdateMode) setFetchedScreenshots([]);
        apply([]);
      });
  }, 800);

  const fetchForward = useDebounced((value: string) => {
    // Drop the previous forward AWB's shots first (they belong to another order).
    setForwardOnlyScreenshots((prev) => {
      if (prev.length) {
        const gone = new Set(prev);
        setFetchedScreenshots((all) => (all.some((u) => gone.has(u)) ? all.filter((u) => !gone.has(u)) : all));
      }
      return [];
    });
    if (!value) return;
    const id = ++forwardSeq.current;
    getOrderScreenshots(value, "Forward")
      .then((res) => {
        if (id !== forwardSeq.current || unmounted.current) return;
        const shots = (res.data ?? []).filter(Boolean);
        if (!shots.length) return;
        setFetchedScreenshots((prev) => [...prev, ...shots.filter((u) => !prev.includes(u))]);
        setForwardOnlyScreenshots(shots);
      })
      .catch(() => {
        // Forward frames are a bonus for the pool; a miss changes nothing on screen.
      });
  }, 800);

  const fetchReturnCall = fetchReturn.call;
  const fetchReturnCancel = fetchReturn.cancel;
  useEffect(() => {
    const value = awb.trim();
    if (!value) {
      lastAwb.current = "";
      fetchReturnCancel();
      return;
    }
    if (value === lastAwb.current) return;
    lastAwb.current = value;
    fetchReturnCall(value);
  }, [awb, fetchReturnCall, fetchReturnCancel]);

  const fetchForwardCall = fetchForward.call;
  useEffect(() => {
    const value = (forwardAwb ?? "").trim();
    if (value === lastForward.current) return;
    lastForward.current = value;
    fetchForwardCall(value);
  }, [forwardAwb, fetchForwardCall]);

  // Released when the blocking modal closes.
  useEffect(() => {
    if (deferAutoActions || pending.current === null) return;
    const shots = pending.current;
    pending.current = null;
    if (latest.current.isUpdateMode) return;
    if (shots.length) {
      latest.current.populate(shots);
      window.setTimeout(() => {
        if (!unmounted.current) setRearrangeModalOpen(true);
      }, 0);
    } else latest.current.reset();
  }, [deferAutoActions, unmounted]);

  // Carried-over images join the pool (and optionally open the dialog) — adjusted during render, not in an effect.
  const [seenCarry, setSeenCarry] = useState<string[] | undefined>(undefined);
  if (carryOverImages !== seenCarry) {
    setSeenCarry(carryOverImages);
    if (carryOverImages && carryOverImages.length) {
      setFetchedScreenshots((prev) => [...prev, ...carryOverImages.filter((u) => u && !prev.includes(u))]);
      if (openModalOnCarryOver && !deferAutoActions) setRearrangeModalOpen(true);
    }
  }

  const rearrangeInitialSlots: Record<string, MediaSrc | null> = {};
  for (const f of imageFields) rearrangeInitialSlots[f] = previews[f] ?? null;
  const slotImages = imageFields.map((f) => previews[f]).filter((v): v is MediaSrc => Boolean(v));
  const seen = new Set<MediaSrc>(slotImages);
  const pool: MediaSrc[] = [...slotImages];
  for (const u of [...fetchedScreenshots, ...forwardOnlyScreenshots]) {
    if (u && !seen.has(u)) {
      seen.add(u);
      pool.push(u);
    }
  }

  return { rearrangeModalOpen, setRearrangeModalOpen, fetchedScreenshots, setFetchedScreenshots, forwardOnlyScreenshots, rearrangeInitialSlots, rearrangeImagePool: pool };
}
