// @ts-nocheck
import { Fragment, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar } from "@/components/ui/bulk-selection-bar";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { modulesById } from "@/config/modules/registry";
import { ProductActivityDialog } from "@/features/products/components/product-activity-dialog";
import { ProductDeleteDialog } from "@/features/products/components/product-delete-dialog";
import { ProductDetailDialog } from "@/features/products/components/product-detail-dialog";
import { ProductImportDialog } from "@/features/products/components/product-import-dialog";
import { ProductSummaryGrid } from "@/features/products/components/product-summary-grid";
import { ProductsTable } from "@/features/products/components/products-table";
import {
  formatProductUpdatedAt,
  getProductSortValue,
  getProductStockStatus,
} from "@/features/products/lib/product-helpers";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { integerFormatter } from "@/lib/intl-formatters";
import { revokeProductImageUrls } from "@/lib/media-storage";
import { navigate } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { duplicateProduct } from "@/lib/store/products";
import { archiveRecords } from "@/lib/store/records";

const productsPageModule = modulesById.products;

function listProductRecords(e) {
  return listRecords("products", {
    archived: e,
  });
}

async function shareProductLink(e) {
  const t = new URL(`/products/${String(e.slug || e.id)}`, location.origin).href;
  if (navigator.share)
    try {
      await navigator.share({
        title: String(e.name || ""),
        text: `View ${String(e.name || "")}`,
        url: t,
      });
      return "Share sheet opened.";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "";
    }
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(t);
  else {
    const e = document.createElement("textarea");
    e.value = t;
    e.setAttribute("readonly", "");
    e.style.position = "fixed";
    e.style.opacity = "0";
    document.body.append(e);
    e.select();
    document.execCommand("copy");
    e.remove();
  }
  return "Product link copied.";
}

