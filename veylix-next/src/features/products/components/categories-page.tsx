// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar } from "@/components/ui/bulk-selection-bar";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import {
  CategoryMediaTile,
  CategoryShareBar,
  CategoryTrendIndicator,
  CategoryVisibilityBadge,
} from "@/features/products/components/category-badges";
import { CategoryEditorDialog } from "@/features/products/components/category-editor-dialog";
import { getCategoryMetrics } from "@/features/products/lib/category-metrics";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { compactUsdFormatter, integerFormatter } from "@/lib/intl-formatters";
import { navigate } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { saveCategory } from "@/lib/store/products";
import { archiveRecords } from "@/lib/store/records";

const categoryDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function CategoriesPage() {
  const [e, t] = useState("");
  const [n, r] = useState("");
  const [i, a] = useState("");
  const [o, s] = useState(false);
  const [c, u] = useState(() => new Set());
  const [d, f] = useState(0);
  const [p, m] = useState(null);
  const h = useMemo(() => listRecords("categories"), [d]);
  const g = useMemo(
    () =>
      listRecords("categories", {
        archived: true,
      }),
    [d],
  );
  const _ = useMemo(() => listRecords("products"), [d]);
  const v = h.filter((e) => !e.parent || e.parent === "None");
  const y = v.some((e) => e.name === n) ? n : String(v[0]?.name || "");
  const b = () => f((e) => e + 1);
  const x = () => u(new Set());
  const S = (e) => {
    try {
      e();
      b();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This change could not be completed.",
      );
    }
  };
  const C = (e, t) =>
    u((n) => {
      const r = new Set(n);
      if (t) {
        r.add(e);
      } else {
        r.delete(e);
      }
      return r;
    });
  const w = h.filter(
    (t) =>
      t.parent === y &&
      (!e || t.status === e) &&
      (!i ||
        [t.name, t.description, t.slug, t.status]
          .join(" ")
          .toLowerCase()
          .includes(i.toLowerCase())),
  );
  const T = w.length > 0 && w.every((e) => c.has(e.id));
  const E = (e, t = false) =>
    t
      ? [
          {
            label: "Restore",
            icon: "check-circle",
            onClick: () =>
              S(() => {
                archiveRecords("categories", [e.id], true);
                showToast("Category restored.");
              }),
          },
        ]
      : [
          {
            label: "Edit",
            icon: "pencil",
            onClick: () =>
              m({
                mode: "edit",
                id: e.id,
              }),
          },
          {
            label: "View products",
            icon: "package",
            onClick: () =>
              navigate(
                `/commerce/products?q=${encodeURIComponent(String(e.parent && e.parent !== "None" ? e.parent : e.name || ""))}`,
              ),
          },
          {
            label: e.featured ? "Remove featured" : "Mark featured",
            icon: "star",
            onClick: () =>
              S(() => {
                saveCategory(
                  {
                    featured: !e.featured,
                  },
                  e.id,
                );
                showToast(
                  e.featured
                    ? "Removed from featured categories."
                    : "Category marked as featured.",
                );
              }),
          },
          {
            label: e.status === "Hidden" ? "Show category" : "Hide category",
            icon: e.status === "Hidden" ? "eye" : "pause",
            onClick: () =>
              S(() => {
                const t = e.status === "Hidden" ? "Visible" : "Hidden";
                saveCategory(
                  {
                    status: t,
                  },
                  e.id,
                );
                showToast(
                  t === "Visible"
                    ? "Category is visible."
                    : "Category hidden from storefront browsing.",
                );
              }),
          },
          {
            label: "Archive",
            icon: "trash",
            danger: true,
            separatorBefore: true,
            onClick: () =>
              S(() => {
                if (!e.parent || e.parent === "None") {
                  if (
                    listRecords("categories").some((t) => t.parent === e.name)
                  )
                    throw Error(
                      "Archive or move this category’s sub-categories first.",
                    );
                  if (
                    listRecords("products").some((t) => t.category === e.name)
                  )
                    throw Error(
                      "This category still contains products. Hide it instead, or move the products first.",
                    );
                }
                archiveRecords("categories", [e.id]);
                u((t) => {
                  const n = new Set(t);
                  n.delete(e.id);
                  return n;
                });
                showToast("Category archived.");
              }),
          },
        ];
  const D = () => {
    downloadFile(
      "veylix-categories.csv",
      "﻿" +
        buildCsv(
          h.map((e) => ({
            ...e,
            featured: e.featured ? "Yes" : "No",
          })),
          [
            "name",
            "slug",
            "parent",
            "description",
            "status",
            "featured",
            "addedAt",
          ],
          [
            "Category",
            "Slug",
            "Parent",
            "Description",
            "Status",
            "Featured",
            "Date added",
          ],
        ),
    );
    showToast("Categories exported.");
  };
  const O = h.filter((e) => !e.parent || e.parent === "None");
  const k = h.filter((e) => e.parent && e.parent !== "None");
  const A = h.filter((e) => e.status !== "Hidden").length;
  const j = h.filter((e) => e.featured).length;
  const M = [
    [
      "tag",
      "Total categories",
      integerFormatter.format(h.length),
      "Catalog taxonomy",
    ],
    [
      "squares-four",
      "Top-level",
      integerFormatter.format(O.length),
      "Primary browsing groups",
    ],
    [
      "list",
      "Sub-categories",
      integerFormatter.format(k.length),
      "Nested discovery paths",
    ],
    ["star", "Featured", integerFormatter.format(j), `${A} visible now`],
  ];
  return (
    <Fragment>
      <CommercePageHeading
        title="Categories"
        onExport={D}
        onCreate={() =>
          m({
            mode: "create",
            presetParent: "None",
          })
        }
        createLabel="Add category"
      />
      <section
        className="category-overview-grid"
        aria-label="Category overview"
      >
        {M.map(([e, t, n, r]) => (
          <div key={String(t)} className="category-overview-card">
            <span>
              <Icon name={String(e)} />
            </span>
            <div>
              <small>{t}</small>
              <strong>{n}</strong>
              <em>{r}</em>
            </div>
          </div>
        ))}
      </section>
      <div id="resource-results" className="category-workspace">
        {o ? (
          <section className="glass-card category-sub-card">
            <div className="category-section-heading">
              <div>
                <span>ARCHIVE</span>
                <h2>Archived categories</h2>
                <p>
                  Restore categories when you need them back in the taxonomy.
                </p>
              </div>
            </div>
            <div className="category-table-scroll">
              <table className="subcategory-table archived-category-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Slug</th>
                    <th>Status</th>
                    <th>Date added</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.length ? (
                    g.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <strong>{String(e.name || "")}</strong>
                          <small className="category-archive-path">
                            {e.parent && e.parent !== "None"
                              ? String(e.parent)
                              : "Top-level"}
                          </small>
                        </td>
                        <td>{e.slug ? `/${String(e.slug)}` : "—"}</td>
                        <td>
                          <CategoryVisibilityBadge row={e} />
                        </td>
                        <td>
                          {e.addedAt
                            ? categoryDateFormatter.format(
                                new Date(`${String(e.addedAt)}T00:00:00`),
                              )
                            : "—"}
                        </td>
                        <td>
                          <RowActionsMenu
                            label={String(e.name || "category")}
                            triggerClassName="category-row-menu"
                            estimatedHeight={90}
                            actions={E(e, true)}
                          />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>
                        <div className="c-empty">
                          <Icon name="basket" />
                          <h3>No archived categories</h3>
                          <p>Categories you archive will appear here.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <Fragment>
            <section className="glass-card category-top-card">
              <div className="category-section-heading">
                <div>
                  <span>TAXONOMY</span>
                  <h2>All categories</h2>
                  <p>
                    Top-level groups give shoppers a clear starting point.
                    Select one to manage its sub-categories.
                  </p>
                </div>
                <small>
                  {O.length}
                  {" top-level · "}
                  {k.length}
                  {" sub-categories"}
                </small>
              </div>
              <div className="category-table-scroll">
                <table className="category-top-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Products</th>
                      <th>Revenue</th>
                      <th>Trend</th>
                      <th>Share</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {O.filter((t) => !e || t.status === e).length ? (
                      O.filter((t) => !e || t.status === e).map((e) => {
                        const t = getCategoryMetrics(e, _, h);
                        const n = h.filter(
                          (t) => t.parent === e.name && !t._archived,
                        ).length;
                        const i = y === e.name;
                        return (
                          <tr key={e.id} className={i ? "is-selected" : ""}>
                            <td>
                              <button
                                type="button"
                                className="category-name-button"
                                onClick={() => {
                                  r(String(e.name || ""));
                                  a("");
                                  x();
                                }}
                              >
                                <CategoryMediaTile row={e} />
                                <span>
                                  <strong>{String(e.name || "")}</strong>
                                  <small>
                                    {n}
                                    {" sub-"}
                                    {n === 1 ? "category" : "categories"}
                                    {" · "}
                                    <CategoryVisibilityBadge row={e} />
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td>{integerFormatter.format(t.products)}</td>
                            <td>
                              <strong>
                                {compactUsdFormatter.format(t.revenue)}
                              </strong>
                            </td>
                            <td>
                              <CategoryTrendIndicator value={t.trend} />
                            </td>
                            <td>
                              <CategoryShareBar value={t.share} />
                            </td>
                            <td className="category-top-actions">
                              <button
                                type="button"
                                className="category-select-arrow"
                                aria-label={`View ${String(e.name || "")} sub-categories`}
                                onClick={() => {
                                  r(String(e.name || ""));
                                  a("");
                                  x();
                                }}
                              >
                                <Icon name="arrow-right" />
                              </button>
                              <RowActionsMenu
                                label={String(e.name || "category")}
                                triggerClassName="category-row-menu"
                                actions={E(e)}
                              />
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={6}>
                          <div className="c-empty">
                            <Icon name="basket" />
                            <h3>No top-level categories match this filter</h3>
                            <p>Choose another status or add a category.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="glass-card category-filter-card">
              <div className="category-filter-toolbar">
                <label className="c-filter">
                  <span className="sr-only">Filter by status</span>
                  <select
                    data-c-filter
                    value={e}
                    onChange={(e) => {
                      t(e.currentTarget.value);
                      x();
                    }}
                  >
                    <option value="">All statuses</option>
                    <option value="Visible">Visible</option>
                    <option value="Hidden">Hidden</option>
                  </select>
                </label>
                <label className="c-filter">
                  <span className="sr-only">Choose parent category</span>
                  <select
                    data-category-parent
                    value={y}
                    onChange={(e) => {
                      r(e.currentTarget.value);
                      a("");
                      x();
                    }}
                  >
                    {O.map((e) => (
                      <option key={e.id} value={String(e.name || "")}>
                        {"Parent: "}
                        {String(e.name || "")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="c-search category-search">
                  <Icon name="search" />
                  <input
                    type="search"
                    data-category-page-search
                    value={i}
                    placeholder="Search sub-categories..."
                    aria-label="Search sub-categories"
                    onChange={(e) => {
                      a(e.currentTarget.value);
                      x();
                    }}
                  />
                </label>
                <label className="c-archive-toggle category-archive-toggle">
                  <input
                    type="checkbox"
                    data-c-archive
                    checked={o}
                    onChange={(e) => {
                      s(e.currentTarget.checked);
                      x();
                    }}
                  />
                  {" Archived"}
                </label>
              </div>
            </section>
            <section className="glass-card category-sub-card">
              <div className="category-section-heading category-sub-heading">
                <div>
                  <span>SUB-CATEGORIES</span>
                  <h2>{y || "Choose a category"}</h2>
                  <p>
                    {y
                      ? `Manage the nested browsing groups inside ${y}.`
                      : "Add a top-level category first."}
                  </p>
                </div>
                {y ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      m({
                        mode: "create",
                        presetParent: y,
                      })
                    }
                  >
                    <Icon name="plus" />
                    {" Add sub-category"}
                  </button>
                ) : null}
              </div>
              <div id="category-sub-results">
                {y ? (
                  <Fragment>
                    <BulkSelectionBar
                      count={c.size}
                      archived={false}
                      onBulkArchive={() =>
                        S(() => {
                          archiveRecords("categories", [...c]);
                          x();
                          showToast("Categories archived.");
                        })
                      }
                      onClear={x}
                    />
                    <div className="category-table-scroll">
                      <table className="subcategory-table">
                        <thead>
                          <tr>
                            <th className="c-check">
                              <input
                                type="checkbox"
                                checked={T}
                                onChange={(e) => {
                                  const t = e.currentTarget.checked;
                                  u((e) => {
                                    const n = new Set(e);
                                    w.forEach((e) =>
                                      t ? n.add(e.id) : n.delete(e.id),
                                    );
                                    return n;
                                  });
                                }}
                                aria-label="Select all visible sub-categories"
                              />
                            </th>
                            <th>Category</th>
                            <th>Parent</th>
                            <th>Products</th>
                            <th>Revenue</th>
                            <th>Featured</th>
                            <th>Status</th>
                            <th>Date added</th>
                            <th>
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {w.length ? (
                            w.map((e) => {
                              const t = getCategoryMetrics(e, _, h);
                              return (
                                <tr key={e.id}>
                                  <td className="c-check">
                                    <input
                                      type="checkbox"
                                      checked={c.has(e.id)}
                                      onChange={(t) =>
                                        C(e.id, t.currentTarget.checked)
                                      }
                                      aria-label={`Select ${String(e.name || "")}`}
                                    />
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="subcategory-name"
                                      onClick={() =>
                                        m({
                                          mode: "edit",
                                          id: e.id,
                                        })
                                      }
                                    >
                                      <span>
                                        <Icon name="arrow-right" />
                                      </span>
                                      <CategoryMediaTile row={e} compact />
                                      <strong>{String(e.name || "")}</strong>
                                    </button>
                                  </td>
                                  <td>{y}</td>
                                  <td>{integerFormatter.format(t.products)}</td>
                                  <td>
                                    <strong>
                                      {compactUsdFormatter.format(t.revenue)}
                                    </strong>
                                  </td>
                                  <td>
                                    <span
                                      className={`category-featured ${e.featured ? "yes" : ""}`}
                                    >
                                      {e.featured ? <Icon name="check" /> : "—"}
                                    </span>
                                  </td>
                                  <td>
                                    <CategoryVisibilityBadge row={e} />
                                  </td>
                                  <td>
                                    <span className="product-date">
                                      {e.addedAt
                                        ? categoryDateFormatter.format(
                                            new Date(
                                              `${String(e.addedAt)}T00:00:00`,
                                            ),
                                          )
                                        : "—"}
                                    </span>
                                  </td>
                                  <td>
                                    <RowActionsMenu
                                      label={String(e.name || "category")}
                                      triggerClassName="category-row-menu"
                                      actions={E(e)}
                                    />
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={9}>
                                <div className="c-empty">
                                  <Icon name="basket" />
                                  <h3>
                                    {i
                                      ? "No sub-categories match your search"
                                      : "No sub-categories yet"}
                                  </h3>
                                  <p>
                                    {i
                                      ? "Try another search."
                                      : `Add a sub-category under ${y}.`}
                                  </p>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Fragment>
                ) : (
                  <div className="c-empty">
                    <Icon name="basket" />
                    <h3>No top-level category yet</h3>
                    <p>Create a category to start organizing your catalog.</p>
                  </div>
                )}
              </div>
            </section>
          </Fragment>
        )}
      </div>
      {p ? (
        <CategoryEditorDialog
          recordId={p.mode === "edit" ? p.id : void 0}
          presetParent={p.presetParent}
          onClose={() => m(null)}
          onSaved={(e, t) => {
            if (!((e.parent && e.parent !== "None") || (n && t?.name !== n))) {
              r(String(e.name || ""));
            }
            b();
          }}
        />
      ) : null}
    </Fragment>
  );
}
