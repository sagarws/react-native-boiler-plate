// @ts-nocheck
import { brandAssets } from "@/config/branding";
import { readGeneralSettings } from "@/lib/branding";

export function StorePreviewBrand({ className = "c-preview-brand" }) {
  const t = readGeneralSettings();
  const n = t.siteLogo || brandAssets.siteLogo;
  const r = t.storeName || "Veylix";
  return (
    <span className={className}>
      <img
        src={n}
        alt={r}
        style={{
          display: "block",
          maxWidth: 180,
          maxHeight: 40,
          width: "auto",
          height: "auto",
          objectFit: "contain",
        }}
      />
    </span>
  );
}
