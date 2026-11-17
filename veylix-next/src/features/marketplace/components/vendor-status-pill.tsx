// @ts-nocheck
import { vendorStatusTone } from "@/features/marketplace/lib/vendor-format";

export function VendorStatusPill({ value }) {
  return (
    <span className={`vendor-pill ${vendorStatusTone(value)}`}>
      <i />
      {String(value || "—")}
    </span>
  );
}
