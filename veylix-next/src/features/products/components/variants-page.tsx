// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar } from "@/components/ui/bulk-selection-bar";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { modulesById } from "@/config/modules/registry";
import {
  ProductOptionHealthCard,
  VariantSummaryGrid,
} from "@/features/products/components/variant-overview";
import { VariantsTable } from "@/features/products/components/variants-table";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { integerFormatter } from "@/lib/intl-formatters";
import { navigate } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const variantsModule = modulesById.variants;

function getVariantSortValue(e, t, n) {
  return t === "product"
    ? String(n.get(String(e.productId || ""))?.name || "")
    : t === "price" || t === "stock"
      ? Number(e[t] || 0)
      : String(e[t] || "");
}

export function VariantsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState(false);
  const [u, d] = useState("");
  const [f, p] = useState(1);
  const [m, h] = useState(1);
  const [g, _] = useState(8);
  const [v, y] = useState(new Set());
  const [b, x] = useState(0);
  const [S, C] = useState(null);
  const w = useMemo(() => listRecords("products"), [b]);
  const T = useMemo(
    () =>
      listRecords("variants", {
        archived: s,
      }),
    [s, b],
  );
  const E = useMemo(() => new Map(w.map((e) => [e.id, e])), [w]);
  const D = useMemo(
    () =>
      w.filter((e) =>
        listRecords("variants").some((t) => String(t.productId || "") === e.id),
      ),
    [w, b],
  );
  const O = useMemo(() => {
    const e = t.trim().toLowerCase();
    const n = T.filter((t) => {
      const n = E.get(String(t.productId || ""));
      return (a && String(t.productId || "") !== a) ||
        (r && String(t.status || "") !== r)
        ? false
        : !e ||
            [t.name, t.sku, n?.name, n?.category, n?.brand]
              .join(" ")
              .toLowerCase()
              .includes(e);
    });
    if (u) {
      n.sort((e, t) => {
        const n = getVariantSortValue(e, u, E);
        const r = getVariantSortValue(t, u, E);
        return (
          f *
          (typeof n == "number" && typeof r == "number"
            ? n - r
            : String(n).localeCompare(String(r)))
        );
      });
    }
    return n;
  }, [T, E, a, r, t, u, f]);
  const k = Math.max(1, Math.ceil(O.length / g));
  const A = Math.min(m, k);
  const j = O.slice((A - 1) * g, A * g);
  const M = O.length ? (A - 1) * g + 1 : 0;
  const N = Math.min(A * g, O.length);
  const ee = !!(t || r || a);
  const te = () => x((e) => e + 1);
  const ne = () => y(new Set());
  const re = (e, t) => {
    e(t);
    h(1);
    ne();
  };
  const ie = (e) => {
    c(e);
    h(1);
    ne();
  };
  const ae = (e) => {
    p((t) => (u === e && t === 1 ? -1 : 1));
    d(e);
  };
  const oe = (e, t) =>
    y((n) => {
      const r = new Set(n);
      if (t) {
        r.add(e);
      } else {
        r.delete(e);
      }
      return r;
    });
  const se = (e) =>
    y((t) => {
      const n = new Set(t);
      j.forEach((t) => {
        if (e) {
          n.add(t.id);
        } else {
          n.delete(t.id);
        }
      });
      return n;
    });
  const ce = (e, t) => {
    try {
      archiveRecords("variants", e, t);
      ne();
      te();
      showToast(
        t
          ? "Records restored."
          : "Records archived. Switch on Archived variants to restore them.",
      );
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This change could not be completed.",
      );
    }
  };
  return (
    <Fragment>
      <CommercePageHeading
        title={variantsModule.title}
        onExport={() => {
          downloadFile(
            "veylix-variants.csv",
            "﻿" +
              buildCsv(
                O.map((e) => ({
                  productId:
                    E.get(String(e.productId || ""))?.name || e.productId,
                  name: e.name,
                  sku: e.sku,
                  price: e.price,
                  stock: e.stock,
                  status: e.status,
                })),
                ["productId", "name", "sku", "price", "stock", "status"],
                [
                  "Product",
                  "Combination",
                  "Variant SKU",
                  "Price",
                  "Stock",
                  "Status",
                ],
              ),
          );
          showToast("Filtered records exported.");
        }}
        actions={
          <button
            type="button"
            className="primary-button"
            data-c-action="variant-picker"
            onClick={() =>
              C({
                mode: "variant-picker",
              })
            }
          >
            <Icon name="sparkle" />
            {" Manage product options"}
          </button>
        }
      />
      <VariantSummaryGrid rows={listRecords("variants")} products={w} />
      <ProductOptionHealthCard products={w} />
      <section className="glass-card product-filter-card catalog-ops-filter">
        <div className="c-toolbar product-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter by product</span>
            <select
              data-catalog-product
              value={a}
              onChange={(e) => re(o, e.currentTarget.value)}
            >
              <option value="">All variant products</option>
              {D.map((e) => (
                <option key={e.id} value={e.id}>
                  {String(e.name || "")}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter variant status</span>
            <select
              data-c-filter
              value={r}
              onChange={(e) => re(i, e.currentTarget.value)}
            >
              <option value="">All statuses</option>
              {["Active", "Disabled"].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-archive-toggle">
            <input
              type="checkbox"
              data-c-archive
              checked={s}
              onChange={(e) => ie(e.currentTarget.checked)}
            />
            {" Archived variants"}
          </label>
          <label className="c-search product-search">
            <Icon name="search" />
            <input
              data-c-search
              type="search"
              placeholder="Search combination, SKU or product..."
              value={t}
              onChange={(e) => re(n, e.currentTarget.value)}
              aria-label="Search variants"
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource catalog-ops-resource">
        <div className="product-list-heading catalog-ops-list-heading">
          <div>
            <span>VARIANT MATRIX</span>
            <h2>Sellable combinations</h2>
            <p>
              Keep SKU, price, availability and option combinations aligned with
              the parent product.
            </p>
          </div>
          <small>
            {integerFormatter.format(O.length)}
            {" matching variants"}
          </small>
        </div>
        <div id="resource-results">
          <BulkSelectionBar
            count={v.size}
            archived={s}
            onBulkArchive={() => ce([...v], s)}
            onClear={ne}
          />
          {O.length ? (
            <VariantsTable
              rows={j}
              products={w}
              selected={v}
              sort={u}
              direction={f}
              archived={s}
              onSort={ae}
              onToggleRow={oe}
              onToggleAll={se}
              onManage={(e) => {
                const t = findRecord("variants", e);
                if (t) {
                  navigate(
                    `/commerce/products/edit?id=${encodeURIComponent(String(t.productId || ""))}`,
                  );
                } else {
                  showToast("This variant is no longer available.");
                }
              }}
              onViewProduct={(e) => {
                const t = findRecord("variants", e);
                if (!t) {
                  showToast("This variant is no longer available.");
                  return;
                }
                const n = findRecord("products", String(t.productId || ""));
                navigate(
                  n
                    ? `/commerce/products?q=${encodeURIComponent(String(n.name || ""))}`
                    : "/commerce/products",
                );
              }}
              onCopySku={async (e) => {
                const t = findRecord("variants", e);
                if (!t) {
                  showToast("This variant is no longer available.");
                  return;
                }
                const n = String(t.sku || "—");
                try {
                  await navigator.clipboard?.writeText(n);
                  showToast("Variant SKU copied.");
                } catch {
                  showToast(`SKU: ${n}`);
                }
              }}
              onToggleStatus={(e) => {
                const t = findRecord("variants", e);
                if (!t) {
                  showToast("This variant is no longer available.");
                  return;
                }
                const n =
                  String(t.status || "") === "Active" ? "Disabled" : "Active";
                saveRecord(
                  "variants",
                  {
                    status: n,
                  },
                  e,
                );
                te();
                showToast(
                  n === "Active" ? "Variant enabled." : "Variant disabled.",
                );
              }}
              onArchive={(e) => ce([e], false)}
              onRestore={(e) => ce([e], true)}
            />
          ) : (
            <div
              className="table-scroll c-table-scroll catalog-ops-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Product variants"
            >
              <div className="c-empty">
                <Icon name="basket" />
                <h3>
                  {ee
                    ? "No variants match these filters"
                    : s
                      ? "No archived variants"
                      : "No variants yet"}
                </h3>
                <p>
                  {ee
                    ? "Try another product, status or search term."
                    : "Open a product and configure option groups to generate combinations."}
                </p>
              </div>
            </div>
          )}
          <footer className="c-pagination">
            <span>
              {M}–{N}
              {" of "}
              {O.length}
              {" variants"}
            </span>
            <label>
              {"Per page "}
              <select
                data-c-page-size
                value={g}
                onChange={(e) => {
                  _(Number(e.currentTarget.value));
                  h(1);
                }}
              >
                <option value={8}>8</option>
                <option value={16}>16</option>
                <option value={32}>32</option>
              </select>
            </label>
            <div>
              <button
                type="button"
                className="secondary-button"
                disabled={A === 1}
                onClick={() => h(Math.max(1, A - 1))}
              >
                Previous
              </button>
              <span>
                {A}
                {" / "}
                {k}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={A === k}
                onClick={() => h(Math.min(k, A + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {S?.mode === "variant-picker" ? (
        <ResourceRecordDialog
          module={variantsModule}
          mode="variant-picker"
          onClose={() => C(null)}
          onChanged={te}
        />
      ) : null}
    </Fragment>
  );
}
