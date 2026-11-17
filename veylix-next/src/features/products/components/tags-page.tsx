// @ts-nocheck
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar } from "@/components/ui/bulk-selection-bar";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { OverviewProductThumb } from "@/features/overview/components/overview-product-thumb";
import { TagFormDialog } from "@/features/products/components/collection-tag-dialogs";
import { getTaggedProducts } from "@/features/products/lib/merchandising-products";
import { getProductThumbnail } from "@/features/products/lib/product-helpers";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { hydrateProductImages } from "@/lib/media-storage";
import { buildHref, navigate } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const tagsMerchNavItems = [
  ["brands", "Brands"],
  ["collections", "Collections"],
  ["tags", "Tags"],
  ["reviews", "Reviews & ratings"],
];

const tagGroupOptions = ["Merchandising", "Search & discovery", "Operations"];

const tagStatusOptions = ["Active", "Hidden"];

function parseProductTags(e) {
  return String(e.tags || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

function TagStatusBadge({ value }) {
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

function TagSummaryCard({ icon, label, value, detail, tone = "green" }) {
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

export function TagsPage({ initialQuery = "" }) {
  const t = useRef(null);
  const [n, r] = useState(initialQuery);
  const [i, a] = useState("");
  const [o, s] = useState("");
  const [c, u] = useState(false);
  const [d, f] = useState(1);
  const [p, m] = useState(8);
  const [h, g] = useState(() => new Set());
  const [_, v] = useState(0);
  const [y, b] = useState(null);
  const x = useMemo(() => listRecords("tags"), [_]);
  const S = useMemo(() => listRecords("products"), [_]);
  const C = useMemo(
    () =>
      listRecords("tags", {
        archived: c,
      }),
    [c, _],
  );
  const w = useMemo(
    () =>
      C.filter(
        (e) =>
          !(
            (n &&
              !`${e.name || ""} ${e.description || ""} ${e.purpose || ""}`
                .toLowerCase()
                .includes(n.toLowerCase())) ||
            (i && e.status !== i) ||
            (o && e.purpose !== o)
          ),
      ),
    [C, n, i, o],
  );
  const T = Math.max(1, Math.ceil(w.length / p));
  const E = Math.min(d, T);
  const D = w.slice((E - 1) * p, E * p);
  const O = w.length ? (E - 1) * p + 1 : 0;
  const k = Math.min(E * p, w.length);
  const A = () => v((e) => e + 1);
  const j = () => g(new Set());
  const M = (e) => {
    try {
      e();
      A();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This change could not be completed.",
      );
    }
  };
  const N = () => {
    downloadFile(
      "veylix-tags.csv",
      "﻿" +
        buildCsv(
          w,
          ["name", "description", "purpose", "status"],
          ["Tag", "Description", "Purpose", "Status"],
        ),
    );
    showToast("Filtered tags exported.");
  };
  const ee = S.filter((e) => parseProductTags(e).length);
  const te = x
    .map((e) => ({
      tag: e,
      count: getTaggedProducts(e, S).length,
    }))
    .sort((e, t) => t.count - e.count);
  const ne = te.filter((e) => e.count === 0).length;
  const re = te.reduce((e, t) => e + t.count, 0);
  const ie = D.length > 0 && D.every((e) => h.has(e.id));
  useEffect(() => {
    if (t.current) {
      hydrateProductImages(t.current).catch(() => void 0);
    }
  }, [D, _]);
  return (
    <div ref={t}>
      <CommercePageHeading
        title="Tags"
        onExport={N}
        onCreate={() =>
          b({
            mode: "create",
          })
        }
        createLabel="Add tag"
      />
      <nav
        className="resource-shortcuts catalog-merch-nav"
        aria-label="Catalog merchandising pages"
      >
        {tagsMerchNavItems.map(([e, t]) =>
          e === "tags" ? (
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
        <TagSummaryCard
          icon="tag"
          label="Active tags"
          value={String(x.filter((e) => e.status === "Active").length)}
          detail={`${x.length} governed labels`}
        />
        <TagSummaryCard
          icon="package"
          label="Tagged products"
          value={String(ee.length)}
          detail={`${S.length} products total`}
          tone="blue"
        />
        <TagSummaryCard
          icon="sparkle"
          label="Merchandising tags"
          value={String(x.filter((e) => e.purpose === "Merchandising").length)}
          detail="Campaign-ready labels"
          tone="green"
        />
        <TagSummaryCard
          icon="info"
          label="Unused tags"
          value={String(ne)}
          detail={ne ? "Worth cleaning up" : "Taxonomy is tidy"}
          tone="amber"
        />
      </section>
      <section className="glass-card catalog-merch-insight">
        <div className="catalog-ops-heading">
          <div>
            <span>TAG GOVERNANCE</span>
            <h2>Keep discovery labels intentional</h2>
            <p>
              Track usage so merchandising tags stay useful instead of becoming
              an unmaintained list.
            </p>
          </div>
          <small>
            {re}
            {" product-tag assignments"}
          </small>
        </div>
        <div className="tag-health-grid">
          {te.slice(0, 6).map(({ tag, count }) => (
            <div key={tag.id}>
              <span>
                <Icon name="tag" />
              </span>
              <div>
                <strong>{String(tag.name || "")}</strong>
                <small>{String(tag.purpose || "")}</small>
              </div>
              <b>{count}</b>
            </div>
          ))}
        </div>
      </section>
      <section className="glass-card product-filter-card catalog-ops-filter">
        <div className="c-toolbar product-toolbar">
          <label className="c-filter">
            <select
              data-tag-purpose
              value={o}
              onChange={(e) => {
                s(e.currentTarget.value);
                f(1);
                j();
              }}
            >
              <option value="">All purposes</option>
              {tagGroupOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              data-c-filter
              value={i}
              onChange={(e) => {
                a(e.currentTarget.value);
                f(1);
                j();
              }}
            >
              <option value="">All statuses</option>
              {tagStatusOptions.map((e) => (
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
              checked={c}
              onChange={(e) => {
                u(e.currentTarget.checked);
                f(1);
                j();
              }}
            />
            {" Archived tags"}
          </label>
          <label className="c-search product-search">
            <Icon name="search" />
            <input
              data-c-search
              type="search"
              placeholder="Search tags or descriptions..."
              value={n}
              onChange={(e) => {
                r(e.currentTarget.value);
                f(1);
                j();
              }}
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource catalog-ops-resource">
        <div className="product-list-heading catalog-ops-list-heading">
          <div>
            <span>CATALOG TAXONOMY</span>
            <h2>Tag library</h2>
            <p>
              Use a controlled vocabulary for campaigns, search and internal
              catalog workflows.
            </p>
          </div>
          <small>
            {w.length}
            {" matching tags"}
          </small>
        </div>
        <div id="resource-results">
          <BulkSelectionBar
            count={h.size}
            archived={c}
            onBulkArchive={() =>
              M(() => {
                archiveRecords("tags", [...h], c);
                j();
                showToast(c ? "Records restored." : "Records archived.");
              })
            }
            onClear={j}
          />
          <div className="table-scroll c-table-scroll catalog-ops-table-scroll">
            <table className="c-table catalog-ops-table catalog-merch-table tag-table">
              <thead>
                <tr>
                  <th className="c-check">
                    <input
                      type="checkbox"
                      checked={ie}
                      onChange={(e) => {
                        const t = e.currentTarget.checked;
                        g((e) => {
                          const n = new Set(e);
                          D.forEach((e) => (t ? n.add(e.id) : n.delete(e.id)));
                          return n;
                        });
                      }}
                      aria-label="Select all visible tags"
                    />
                  </th>
                  <th>Tag</th>
                  <th>Purpose</th>
                  <th>Products</th>
                  <th>Examples</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {D.map((e) => {
                  const t = getTaggedProducts(e, S);
                  const n = c
                    ? [
                        {
                          label: "Restore tag",
                          icon: "check-circle",
                          onClick: () =>
                            M(() => {
                              archiveRecords("tags", [e.id], true);
                              showToast("Records restored.");
                            }),
                        },
                      ]
                    : [
                        {
                          label: "Edit tag",
                          icon: "pencil",
                          onClick: () =>
                            b({
                              mode: "edit",
                              id: e.id,
                            }),
                        },
                        {
                          label: "Find tagged products",
                          icon: "package",
                          onClick: () =>
                            navigate(
                              `/commerce/products?q=${encodeURIComponent(String(e.name || ""))}`,
                            ),
                        },
                        {
                          label:
                            e.status === "Active" ? "Hide tag" : "Activate tag",
                          icon: "info",
                          onClick: () =>
                            M(() => {
                              saveRecord(
                                "tags",
                                {
                                  status:
                                    e.status === "Active" ? "Hidden" : "Active",
                                },
                                e.id,
                              );
                              showToast("Tag status updated.");
                            }),
                        },
                        {
                          label: "Archive tag",
                          icon: "trash",
                          danger: true,
                          separatorBefore: true,
                          onClick: () =>
                            M(() => {
                              archiveRecords("tags", [e.id]);
                              showToast("Records archived.");
                            }),
                        },
                      ];
                  return (
                    <tr key={e.id}>
                      <td className="c-check">
                        <input
                          type="checkbox"
                          checked={h.has(e.id)}
                          onChange={(t) =>
                            g((n) => {
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
                        <div className="catalog-tag-name">
                          <span>
                            <Icon name="tag" />
                          </span>
                          <div>
                            <strong>{String(e.name || "")}</strong>
                            <small>
                              {String(e.description || "No description")}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="catalog-purpose-pill">
                          {String(e.purpose || "")}
                        </span>
                      </td>
                      <td>
                        <strong>{t.length}</strong>
                        <small className="catalog-cell-note">
                          product{t.length === 1 ? "" : "s"}
                        </small>
                      </td>
                      <td>
                        <div className="tag-product-preview">
                          {t.slice(0, 3).map((e) => (
                            <span key={e.id} title={String(e.name || "")}>
                              <OverviewProductThumb
                                product={getProductThumbnail(e)}
                              />
                            </span>
                          ))}
                          {t.length > 3 ? <em>+{t.length - 3}</em> : null}
                        </div>
                      </td>
                      <td>
                        <TagStatusBadge value={e.status} />
                      </td>
                      <td className="product-actions-cell">
                        <RowActionsMenu
                          label={String(e.name || "tag")}
                          actions={n}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {w.length ? null : (
              <div className="c-empty">
                <Icon name="basket" />
                <h3>No tags match</h3>
                <p>Try another purpose, status or search term.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {O}–{k}
              {" of "}
              {w.length}
              {" tags"}
            </span>
            <label>
              {"Per page "}
              <select
                data-c-page-size
                value={p}
                onChange={(e) => {
                  m(Number(e.currentTarget.value));
                  f(1);
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
                disabled={E === 1}
                onClick={() => f(Math.max(1, E - 1))}
              >
                Previous
              </button>
              <span>
                {E}
                {" / "}
                {T}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={E === T}
                onClick={() => f(Math.min(T, E + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {y?.mode === "create" ? (
        <TagFormDialog onClose={() => b(null)} onSaved={A} />
      ) : null}
      {y?.mode === "edit" ? (
        <TagFormDialog recordId={y.id} onClose={() => b(null)} onSaved={A} />
      ) : null}
    </div>
  );
}
