import { useCallback, useEffect, useRef, useState } from "react";

const revokeIfBlob = (url: string | null | undefined) => {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
};

/**
 * Container hook for the Myntra right-form. Owns the preview state (object
 * URLs) that does not belong in formik. Ported from
 * TrackVid-App/src/renderer/src/container/MyntraClaim/useMyntraClaim.ts.
 */
export const useMyntraClaim = () => {
  const [shippingLabelPreview, setShippingLabelPreviewState] = useState<string | null>(null);
  const [packingPreviews, setPackingPreviewsState] = useState<(string | null)[]>([]);
  const [damagedVideoPreview, setDamagedVideoPreviewState] = useState<string | null>(null);

  const shippingLabelRef = useRef<string | null>(null);
  const damagedVideoRef = useRef<string | null>(null);
  const packingRef = useRef<(string | null)[]>([]);

  const setShippingLabelPreview = useCallback((v: string | null) => {
    setShippingLabelPreviewState((prev) => {
      if (prev !== v) revokeIfBlob(prev);
      shippingLabelRef.current = v;
      return v;
    });
  }, []);

  const setDamagedVideoPreview = useCallback((v: string | null) => {
    setDamagedVideoPreviewState((prev) => {
      if (prev !== v) revokeIfBlob(prev);
      damagedVideoRef.current = v;
      return v;
    });
  }, []);

  const setPackingPreviews = useCallback<
    React.Dispatch<React.SetStateAction<(string | null)[]>>
  >((action) => {
    setPackingPreviewsState((prev) => {
      const next = typeof action === "function" ? (action as any)(prev) : action;
      const kept = new Set(next);
      prev.forEach((url) => {
        if (url && !kept.has(url)) revokeIfBlob(url);
      });
      packingRef.current = next;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setShippingLabelPreview(null);
    setPackingPreviews([]);
    setDamagedVideoPreview(null);
  }, [setShippingLabelPreview, setPackingPreviews, setDamagedVideoPreview]);

  useEffect(() => {
    return () => {
      revokeIfBlob(shippingLabelRef.current);
      revokeIfBlob(damagedVideoRef.current);
      packingRef.current.forEach(revokeIfBlob);
    };
  }, []);

  return {
    shippingLabelPreview,
    setShippingLabelPreview,
    packingPreviews,
    setPackingPreviews,
    damagedVideoPreview,
    setDamagedVideoPreview,
    reset,
  };
};

export type UseMyntraClaimReturn = ReturnType<typeof useMyntraClaim>;
