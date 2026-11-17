// @ts-nocheck
import Link from "next/link";
import { useMemo, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { modulesById } from "@/config/modules/registry";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { getProductThumbnail } from "@/features/products/lib/product-helpers";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { integerFormatter } from "@/lib/intl-formatters";
import { buildHref } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const brandsModule = modulesById.brands;

function getBrandFieldDefault(e) {
  return (e.key === "status" && e.options?.[0]) || "";
}

function BrandDetailStatusBadge({ value }) {
  const t = String(value || "");
  const n = /active|published|positive|featured/i.test(t)
    ? "green"
    : /pending|scheduled|neutral|standard/i.test(t)
      ? "amber"
      : /hidden|flagged|negative|draft/i.test(t)
        ? "red"
        : "blue";
  return (
    <span className={`product-status ${n}`}>
      <i />
      {t}
    </span>
  );
}

export function BrandFormDialog({ recordId, onClose, onSaved }) {
  const r = useMemo(
    () => (recordId ? findRecord("brands", recordId) : void 0),
    [recordId],
  );
  const [i, a] = useState("");
  return recordId && !r ? null : (
    <AppDialog
      title={recordId ? `Edit ${String(r?.name || "brand")}` : "Add brand"}
      onClose={onClose}
      wide
    >
      <form
        className="c-form"
        data-c-form="record"
        data-module="brands"
        data-id={recordId || ""}
        onSubmit={(r) => {
          r.preventDefault();
          a("");
          try {
            const i = new FormData(r.currentTarget);
            const a = {};
            brandsModule.fields.forEach((e) => {
              a[e.key] = String(i.get(e.key) || "").trim();
            });
            saveRecord("brands", a, recordId || void 0);
            onClose();
            onSaved();
            showToast("Changes saved in this browser.");
          } catch (e) {
            a(
              e instanceof Error ? e.message : "This brand could not be saved.",
            );
          }
        }}
      >
        <fieldset>
          <legend>Details</legend>
          <div className="c-form-grid">
            {brandsModule.fields.map((e) => (
              <FormField
                key={e.key}
                field={e}
                value={r?.[e.key] ?? getBrandFieldDefault(e)}
                prefix="brand"
              />
            ))}
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {i}
        </p>
        <div className="c-form-footer">
          {recordId ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                try {
                  archiveRecords("brands", [recordId]);
                  onClose();
                  onSaved();
                  showToast("Records archived.");
                } catch (e) {
                  a(
                    e instanceof Error
                      ? e.message
                      : "This brand could not be archived.",
                  );
                }
              }}
            >
              Archive record
            </button>
          ) : null}
          <button type="submit" className="primary-button">
            Save changes
          </button>
        </div>
      </form>
    </AppDialog>
  );
}

export function BrandDetailDialog({ recordId, onClose }) {
  const n = findRecord("brands", recordId);
  if (!n) return null;
  const r = listRecords("products").filter((e) => e.brand === n.name);
  const i = r.reduce((e, t) => e + Number(t.sold || 0) * Number(t.price || 0), 0);
  const a = r.reduce((e, t) => e + Number(t.stock || 0), 0);
  return (
    <AppDialog
      title={`${String(n.name || "")} · brand overview`}
      onClose={onClose}
      wide
    >
      <div className="catalog-detail-hero">
        <span className="brand-avatar large">
          {String(n.name || "")
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <div>
          <small>
            {String(n.country || "—")}
            {" · "}
            {String(n.tier || "Core")}
          </small>
          <h2>{String(n.name || "")}</h2>
          <p>{String(n.notes || "Catalog brand profile")}</p>
        </div>
        <BrandDetailStatusBadge value={n.status} />
      </div>
      <div className="catalog-detail-metrics">
        <div>
          <small>Products</small>
          <strong>{r.length}</strong>
        </div>
        <div>
          <small>Revenue</small>
          <strong>{formatCurrency(i, 0)}</strong>
        </div>
        <div>
          <small>Inventory</small>
          <strong>{integerFormatter.format(a)}</strong>
        </div>
        <div>
          <small>Placement</small>
          <strong>{String(n.featured || "Standard")}</strong>
        </div>
      </div>
      <div className="catalog-product-list">
        {r.length ? (
          r.map((e) => (
            <Link
              key={e.id}
              href={buildHref(
                `/commerce/products?q=${encodeURIComponent(String(e.name || ""))}`,
              )}
            >
              <OverviewProductThumb product={getProductThumbnail(e)} />
              <span>
                <strong>{String(e.name || "")}</strong>
                <small>
                  {String(e.sku || "")}
                  {" · "}
                  {formatCurrency(Number(e.price || 0), 2)}
                </small>
              </span>
            </Link>
          ))
        ) : (
          <p>No products use this brand yet.</p>
        )}
      </div>
    </AppDialog>
  );
}
