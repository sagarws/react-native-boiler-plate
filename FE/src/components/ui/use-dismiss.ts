"use client";

import { useEffect, type RefObject } from "react";

/** Close a popover on outside click or Escape. Listeners are removed when closed or unmounted. */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const { signal } = controller;
    document.addEventListener(
      "mousedown",
      (e) => {
        if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
      },
      { signal },
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") onClose();
      },
      { signal },
    );
    return () => controller.abort();
  }, [open, ref, onClose]);
}
