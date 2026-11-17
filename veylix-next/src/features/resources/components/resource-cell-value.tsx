// @ts-nocheck
import { Fragment, useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCurrency } from "@/lib/format";
import { getMediaFile } from "@/lib/media-storage";
import { getRecordLabel } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";

function ResourceTableImage({ mediaId = "", alt = "", large = false }) {
  const [r, i] = useState("");
  useEffect(() => {
    let t = true;
    let n = "";
    i("");
    return mediaId
      ? (getMediaFile(mediaId)
          .then((e) => {
            if (
              t &&
              !e?.trashed &&
              e?.blob &&
              String(e.type || "").startsWith("image/")
            ) {
              n = URL.createObjectURL(e.blob);
              i(n);
            }
          })
          .catch(() => i("")),
        () => {
          t = false;
          if (n) {
            URL.revokeObjectURL(n);
          }
        })
      : () => void 0;
  }, [mediaId]);
  return r ? (
    <span className="c-content-table-image has-image">
      <img src={r} alt={alt} />
    </span>
  ) : (
    <span className="c-content-table-image" aria-label="No image">
      —
    </span>
  );
}

export function formatResourceCellText(e, t, n) {
  const r = e.fields.find((e) => e.key === n);
  if (n === "total") return formatCurrency(calculateOrderTotal(t), 2);
  if (n === "net")
    return formatCurrency(Number(t.gross) * (1 - Number(t.rate) / 100), 2);
  if (r?.relation) return getRecordLabel(r.relation, t[n]);
  if (r?.type === "image" || r?.type === "content-image")
    return t[n] ? String(t[n]) : "";
  if (r?.type === "money") return formatCurrency(Number(t[n] || 0), 2);
  if (n === "stock") return `${t.stock ?? 0} units`;
  const i = t[n];
  return Array.isArray(i)
    ? i.join(", ")
    : i == null || i === ""
      ? "—"
      : typeof i == "object"
        ? JSON.stringify(i)
        : String(i);
}

export function ResourceCellValue({
  module,
  row,
  fieldKey,
  largeImage = false,
}) {
  const i = module.fields.find((e) => e.key === fieldKey);
  const a = row[fieldKey];
  return fieldKey === "total" ? (
    <Fragment>{formatCurrency(calculateOrderTotal(row), 2)}</Fragment>
  ) : fieldKey === "net" ? (
    <Fragment>
      {formatCurrency(Number(row.gross) * (1 - Number(row.rate) / 100), 2)}
    </Fragment>
  ) : i?.relation ? (
    <Fragment>{getRecordLabel(i.relation, a)}</Fragment>
  ) : i?.type === "image" || i?.type === "content-image" ? (
    <ResourceTableImage
      mediaId={a ? String(a) : ""}
      alt={String(row.name || "")}
      large={largeImage}
    />
  ) : i?.type === "money" ? (
    <Fragment>{formatCurrency(Number(a || 0), 2)}</Fragment>
  ) : fieldKey === "status" || fieldKey === "payment" ? (
    <StatusPill value={String(a || "")} />
  ) : fieldKey === "stock" ? (
    <span
      className={
        Number(row.stock) <= Number(row.threshold ?? 15)
          ? "stock-low"
          : "stock-ok"
      }
    >
      {String(row.stock ?? 0)}
      {" units"}
    </span>
  ) : (
    <Fragment>{formatResourceCellText(module, row, fieldKey)}</Fragment>
  );
}
