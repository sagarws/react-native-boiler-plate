// @ts-nocheck
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { modulesById } from "@/config/modules/registry";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { getCollectionProducts } from "@/features/products/lib/merchandising-products";
import { getProductThumbnail } from "@/features/products/lib/product-helpers";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { hydrateProductImages } from "@/lib/media-storage";
import { buildHref } from "@/lib/navigation";
import { findRecord } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const collectionsModule = modulesById.collections;

const tagsModule = modulesById.tags;

const merchandisingDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function getMerchandisingFieldDefault(e) {
  return (e.key === "status" && e.options?.[0]) || "";
}

function MerchandisingStatusBadge({ value }) {
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

function MerchandisingRecordFormDialog({
  module,
  noun,
  recordId,
  onClose,
  onSaved,
}) {
  const a = useMemo(
    () => (recordId ? findRecord(module.id, recordId) : void 0),
    [module.id, recordId],
  );
  const [o, s] = useState("");
  return recordId && !a ? null : (
    <AppDialog
      title={recordId ? `Edit ${String(a?.name || noun)}` : `Add ${noun}`}
      onClose={onClose}
      wide
    >
      <form
        className="c-form"
        data-c-form="record"
        data-module={module.id}
        data-id={recordId || ""}
        onSubmit={(a) => {
          a.preventDefault();
          s("");
          try {
            const t = new FormData(a.currentTarget);
            const o = {};
            module.fields.forEach((e) => {
              o[e.key] = String(t.get(e.key) || "").trim();
            });
            saveRecord(module.id, o, recordId || void 0);
            onClose();
            onSaved();
            showToast("Changes saved in this browser.");
          } catch (e) {
            s(
              e instanceof Error
                ? e.message
                : `This ${noun} could not be saved.`,
            );
          }
        }}
      >
        <fieldset>
          <legend>Details</legend>
          <div className="c-form-grid">
            {module.fields.map((t) => (
              <FormField
                key={t.key}
                field={t}
                value={a?.[t.key] ?? getMerchandisingFieldDefault(t)}
                prefix={module.id}
              />
            ))}
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {o}
        </p>
        <div className="c-form-footer">
          {recordId ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                try {
                  archiveRecords(module.id, [recordId]);
                  onClose();
                  onSaved();
                  showToast("Records archived.");
                } catch (e) {
                  s(
                    e instanceof Error
                      ? e.message
                      : `This ${noun} could not be archived.`,
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

export function CollectionFormDialog(e) {
  return (
    <MerchandisingRecordFormDialog
      {...e}
      module={collectionsModule}
      noun="collection"
    />
  );
}

export function TagFormDialog(e) {
  return (
    <MerchandisingRecordFormDialog {...e} module={tagsModule} noun="tag" />
  );
}

export function CollectionDetailDialog({ recordId, onClose }) {
  const n = useRef(null);
  const r = findRecord("collections", recordId);
  const i = r ? getCollectionProducts(r) : [];
  useEffect(() => {
    if (n.current) {
      hydrateProductImages(n.current).catch(() => void 0);
    }
  }, [recordId]);
  return r ? (
    <AppDialog
      title={`${String(r.name || "")} · collection preview`}
      onClose={onClose}
      wide
    >
      <div ref={n}>
        <div className="catalog-detail-hero">
          <span className="catalog-detail-icon">
            <Icon name="sparkle" />
          </span>
          <div>
            <small>
              {String(r.rule || "")}
              {" · "}
              {String(r.value || "")}
            </small>
            <h2>{String(r.name || "")}</h2>
            <p>{String(r.notes || "Smart collection preview")}</p>
          </div>
          <MerchandisingStatusBadge value={r.status} />
        </div>
        <div className="catalog-detail-metrics">
          <div>
            <small>Matched products</small>
            <strong>{i.length}</strong>
          </div>
          <div>
            <small>Placement</small>
            <strong>{String(r.placement || "")}</strong>
          </div>
          <div>
            <small>Starts</small>
            <strong>
              {((e) =>
                e
                  ? merchandisingDateFormatter.format(
                      new Date(`${String(e)}T00:00:00`),
                    )
                  : "Always on")(r.startAt)}
            </strong>
          </div>
          <div>
            <small>Order</small>
            <strong>{String(r.sort || "")}</strong>
          </div>
        </div>
        <div className="catalog-product-list">
          {i.length ? (
            i.map((e) => (
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
            <p>No products match this collection rule right now.</p>
          )}
        </div>
      </div>
    </AppDialog>
  ) : null;
}
