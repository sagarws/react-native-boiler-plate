// @ts-nocheck
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { StatusPill } from "@/components/ui/status-pill";
import { SummaryList } from "@/components/ui/summary-list";
import { modulesById } from "@/config/modules/registry";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { ResourceCellValue } from "@/features/resources/components/resource-cell-value";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { hydrateProductImages } from "@/lib/media-storage";
import { buildHref, navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";
import { archiveRecords, saveRecord } from "@/lib/store/records";

function OrderItemsSummary({ row }) {
  const t = Array.isArray(row.items) ? row.items : [];
  return (
    <Fragment>
      <h3>Order summary</h3>
      <div className="c-order-items">
        {t.map((e, t) => {
          const n = e;
          const r = Number(n.quantity || 0);
          const i = Number(n.unitPrice || 0);
          return (
            <div key={`${String(n.productId || "item")}-${t}`}>
              <span>
                {getRecordLabel("products", n.productId)}
                <small>
                  {r}
                  {" × "}
                  {formatCurrency(i, 2)}
                </small>
              </span>
              <strong>{formatCurrency(r * i, 2)}</strong>
            </div>
          );
        })}
        <div>
          <span>Shipping / tax / discount</span>
          <strong>
            {formatCurrency(Number(row.shipping || 0), 2)}
            {" / "}
            {formatCurrency(Number(row.tax || 0), 2)}
            {" / −"}
            {formatCurrency(Number(row.discount || 0), 2)}
          </strong>
        </div>
        <div>
          <strong>Total</strong>
          <strong>{formatCurrency(calculateOrderTotal(row), 2)}</strong>
        </div>
      </div>
      <div className="button-row">
        <Link
          className="secondary-button"
          href={buildHref("/commerce/fulfillment")}
        >
          Track fulfillment
          <Icon name="arrow-right" />
        </Link>
        <Link
          className="secondary-button"
          href={buildHref("/commerce/deliveries")}
        >
          Delivery status
          <Icon name="arrow-right" />
        </Link>
        <Link
          className="secondary-button"
          href={buildHref("/commerce/returns")}
        >
          Returns
          <Icon name="arrow-right" />
        </Link>
        <Link
          className="secondary-button"
          href={buildHref("/commerce/refunds")}
        >
          Refund requests
          <Icon name="arrow-right" />
        </Link>
      </div>
    </Fragment>
  );
}

function CustomerOrderHistory({ customerId }) {
  const t = listRecords("orders").filter((t) => t.customerId === customerId);
  const n = t.filter((e) => e.status !== "Cancelled");
  const r = n.reduce((e, t) => e + calculateOrderTotal(t), 0);
  const i = [...t].sort((e, t) =>
    String(t.date || "").localeCompare(String(e.date || "")),
  )[0];
  const a = [
    ["Orders", t.length],
    ["Lifetime order value", formatCurrency(r, 2)],
    ["Average order value", formatCurrency(n.length ? r / n.length : 0, 2)],
    ["Last order", String(i?.date || "—")],
  ];
  return (
    <Fragment>
      <h3>Customer history</h3>
      <SummaryList items={a} />
      <div className="c-related-list">
        {t.map((e) => (
          <Link
            key={e.id}
            href={buildHref(
              `/commerce/orders?q=${encodeURIComponent(String(e.number || ""))}`,
            )}
          >
            {String(e.number || "")}{" "}
            <StatusPill value={String(e.status || "")} />{" "}
            {formatCurrency(calculateOrderTotal(e), 2)}
          </Link>
        ))}
      </div>
      <Link className="secondary-button" href={buildHref("/commerce/chat")}>
        Open customer inbox
        <Icon name="arrow-right" />
      </Link>
    </Fragment>
  );
}

const recordPreviewIconMap = {
  tee: "t-shirt",
  mug: "coffee",
  bottle: "thermometer",
};

function ProductRecordPreview({ row }) {
  const t = useRef(null);
  const n = Array.isArray(row.mediaIds) ? row.mediaIds : [];
  useEffect(() => {
    if (t.current) {
      hydrateProductImages(t.current).catch((e) =>
        showToast(
          e instanceof Error ? e.message : "Product image could not be loaded.",
        ),
      );
    }
  }, [row.id]);
  return (
    <div ref={t}>
      <div className="c-product-hero">
        <OverviewProductThumb
          product={{
            mediaId: n.length ? String(n[0] || "") : void 0,
            icon:
              recordPreviewIconMap[String(row.image || "")] ||
              String(row.image || ""),
          }}
        />
        <div>
          <strong>{formatCurrency(Number(row.price || 0), 2)}</strong>
          <p>{String(row.description || "")}</p>
        </div>
      </div>
      <div className="button-row">
        <Link
          className="secondary-button"
          href={buildHref(
            `/commerce/products/edit?id=${encodeURIComponent(row.id)}`,
          )}
        >
          {"Manage options & variants"}
        </Link>
        <Link
          className="secondary-button"
          href={buildHref("/commerce/reviews")}
        >
          Customer reviews
        </Link>
      </div>
    </div>
  );
}

function resolveRecordModule(e) {
  return e.derived ? modulesById[e.derived] : e;
}

function getFieldDefaultValue(e) {
  return e.key === "status"
    ? e.options?.[0] || ""
    : e.type === "money" || e.type === "number"
      ? (e.min ?? 0)
      : "";
}

export function ResourceRecordDialog({
  module,
  mode,
  recordId,
  onClose,
  onChanged,
  onEdit,
  onPageBuilder,
}) {
  const s = resolveRecordModule(module);
  const c = useMemo(
    () => (recordId ? findRecord(s.id, recordId) : void 0),
    [recordId, s.id],
  );
  const [u, d] = useState("");
  if (mode === "variant-picker")
    return (
      <AppDialog title="Choose a product" onClose={onClose}>
        <form
          className="c-form"
          data-c-form="variants"
          onSubmit={(e) => {
            e.preventDefault();
            const t = String(
              new FormData(e.currentTarget).get("productId") || "",
            );
            if (t) {
              onClose();
              navigate(`/commerce/products/edit?id=${encodeURIComponent(t)}`);
            } else {
              d("Choose a product first.");
            }
          }}
        >
          <FormField
            field={{
              key: "productId",
              label: "Product",
              type: "text",
              relation: "products",
              required: true,
            }}
          />
          <p>
            Choose colors and sizes, generate combinations, and edit prices and
            stock in the full product editor.
          </p>
          <p className="c-form-error" role="alert">
            {u}
          </p>
          <button type="submit" className="primary-button">
            Open product editor
          </button>
        </form>
      </AppDialog>
    );
  if (mode === "detail") {
    if (!c) return null;
    const t = String(c.name || c.number || c.code || module.title);
    return (
      <AppDialog title={t} onClose={onClose} wide>
        {module.id === "orders" ? <OrderItemsSummary row={c} /> : null}
        {module.id === "products" ? <ProductRecordPreview row={c} /> : null}
        {module.id === "customers" ? (
          <CustomerOrderHistory customerId={c.id} />
        ) : null}
        {module.id === "pages" ? (
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              data-c-action="page-builder"
              data-id={c.id}
              onClick={() => onPageBuilder?.(c.id)}
            >
              Open page builder
            </button>
          </div>
        ) : null}
        <dl className="c-details">
          {s.fields.map((e) => (
            <div key={e.key}>
              <dt>{e.label}</dt>
              <dd>
                <ResourceCellValue
                  module={s}
                  row={c}
                  fieldKey={e.key}
                  largeImage={e.type === "image" || e.type === "content-image"}
                />
              </dd>
            </div>
          ))}
        </dl>
        {module.readonly ? null : (
          <div className="button-row">
            <button
              type="button"
              className="primary-button"
              data-c-action="edit"
              data-id={c.id}
              onClick={() => {
                onClose();
                onEdit?.(c.id);
              }}
            >
              Edit record
            </button>
          </div>
        )}
      </AppDialog>
    );
  }
  const f = recordId
    ? `Edit ${String(c?.name || c?.number || module.title)}`
    : `Add ${module.addLabel || (module.id === "orders" ? "order" : module.id === "blog" ? "blog post" : module.id === "testimonials" ? "testimonial" : module.id.endsWith("-categories") ? "category" : "record")}`;
  return (
    <AppDialog title={f} onClose={onClose} wide>
      <form
        className="c-form"
        data-c-form="record"
        data-module={s.id}
        data-id={recordId || ""}
        onSubmit={(e) => {
          e.preventDefault();
          d("");
          try {
            const t = new FormData(e.currentTarget);
            const a = {};
            s.fields.forEach((e) => {
              const n = t.get(e.key);
              const r = typeof n == "string" ? n.trim() : "";
              a[e.key] =
                ["money", "number"].includes(e.type) && r !== ""
                  ? Number(r)
                  : r;
            });
            saveRecord(s.id, a, recordId || void 0);
            onClose();
            onChanged();
            showToast("Changes saved in this browser.");
          } catch (e) {
            d(
              e instanceof Error
                ? e.message
                : "This record could not be saved.",
            );
          }
        }}
      >
        <fieldset>
          <legend>Details</legend>
          <div className="c-form-grid">
            {s.fields.map((t) => {
              const r =
                module.id === "testimonials" &&
                t.key === "subtitle" &&
                c?.subtitle == null &&
                c?.role != null
                  ? c.role
                  : void 0;
              const i =
                recordId && t.relation && !c?.[t.key]
                  ? modulesById[t.relation]?.seeds?.[0]?.id || ""
                  : void 0;
              return (
                <FormField
                  key={t.key}
                  field={t}
                  value={r ?? i ?? c?.[t.key] ?? getFieldDefaultValue(t)}
                  mediaFolder={s.imageFolder || "Store content"}
                />
              );
            })}
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {u}
        </p>
        <div className="c-form-footer">
          {recordId && !module.id.endsWith("-categories") ? (
            <button
              type="button"
              className="secondary-button"
              data-c-action="archive"
              data-id={recordId}
              onClick={() => {
                try {
                  archiveRecords(s.id, [recordId], false);
                  onClose();
                  onChanged();
                  showToast(
                    "Records archived. Switch on Archived to restore them.",
                  );
                } catch (e) {
                  d(
                    e instanceof Error
                      ? e.message
                      : "This record could not be archived.",
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
