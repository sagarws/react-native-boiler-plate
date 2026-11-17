// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar } from "@/components/ui/bulk-selection-bar";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import {
  BrandDetailDialog,
  BrandFormDialog,
} from "@/features/products/components/brand-dialogs";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { integerFormatter } from "@/lib/intl-formatters";
import { buildHref, navigate } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const brandsMerchNavItems = [
  ["brands", "Brands"],
  ["collections", "Collections"],
  ["tags", "Tags"],
  ["reviews", "Reviews & ratings"],
];

function getBrandProductRevenue(e) {
  return Number(e.sold || 0) * Number(e.price || 0);
}

function formatStarRating(e) {
  const t = Math.max(0, Math.min(5, e || 0));
  return `${"★".repeat(t)}${"☆".repeat(Math.max(0, 5 - t))}`;
}

function BrandStatusBadge({ value }) {
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

function BrandSummaryCard({ icon, label, value, detail, tone = "green" }) {
  return (
    <div className={`product-summary-card ${tone}`}>
      <div className="product-summary-top">
        <span className="product-summary-icon">
          <Icon name={icon} />
        </span>
        <small>{detail}</small>
      </div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function BrandsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState(false);
  const [u, d] = useState(1);
  const [f, p] = useState(8);
  const [m, h] = useState(() => new Set());
  const [g, _] = useState(0);
  const [v, y] = useState(null);
  const b = useMemo(() => listRecords("brands"), [g]);
  const x = useMemo(() => listRecords("products"), [g]);
  const S = useMemo(
    () =>
      listRecords("brands", {
        archived: s,
      }),
    [s, g],
  );
  const C = useMemo(
    () =>
      S.filter(
        (e) =>
          !(
            (t &&
              !`${e.name || ""} ${e.country || ""} ${e.tier || ""} ${e.contact || ""}`
                .toLowerCase()
                .includes(t.toLowerCase())) ||
            (r && e.status !== r) ||
            (a && e.tier !== a)
          ),
      ),
    [S, t, r, a],
  );
  const w = Math.max(1, Math.ceil(C.length / f));
  const T = Math.min(u, w);
  const E = C.slice((T - 1) * f, T * f);
  const D = C.length ? (T - 1) * f + 1 : 0;
  const O = Math.min(T * f, C.length);
  const k = () => _((e) => e + 1);
  const A = () => h(new Set());
  const j = (e) => x.filter((t) => t.brand === e.name);
  const M = (e) => {
    try {
      e();
      k();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This change could not be completed.",
      );
    }
  };
  const N = () => {
    downloadFile(
      "veylix-brands.csv",
      "﻿" +
        buildCsv(
          C,
          [
            "name",
            "website",
            "contact",
            "country",
            "tier",
            "featured",
            "status",
            "notes",
          ],
          [
            "Brand",
            "Website",
            "Contact email",
            "Country",
            "Brand tier",
            "Storefront placement",
            "Status",
            "Notes",
          ],
        ),
    );
    showToast("Filtered brands exported.");
  };
  const ee = b.filter((e) => e.status === "Active");
  const te = x.reduce((e, t) => e + getBrandProductRevenue(t), 0);
  const ne = b.filter((e) => e.featured === "Featured").length;
  const re = b
    .map((e) => {
      const t = j(e);
      return {
        brand: e,
        rows: t,
        revenue: t.reduce((e, t) => e + getBrandProductRevenue(t), 0),
        units: t.reduce((e, t) => e + Number(t.sold || 0), 0),
      };
    })
    .sort((e, t) => t.revenue - e.revenue);
  const ie = E.length > 0 && E.every((e) => m.has(e.id));
  return (
    <Fragment>
      <CommercePageHeading
        title="Brands"
        onExport={N}
        onCreate={() =>
          y({
            mode: "create",
          })
        }
        createLabel="Add brand"
      />
      <nav
        className="resource-shortcuts catalog-merch-nav"
        aria-label="Catalog merchandising pages"
      >
        {brandsMerchNavItems.map(([e, t]) =>
          e === "brands" ? (
            <span key={e} className="secondary-button is-active">
              {t}
            </span>
          ) : (
            <Link
              key={e}
              className="secondary-button"
              href={buildHref(`/commerce/${e}`)}
            >
              {t}
            </Link>
          ),
        )}
      </nav>
      <section className="product-summary-grid catalog-merch-summary">
        <BrandSummaryCard
          icon="tag"
          label="Active brands"
          value={integerFormatter.format(ee.length)}
          detail={`${b.length} brand profiles`}
        />
        <BrandSummaryCard
          icon="package"
          label="Branded products"
          value={integerFormatter.format(x.filter((e) => e.brand).length)}
          detail="Catalog coverage"
          tone="blue"
        />
        <BrandSummaryCard
          icon="chart-line-up"
          label="Catalog revenue"
          value={formatCurrency(te, 0)}
          detail="Gross product revenue"
          tone="green"
        />
        <BrandSummaryCard
          icon="star"
          label="Featured brands"
          value={integerFormatter.format(ne)}
          detail="Storefront placement"
          tone="amber"
        />
      </section>
      <section className="glass-card catalog-merch-insight">
        <div className="catalog-ops-heading">
          <div>
            <span>BRAND PERFORMANCE</span>
            <h2>Merchandise with commercial context</h2>
            <p>
              See which labels are carrying revenue, assortment depth and
              storefront visibility before adjusting placement.
            </p>
          </div>
          <small>
            {re.length}
            {" labels tracked"}
          </small>
        </div>
        <div className="brand-performance-grid">
          {re.map(({ brand, rows, revenue, units }) => (
            <div key={brand.id}>
              <span className="brand-avatar">
                {String(brand.name || "")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <div>
                <strong>{String(brand.name || "")}</strong>
                <small>
                  {rows.length}
                  {" products · "}
                  {integerFormatter.format(units)}
                  {" units sold"}
                </small>
              </div>
              <b>{formatCurrency(revenue, 0)}</b>
            </div>
          ))}
        </div>
      </section>
      <section className="glass-card product-filter-card catalog-ops-filter">
        <div className="c-toolbar product-toolbar">
          <label className="c-filter">
            <select
              data-brand-tier
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                d(1);
                A();
              }}
            >
              <option value="">All brand tiers</option>
              {["Strategic", "Core", "Emerging"].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              data-c-filter
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                d(1);
                A();
              }}
            >
              <option value="">All statuses</option>
              {["Active", "Hidden"].map((e) => (
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
              onChange={(e) => {
                c(e.currentTarget.checked);
                d(1);
                A();
              }}
            />
            {" Archived brands"}
          </label>
          <label className="c-search product-search">
            <Icon name="search" />
            <input
              data-c-search
              type="search"
              placeholder="Search brands, country or contact..."
              value={t}
              onChange={(e) => {
                n(e.currentTarget.value);
                d(1);
                A();
              }}
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource catalog-ops-resource">
        <div className="product-list-heading catalog-ops-list-heading">
          <div>
            <span>BRAND PORTFOLIO</span>
            <h2>Catalog labels</h2>
            <p>
              Manage brand visibility with product depth and performance in the
              same view.
            </p>
          </div>
          <small>
            {C.length}
            {" matching brands"}
          </small>
        </div>
        <div id="resource-results">
          <BulkSelectionBar
            count={m.size}
            archived={s}
            onBulkArchive={() =>
              M(() => {
                archiveRecords("brands", [...m], s);
                A();
                showToast(s ? "Records restored." : "Records archived.");
              })
            }
            onClear={A}
          />
          <div className="table-scroll c-table-scroll catalog-ops-table-scroll">
            <table className="c-table catalog-ops-table catalog-merch-table">
              <thead>
                <tr>
                  <th className="c-check">
                    <input
                      type="checkbox"
                      checked={ie}
                      onChange={(e) => {
                        const t = e.currentTarget.checked;
                        h((e) => {
                          const n = new Set(e);
                          E.forEach((e) => (t ? n.add(e.id) : n.delete(e.id)));
                          return n;
                        });
                      }}
                      aria-label="Select all visible brands"
                    />
                  </th>
                  <th>Brand</th>
                  <th>Products</th>
                  <th>Revenue</th>
                  <th>Avg rating</th>
                  <th>Inventory</th>
                  <th>Placement</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {E.map((e) => {
                  const t = j(e);
                  const n = t.reduce((e, t) => e + getBrandProductRevenue(t), 0);
                  const r = t.length
                    ? t.reduce((e, t) => e + Number(t.rating || 0), 0) /
                      t.length
                    : 0;
                  const i = t.reduce((e, t) => e + Number(t.stock || 0), 0);
                  const a = s
                    ? [
                        {
                          label: "Restore brand",
                          icon: "check-circle",
                          onClick: () =>
                            M(() => {
                              archiveRecords("brands", [e.id], true);
                              showToast("Records restored.");
                            }),
                        },
                      ]
                    : [
                        {
                          label: "Brand overview",
                          icon: "eye",
                          onClick: () =>
                            y({
                              mode: "detail",
                              id: e.id,
                            }),
                        },
                        {
                          label: "Edit brand",
                          icon: "pencil",
                          onClick: () =>
                            y({
                              mode: "edit",
                              id: e.id,
                            }),
                        },
                        {
                          label: "View products",
                          icon: "package",
                          onClick: () =>
                            navigate(
                              `/commerce/products?q=${encodeURIComponent(String(e.name || ""))}`,
                            ),
                        },
                        {
                          label:
                            e.featured === "Featured"
                              ? "Remove featured"
                              : "Feature brand",
                          icon: "star",
                          onClick: () =>
                            M(() => {
                              saveRecord(
                                "brands",
                                {
                                  featured:
                                    e.featured === "Featured"
                                      ? "Standard"
                                      : "Featured",
                                },
                                e.id,
                              );
                              showToast("Brand placement updated.");
                            }),
                        },
                        {
                          label:
                            e.status === "Active"
                              ? "Hide brand"
                              : "Activate brand",
                          icon: "info",
                          onClick: () =>
                            M(() => {
                              saveRecord(
                                "brands",
                                {
                                  status:
                                    e.status === "Active" ? "Hidden" : "Active",
                                },
                                e.id,
                              );
                              showToast("Brand visibility updated.");
                            }),
                        },
                        {
                          label: "Archive brand",
                          icon: "trash",
                          danger: true,
                          separatorBefore: true,
                          onClick: () =>
                            M(() => {
                              archiveRecords("brands", [e.id]);
                              showToast("Records archived.");
                            }),
                        },
                      ];
                  return (
                    <tr key={e.id}>
                      <td className="c-check">
                        <input
                          type="checkbox"
                          checked={m.has(e.id)}
                          onChange={(t) =>
                            h((n) => {
                              const r = new Set(n);
                              if (t.currentTarget.checked) {
                                r.add(e.id);
                              } else {
                                r.delete(e.id);
                              }
                              return r;
                            })
                          }
                          aria-label={`Select ${String(e.name || "")}`}
                        />
                      </td>
                      <td>
                        <button
                          className="catalog-brand-cell"
                          type="button"
                          onClick={() =>
                            y({
                              mode: "detail",
                              id: e.id,
                            })
                          }
                        >
                          <span className="brand-avatar">
                            {String(e.name || "")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <span>
                            <strong>{String(e.name || "")}</strong>
                            <small>
                              {String(e.country || "—")}
                              {" · "}
                              {String(e.tier || "Core")}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <strong>{t.length}</strong>
                        <small className="catalog-cell-note">
                          active catalog items
                        </small>
                      </td>
                      <td>
                        <strong>{formatCurrency(n, 0)}</strong>
                        <small className="catalog-cell-note">
                          gross revenue
                        </small>
                      </td>
                      <td>
                        <span className="review-stars">
                          {formatStarRating(Math.round(r))}
                        </span>
                        <small className="catalog-cell-note">
                          {r ? r.toFixed(1) : "—"}
                        </small>
                      </td>
                      <td>
                        <strong>{integerFormatter.format(i)}</strong>
                        <small className="catalog-cell-note">
                          units available
                        </small>
                      </td>
                      <td>
                        <BrandStatusBadge value={e.featured || "Standard"} />
                      </td>
                      <td>
                        <BrandStatusBadge value={e.status} />
                      </td>
                      <td className="product-actions-cell">
                        <RowActionsMenu
                          label={String(e.name || "brand")}
                          actions={a}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {C.length ? null : (
              <div className="c-empty">
                <Icon name="basket" />
                <h3>No brands match</h3>
                <p>Try another status, tier or search term.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {D}–{O}
              {" of "}
              {C.length}
              {" brands"}
            </span>
            <label>
              {"Per page "}
              <select
                data-c-page-size
                value={f}
                onChange={(e) => {
                  p(Number(e.currentTarget.value));
                  d(1);
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
                disabled={T === 1}
                onClick={() => d(Math.max(1, T - 1))}
              >
                Previous
              </button>
              <span>
                {T}
                {" / "}
                {w}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={T === w}
                onClick={() => d(Math.min(w, T + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {v?.mode === "create" ? (
        <BrandFormDialog onClose={() => y(null)} onSaved={k} />
      ) : null}
      {v?.mode === "edit" ? (
        <BrandFormDialog recordId={v.id} onClose={() => y(null)} onSaved={k} />
      ) : null}
      {v?.mode === "detail" ? (
        <BrandDetailDialog recordId={v.id} onClose={() => y(null)} />
      ) : null}
    </Fragment>
  );
}
