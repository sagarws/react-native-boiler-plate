// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar } from "@/components/ui/bulk-selection-bar";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import {
  CollectionDetailDialog,
  CollectionFormDialog,
} from "@/features/products/components/collection-tag-dialogs";
import { getCollectionProducts } from "@/features/products/lib/merchandising-products";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { buildHref } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const collectionsMerchNavItems = [
  ["brands", "Brands"],
  ["collections", "Collections"],
  ["tags", "Tags"],
  ["reviews", "Reviews & ratings"],
];

const collectionDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const collectionRuleOptions = [
  "Manual selection",
  "Category",
  "Price below",
  "Tag",
];

const collectionStatusOptions = ["Published", "Scheduled", "Draft"];

function getCollectionProductRevenue(e) {
  return Number(e.sold || 0) * Number(e.price || 0);
}

function formatCollectionSchedule(e) {
  return e
    ? collectionDateFormatter.format(new Date(`${String(e)}T00:00:00`))
    : "Always on";
}

function CollectionStatusBadge({ value }) {
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

function CollectionSummaryCard({ icon, label, value, detail, tone = "green" }) {
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

export function CollectionsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState(false);
  const [u, d] = useState(1);
  const [f, p] = useState(8);
  const [m, h] = useState(() => new Set());
  const [g, _] = useState(0);
  const [v, y] = useState(null);
  const b = useMemo(() => listRecords("collections"), [g]);
  const x = useMemo(() => listRecords("products"), [g]);
  const S = useMemo(
    () =>
      listRecords("collections", {
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
              !`${e.name || ""} ${e.rule || ""} ${e.value || ""} ${e.placement || ""}`
                .toLowerCase()
                .includes(t.toLowerCase())) ||
            (r && e.status !== r) ||
            (a && e.rule !== a)
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
  const j = (e) => {
    try {
      e();
      k();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This change could not be completed.",
      );
    }
  };
  const M = () => {
    downloadFile(
      "veylix-collections.csv",
      "﻿" +
        buildCsv(
          C,
          [
            "name",
            "rule",
            "value",
            "placement",
            "sort",
            "startAt",
            "endAt",
            "status",
            "notes",
          ],
          [
            "Collection",
            "Selection rule",
            "Rule value / product SKUs",
            "Storefront placement",
            "Product order",
            "Starts",
            "Ends",
            "Status",
            "Notes",
          ],
        ),
    );
    showToast("Filtered collections exported.");
  };
  const N = b.filter((e) => e.status === "Published");
  const ee = new Set(
    N.flatMap((e) => getCollectionProducts(e, x).map((e) => e.id)),
  );
  const te = [...ee]
    .map((e) => x.find((t) => t.id === e))
    .filter(Boolean)
    .reduce((e, t) => e + getCollectionProductRevenue(t), 0);
  const ne = collectionRuleOptions.map((e, t) => ({
    rule: e,
    icon: ["list", "package", "seal-percent", "tag"][t],
    count: b.filter((t) => t.rule === e).length,
  }));
  const re = E.length > 0 && E.every((e) => m.has(e.id));
  return (
    <Fragment>
      <CommercePageHeading
        title="Collections"
        onExport={M}
        onCreate={() =>
          y({
            mode: "create",
          })
        }
        createLabel="Add collection"
      />
      <nav
        className="resource-shortcuts catalog-merch-nav"
        aria-label="Catalog merchandising pages"
      >
        {collectionsMerchNavItems.map(([e, t]) =>
          e === "collections" ? (
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
        <CollectionSummaryCard
          icon="sparkle"
          label="Published collections"
          value={String(N.length)}
          detail={`${b.length} total collections`}
        />
        <CollectionSummaryCard
          icon="package"
          label="Products merchandised"
          value={String(ee.size)}
          detail="Across live collections"
          tone="blue"
        />
        <CollectionSummaryCard
          icon="chart-line-up"
          label="Collection revenue"
          value={formatCurrency(te, 0)}
          detail="Referenced product revenue"
          tone="green"
        />
        <CollectionSummaryCard
          icon="calendar"
          label="Scheduled / draft"
          value={String(b.filter((e) => e.status !== "Published").length)}
          detail="Upcoming work"
          tone="amber"
        />
      </section>
      <section className="glass-card catalog-merch-insight">
        <div className="catalog-ops-heading">
          <div>
            <span>SMART MERCHANDISING</span>
            <h2>Mix editorial control with dynamic rules</h2>
            <p>
              Manual selections give precise curation; category, price and tag
              rules keep discovery pages fresh as the catalog changes.
            </p>
          </div>
          <small>Rules recalculate from current product data</small>
        </div>
        <div className="collection-rule-grid">
          {ne.map(({ rule, icon, count }) => (
            <div key={rule}>
              <span>
                <Icon name={icon} />
              </span>
              <strong>{rule}</strong>
              <small>
                {count}
                {" collection"}
                {count === 1 ? "" : "s"}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className="glass-card product-filter-card catalog-ops-filter">
        <div className="c-toolbar product-toolbar">
          <label className="c-filter">
            <select
              data-collection-rule
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                d(1);
                A();
              }}
            >
              <option value="">All selection rules</option>
              {collectionRuleOptions.map((e) => (
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
              {collectionStatusOptions.map((e) => (
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
            {" Archived collections"}
          </label>
          <label className="c-search product-search">
            <Icon name="search" />
            <input
              data-c-search
              type="search"
              placeholder="Search collections or rule values..."
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
            <span>MERCHANDISING</span>
            <h2>Collection workspace</h2>
            <p>
              Control what shoppers discover, where it appears and how
              membership is calculated.
            </p>
          </div>
          <small>
            {C.length}
            {" matching collections"}
          </small>
        </div>
        <div id="resource-results">
          <BulkSelectionBar
            count={m.size}
            archived={s}
            onBulkArchive={() =>
              j(() => {
                archiveRecords("collections", [...m], s);
                A();
                showToast(s ? "Records restored." : "Records archived.");
              })
            }
            onClear={A}
          />
          <div className="table-scroll c-table-scroll catalog-ops-table-scroll">
            <table className="c-table catalog-ops-table catalog-merch-table collection-table">
              <thead>
                <tr>
                  <th className="c-check">
                    <input
                      type="checkbox"
                      checked={re}
                      onChange={(e) => {
                        const t = e.currentTarget.checked;
                        h((e) => {
                          const n = new Set(e);
                          E.forEach((e) => (t ? n.add(e.id) : n.delete(e.id)));
                          return n;
                        });
                      }}
                      aria-label="Select all visible collections"
                    />
                  </th>
                  <th>Collection</th>
                  <th>Rule</th>
                  <th>Products</th>
                  <th>Revenue</th>
                  <th>Placement</th>
                  <th>Schedule</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {E.map((e) => {
                  const t = getCollectionProducts(e, x);
                  const n = t.reduce(
                    (e, t) => e + getCollectionProductRevenue(t),
                    0,
                  );
                  const r = s
                    ? [
                        {
                          label: "Restore collection",
                          icon: "check-circle",
                          onClick: () =>
                            j(() => {
                              archiveRecords("collections", [e.id], true);
                              showToast("Records restored.");
                            }),
                        },
                      ]
                    : [
                        {
                          label: "Preview collection",
                          icon: "eye",
                          onClick: () =>
                            y({
                              mode: "preview",
                              id: e.id,
                            }),
                        },
                        {
                          label: "Edit collection",
                          icon: "pencil",
                          onClick: () =>
                            y({
                              mode: "edit",
                              id: e.id,
                            }),
                        },
                        {
                          label:
                            e.status === "Published"
                              ? "Move to draft"
                              : "Publish now",
                          icon: "check-circle",
                          onClick: () =>
                            j(() => {
                              saveRecord(
                                "collections",
                                {
                                  status:
                                    e.status === "Published"
                                      ? "Draft"
                                      : "Published",
                                },
                                e.id,
                              );
                              showToast(
                                "Collection publishing status updated.",
                              );
                            }),
                        },
                        {
                          label: "Duplicate collection",
                          icon: "copy",
                          onClick: () =>
                            j(() => {
                              const { id, updatedAt, _archived, ...i } = e;
                              saveRecord("collections", {
                                ...i,
                                name: `${String(e.name || "")} copy`,
                                status: "Draft",
                              });
                              showToast("Draft collection duplicated.");
                            }),
                        },
                        {
                          label: "Archive collection",
                          icon: "trash",
                          danger: true,
                          separatorBefore: true,
                          onClick: () =>
                            j(() => {
                              archiveRecords("collections", [e.id]);
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
                          className="catalog-collection-name"
                          type="button"
                          onClick={() =>
                            y({
                              mode: "preview",
                              id: e.id,
                            })
                          }
                        >
                          <span>
                            <Icon name="sparkle" />
                          </span>
                          <span>
                            <strong>{String(e.name || "")}</strong>
                            <small>
                              {String(e.sort || "Manual")}
                              {" order"}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <strong>{String(e.rule || "")}</strong>
                        <small className="catalog-cell-note">
                          {String(e.value || "")}
                        </small>
                      </td>
                      <td>
                        <strong>{t.length}</strong>
                        <small className="catalog-cell-note">matched now</small>
                      </td>
                      <td>
                        <strong>{formatCurrency(n, 0)}</strong>
                        <small className="catalog-cell-note">
                          product revenue
                        </small>
                      </td>
                      <td>
                        <CollectionStatusBadge value={e.placement} />
                      </td>
                      <td>
                        <strong>{formatCollectionSchedule(e.startAt)}</strong>
                        <small className="catalog-cell-note">
                          {e.endAt
                            ? `until ${formatCollectionSchedule(e.endAt)}`
                            : "no end date"}
                        </small>
                      </td>
                      <td>
                        <CollectionStatusBadge value={e.status} />
                      </td>
                      <td className="product-actions-cell">
                        <RowActionsMenu
                          label={String(e.name || "collection")}
                          actions={r}
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
                <h3>No collections match</h3>
                <p>Try another rule, status or search term.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {D}–{O}
              {" of "}
              {C.length}
              {" collections"}
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
        <CollectionFormDialog onClose={() => y(null)} onSaved={k} />
      ) : null}
      {v?.mode === "edit" ? (
        <CollectionFormDialog
          recordId={v.id}
          onClose={() => y(null)}
          onSaved={k}
        />
      ) : null}
      {v?.mode === "preview" ? (
        <CollectionDetailDialog recordId={v.id} onClose={() => y(null)} />
      ) : null}
    </Fragment>
  );
}
