import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Small hook that owns the lifecycle of blob object-URLs created for preview
 * purposes (video / image thumbnails, etc.). Every URL handed out via
 * `createObjectURL` is tracked; callers should `release` a URL as soon as
 * they overwrite it. Any URL still tracked at unmount is revoked so a
 * component never leaks blobs even if the caller forgets to release.
 *
 * All revoke() and release() calls are safe on non-blob URLs (HTTP links) —
 * they no-op. That lets callers store either an HTTP URL from the server or
 * a local blob URL in the same state slot without branching.
 */
export const useBlobPreview = () => {
  const activeRef = useRef<Set<string>>(new Set());

  const createObjectURL = useCallback((source: Blob | File): string => {
    const url = URL.createObjectURL(source);
    activeRef.current.add(url);
    return url;
  }, []);

  const release = useCallback((url: string | null | undefined) => {
    if (!url || typeof url !== "string") return;
    if (!url.startsWith("blob:")) return;
    if (activeRef.current.has(url)) {
      URL.revokeObjectURL(url);
      activeRef.current.delete(url);
    }
  }, []);

  // For URLs constructed outside the hook (e.g. by legacy code that already
  // called URL.createObjectURL directly), let the caller opt-in to cleanup.
  const track = useCallback((url: string | null | undefined) => {
    if (!url || typeof url !== "string") return;
    if (!url.startsWith("blob:")) return;
    activeRef.current.add(url);
  }, []);

  useEffect(() => {
    // The SET is captured, not its contents — its identity is stable for the
    // life of the hook, so the cleanup revokes whatever is outstanding at
    // unmount rather than a snapshot taken at mount, when it is empty.
    const active = activeRef.current;

    return () => {
      active.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignored — already revoked or invalid, nothing to do
        }
      });
      active.clear();
    };
  }, []);

  // Stabilize the returned object reference. Every callback inside is
  // already useCallback'd (stable across renders), but a fresh object literal
  // return would still churn every consumer's `useEffect(..., [blobs])` — the
  // effect would fire on every render, and any setState it dispatched would
  // trigger an infinite loop (a real prod incident: 8k+ requests / 1.5GB
  // resources when a File landed in a `sideImages` array whose effect
  // recomputed blob URLs and setState'd back).
  return useMemo(
    () => ({ createObjectURL, release, track }),
    [createObjectURL, release, track],
  );
};

export type UseBlobPreviewReturn = ReturnType<typeof useBlobPreview>;