export function ProductsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState("");
  const [u, d] = useState(1);
  const [f, p] = useState(1);
  const [m, h] = useState(8);
  const [g, _] = useState(() => new Set());
  const [v, y] = useState(false);
  const [b, x] = useState(0);
  const [S, C] = useState(null);
  useEffect(() => () => revokeProductImageUrls(), []);
  const w = useMemo(() => listProductRecords(v), [v, b]);
  const T = useMemo(() => listProductRecords(false), [b]);
  const E = useMemo(() => {
    const e = [
      ...listRecords("categories").map((e) => String(e.name || "")),
      ...T.map((e) => String(e.category || "")),
    ].filter(Boolean);
    return [...new Set(e)].sort((e, t) => e.localeCompare(t));
  }, [T, b]);
  const D = useMemo(() => {
    let e = [...w];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) => Object.values(e).join(" ").toLowerCase().includes(n));
    }
    if (a) {
      e = e.filter((e) => String(e.category || "") === a);
    }
    if (r) {
      e = e.filter((e) => getProductStockStatus(e) === r);
    }
    if (s) {
      e.sort((e, t) => {
        const n = getProductSortValue(e, s);
        const r = getProductSortValue(t, s);
        return (
          u *
          (typeof n == "number" && typeof r == "number"
            ? n - r
            : String(n || "").localeCompare(String(r || "")))
        );
      });
    }
    return e;
  }, [w, t, a, r, s, u]);
  const O = Math.max(1, Math.ceil(D.length / m));
  const k = Math.min(f, O);
  const A = D.slice((k - 1) * m, k * m);
  const j = D.length ? (k - 1) * m + 1 : 0;
  const M = Math.min(k * m, D.length);
  const N = () => x((e) => e + 1);
  const ee = () => _(new Set());
  const te = (e) => {
    n(e);
    p(1);
    ee();
  };
  const ne = (e) => {
    i(e);
    p(1);
    ee();
  };
  const re = (e) => {
    o(e);
    p(1);
    ee();
  };
  const ie = (e) => {
    y(e);
    p(1);
    ee();
  };
  const ae = (e) => {
    d((t) => (s === e && t === 1 ? -1 : 1));
    c(e);
  };
  const oe = (e, t) =>
    _((n) => {
      const r = new Set(n);
      if (t) {
        r.add(e);
      } else {
        r.delete(e);
      }
      return r;
    });
  const se = (e) =>
    _((t) => {
      const n = new Set(t);
      A.forEach((t) => {
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
      archiveRecords("products", e, t);
      ee();
      N();
      showToast(
        t
          ? "Records restored."
          : "Records archived. Switch on Deleted products to restore them.",
      );
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This change could not be completed.",
      );
    }
  };
  const le = () => {
    downloadFile(
      "veylix-products.csv",
      "﻿" +
        buildCsv(
          D.map((e) => ({
            name: e.name,
            sku: e.sku,
            category: e.category,
            brand: e.brand,
            status: getProductStockStatus(e),
            stock: Number(e.stock || 0),
            sales: Number(e.sold || 0),
            revenue: Number(e.sold || 0) * Number(e.price || 0),
            trend: Number(e.trend || 0),
            rating: Number(e.rating || 0),
            modified: formatProductUpdatedAt(e),
          })),
          [
            "name",
            "sku",
            "category",
            "brand",
            "status",
            "stock",
            "sales",
            "revenue",
            "trend",
            "rating",
            "modified",
          ],
          [
            "Product",
            "SKU",
            "Category",
            "Brand",
            "Status",
            "Inventory",
            "Sales",
            "Revenue",
            "Trend %",
            "Rating",
            "Modified",
          ],
        ),
    );
    showToast("Filtered products exported.");
  };
  const ue = (e) => {
    try {
      const t = duplicateProduct(e);
      N();
      showToast(`${String(t.name || "Product copy")} created as a draft.`);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Product could not be duplicated.",
      );
    }
  };
  const de = (e) => {
    const t = T.find((t) => t.id === e);
    if (t) {
      shareProductLink(t)
        .then((e) => {
          if (e) {
            showToast(e);
          }
        })
        .catch((e) =>
          showToast(
            e instanceof Error
              ? e.message
              : "Product link could not be shared.",
          ),
        );
    } else {
      showToast("This product is no longer available.");
    }
  };
  const fe = !!(t || r || a);
  return (
    <Fragment>
      <CommercePageHeading
        title={productsPageModule.title}
        actions={
          <button
            type="button"
            className="secondary-button"
            data-c-action="product-import"
            onClick={() =>
              C({
                mode: "import",
              })
            }
          >
            <Icon name="upload" />
            {" Import"}
          </button>
        }
        onExport={le}
        onCreate={() => navigate("/commerce/products/new")}
        createLabel="Add product"
      />
      <ProductSummaryGrid rows={T} />
      <section className="glass-card product-filter-card">
        <div className="c-toolbar product-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter by category</span>
            <select
              data-product-category
              value={a}
              onChange={(e) => re(e.currentTarget.value)}
            >
              <option value="">All categories</option>
              {E.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by product status</span>
            <select
              data-c-filter
              value={r}
              onChange={(e) => ne(e.currentTarget.value)}
            >
              <option value="">All statuses</option>
              {["Active", "Low stock", "Out of stock", "Draft"].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-archive-toggle product-archive-toggle">
            <input
              type="checkbox"
              data-c-archive
              checked={v}
              onChange={(e) => ie(e.currentTarget.checked)}
            />
            {" Deleted products"}
          </label>
          <label className="c-search product-search">
            <Icon name="search" />
            <input
              data-c-search
              type="search"
              placeholder="Search products..."
              value={t}
              onChange={(e) => te(e.currentTarget.value)}
              aria-label="Search products"
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource product-resource">
        <div className="product-list-heading">
          <div>
            <span>CATALOG</span>
            <h2>Product list</h2>
          </div>
          <small>
            {integerFormatter.format(D.length)}
            {" matching products"}
          </small>
        </div>
        <div id="resource-results">
          <BulkSelectionBar
            count={g.size}
            archived={v}
            onBulkArchive={() => ce([...g], v)}
            onClear={ee}
          />
          {D.length ? (
            <ProductsTable
              rows={A}
              selected={g}
              sort={s}
              direction={u}
              archived={v}
              onSort={ae}
              onToggleRow={oe}
              onToggleAll={se}
              onDetail={(e) =>
                C({
                  mode: "detail",
                  id: e,
                })
              }
              onEdit={(e) =>
                navigate(`/commerce/products/edit?id=${encodeURIComponent(e)}`)
              }
              onRestore={(e) => ce([e], true)}
              onDuplicate={ue}
              onShare={de}
              onActivity={(e) =>
                C({
                  mode: "activity",
                  id: e,
                })
              }
              onDelete={(e) =>
                C({
                  mode: "delete",
                  id: e,
                })
              }
            />
          ) : (
            <div
              className="table-scroll c-table-scroll product-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Product records"
            >
              <div className="c-empty">
                <Icon name="basket" />
                <h3>
                  {fe
                    ? "No products match these filters"
                    : v
                      ? "No deleted products"
                      : "Your product catalog is ready"}
                </h3>
                <p>
                  {fe
                    ? "Try another search or clear a filter."
                    : "Products you add will appear here."}
                </p>
              </div>
            </div>
          )}
          <footer className="c-pagination">
            <span>
              {j}–{M}
              {" of "}
              {D.length}
              {" products"}
            </span>
            <label>
              {"Per page "}
              <select
                data-c-page-size
                value={m}
                onChange={(e) => {
                  h(Number(e.currentTarget.value));
                  p(1);
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
                disabled={k === 1}
                onClick={() => p(Math.max(1, k - 1))}
              >
                Previous
              </button>
              <span>
                {k}
                {" / "}
                {O}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={k === O}
                onClick={() => p(Math.min(O, k + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {S?.mode === "import" ? (
        <ProductImportDialog onClose={() => C(null)} onImported={N} />
      ) : null}
      {S?.mode === "detail" ? (
        <ProductDetailDialog
          productId={S.id}
          onClose={() => C(null)}
          onEdit={(e) =>
            navigate(`/commerce/products/edit?id=${encodeURIComponent(e)}`)
          }
        />
      ) : null}
      {S?.mode === "activity" ? (
        <ProductActivityDialog productId={S.id} onClose={() => C(null)} />
      ) : null}
      {S?.mode === "delete" ? (
        <ProductDeleteDialog
          productId={S.id}
          onClose={() => C(null)}
          onDeleted={() => {
            ee();
            N();
          }}
        />
      ) : null}
    </Fragment>
  );
}
