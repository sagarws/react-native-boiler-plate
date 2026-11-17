// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { TablePagination } from "@/components/ui/table-pagination";
import { VendorActivityDialog } from "@/features/marketplace/components/vendor-activity-dialog";
import { VendorCommissionDialog } from "@/features/marketplace/components/vendor-commission-dialog";
import { VendorDetailDialog } from "@/features/marketplace/components/vendor-detail-dialog";
import { VendorFinanceDialog } from "@/features/marketplace/components/vendor-finance-dialog";
import { VendorStatusPill } from "@/features/marketplace/components/vendor-status-pill";
import {
  buildVendorPerformance,
  getVendorCommissionRule,
} from "@/features/marketplace/lib/marketplace-metrics";
import {
  formatCommissionRate,
  formatVendorMoney,
  getVendorInitials,
  vendorCountFormatter,
  vendorsModuleConfig,
} from "@/features/marketplace/lib/vendor-format";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { buildHref, navigate } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

export function VendorsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState("");
  const [u, d] = useState(1);
  const [f, p] = useState(1);
  const [m, h] = useState(8);
  const [g, _] = useState(0);
  const [v, y] = useState(null);
  const b = () => _((e) => e + 1);
  const x = useMemo(() => listRecords("vendors"), [g]);
  const S = useMemo(() => {
    let e = [...x];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) =>
        [
          e.name,
          e.owner,
          e.email,
          e.category,
          e.country,
          e.commissionPlan,
          e.kyc,
          e.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(n),
      );
    }
    if (r) {
      e = e.filter((e) => e.status === r);
    }
    if (a) {
      e = e.filter((e) => String(e.kyc || "Verified") === a);
    }
    if (s) {
      e.sort((e, t) => {
        const n = buildVendorPerformance(e);
        const r = buildVendorPerformance(t);
        const i =
          {
            products: n.products,
            orders: n.orders,
            gmv: n.gmv,
            payable: n.payable,
            rating: n.rating,
            commission: Number(getVendorCommissionRule(e).rate || 0),
          }[s] ?? e[s];
        const a =
          {
            products: r.products,
            orders: r.orders,
            gmv: r.gmv,
            payable: r.payable,
            rating: r.rating,
            commission: Number(getVendorCommissionRule(t).rate || 0),
          }[s] ?? t[s];
        return (
          u *
          (typeof i == "number" && typeof a == "number"
            ? i - a
            : String(i || "").localeCompare(String(a || "")))
        );
      });
    }
    return e;
  }, [x, t, r, a, s, u]);
  const C = Math.max(1, Math.ceil(S.length / m));
  const w = Math.min(f, C);
  const T = S.slice((w - 1) * m, w * m);
  const E = x.map((e) => buildVendorPerformance(e));
  const D = E.reduce((e, t) => e + t.gmv, 0);
  const O = E.reduce((e, t) => e + t.commission, 0);
  const k = E.reduce((e, t) => e + t.payable, 0);
  const A = x.filter((e) => e.status === "Active").length;
  const j = x.filter(
    (e) => e.status === "Pending" || String(e.kyc || "Verified") !== "Verified",
  ).length;
  const M = (e) => {
    d((t) => (s === e && t === 1 ? -1 : 1));
    c(e);
  };
  const N = (e, t, n) => {
    const r = findRecord("vendors", e);
    if (r)
      try {
        saveRecord(
          "vendors",
          {
            ...r,
            ...t,
          },
          e,
        );
        b();
        showToast(n);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Vendor update failed.");
      }
  };
  return (
    <Fragment>
      <CommercePageHeading
        title="Vendors"
        onExport={() => {
          const e = S.map((e) => {
            const t = buildVendorPerformance(e);
            const n = getVendorCommissionRule(e);
            return {
              vendor: e.name,
              owner: e.owner,
              email: e.email,
              country: e.country,
              category: e.category,
              products: t.products,
              orders: t.orders,
              gmv: t.gmv.toFixed(2),
              commissionRate: Number(n.rate || 0).toFixed(2),
              commissionRule: n.name,
              platformEarnings: t.commission.toFixed(2),
              vendorPayable: t.payable.toFixed(2),
              verification: e.kyc,
              payoutStatus: e.payoutStatus,
              status: e.status,
            };
          });
          downloadFile(
            "veylix-marketplace-vendors.csv",
            "﻿" +
              buildCsv(
                e,
                Object.keys(
                  e[0] || {
                    vendor: "",
                  },
                ),
              ),
          );
          showToast("Filtered vendors exported.");
        }}
        onCreate={() =>
          y({
            kind: "record",
            mode: "create",
          })
        }
        createLabel="Invite vendor"
      />
      <section className="vendor-summary-grid" aria-label="Vendor overview">
        {[
          [
            "users",
            "Active vendors",
            vendorCountFormatter.format(A),
            `${x.length} marketplace partner${x.length === 1 ? "" : "s"}`,
            "green",
          ],
          [
            "chart-line-up",
            "Marketplace GMV",
            formatVendorMoney(D),
            `${vendorCountFormatter.format(E.reduce((e, t) => e + t.orders, 0))} vendor order lines`,
            "blue",
          ],
          [
            "seal-percent",
            "Platform earnings",
            formatVendorMoney(O),
            D
              ? `${((O / D) * 100).toFixed(1)}% effective take rate`
              : "No marketplace GMV",
            "amber",
          ],
          [
            "wallet",
            "Vendor payable",
            formatVendorMoney(k),
            j
              ? `${j} partner review${j === 1 ? "" : "s"} open`
              : "All partner checks clear",
            j ? "red" : "green",
          ],
        ].map(([e, t, n, r, i]) => (
          <article key={String(t)} className={`vendor-summary-card ${i}`}>
            <span>
              <Icon name={String(e)} />
            </span>
            <div>
              <small>{t}</small>
              <strong>{n}</strong>
              <em>{r}</em>
            </div>
          </article>
        ))}
      </section>
      <section className="glass-card vendor-health-strip">
        <div>
          <span>PARTNER OPERATIONS</span>
          <strong>
            {j
              ? `${j} vendor review${j === 1 ? "" : "s"} need attention`
              : "All vendor reviews are clear"}
          </strong>
          <small>
            Verification, commissions and payout controls are connected to each
            vendor profile.
          </small>
        </div>
        <div>
          <Link href={buildHref("/commerce/applications")}>Applications</Link>
          <Link href={buildHref("/commerce/commissions")}>
            Commission rules
          </Link>
          <Link href={buildHref("/commerce/payouts")}>Payouts</Link>
        </div>
      </section>
      <section className="glass-card c-resource vendor-resource">
        <div className="c-toolbar vendor-toolbar">
          <label className="c-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search vendors, owners, countries..."
              value={t}
              onChange={(e) => {
                n(e.target.value);
                p(1);
              }}
              aria-label="Search vendors"
            />
          </label>
          <label className="c-filter">
            <select
              value={r}
              onChange={(e) => {
                i(e.target.value);
                p(1);
              }}
            >
              <option value="">All statuses</option>
              {["Active", "Pending", "Suspended"].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              value={a}
              onChange={(e) => {
                o(e.target.value);
                p(1);
              }}
            >
              <option value="">All verification</option>
              {["Verified", "In review", "Missing documents"].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
        <div id="resource-results">
          <div className="vendor-table-wrap">
            <div
              className="table-scroll vendor-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Vendors table"
            >
              <table className="vendor-table">
                <thead>
                  <tr>
                    {[
                      ["Vendor", "name"],
                      ["Category", ""],
                      ["Products", "products"],
                      ["Orders", "orders"],
                      ["GMV", "gmv"],
                      ["Commission", "commission"],
                      ["Payable", "payable"],
                      ["Rating", "rating"],
                      ["Verification", ""],
                      ["Status", ""],
                    ].map(([e, t]) => (
                      <th key={e}>
                        {t ? (
                          <button type="button" onClick={() => M(t)}>
                            {e}
                            <Icon
                              name={
                                s === t && u < 0 ? "arrow-down" : "arrow-up"
                              }
                            />
                          </button>
                        ) : (
                          e
                        )}
                      </th>
                    ))}
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {T.map((e) => {
                    const t = buildVendorPerformance(e);
                    const n = getVendorCommissionRule(e);
                    const r = String(e.payoutStatus || "Ready") === "On hold";
                    const i = e.status === "Suspended";
                    return (
                      <tr key={e.id}>
                        <td>
                          <button
                            type="button"
                            className="vendor-identity"
                            onClick={() =>
                              y({
                                kind: "detail",
                                id: e.id,
                              })
                            }
                          >
                            <span className="vendor-avatar">
                              {getVendorInitials(e)}
                            </span>
                            <span>
                              <strong>{String(e.name || "")}</strong>
                              <small>
                                {String(
                                  e.owner || e.email || "Marketplace partner",
                                )}
                                {" · "}
                                {String(e.country || "Global")}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <div className="vendor-category">
                            <strong>{String(e.category || "—")}</strong>
                            <small>{String(e.brand || "Veylix Studio")}</small>
                          </div>
                        </td>
                        <td>
                          <strong>
                            {vendorCountFormatter.format(t.products)}
                          </strong>
                          <small className="vendor-cell-note">
                            catalog items
                          </small>
                        </td>
                        <td>
                          <strong>
                            {vendorCountFormatter.format(t.orders)}
                          </strong>
                          <small className="vendor-cell-note">
                            vendor lines
                          </small>
                        </td>
                        <td>
                          <strong>{formatVendorMoney(t.gmv)}</strong>
                          <small className="vendor-cell-note">
                            gross sales
                          </small>
                        </td>
                        <td>
                          <div className="vendor-commission">
                            <strong>{formatCommissionRate(n)}</strong>
                            <small>
                              {String(n.name || "")}
                              {" · "}
                              {formatVendorMoney(t.commission)}
                              {" earned"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <strong>{formatVendorMoney(t.payable)}</strong>
                          <small className="vendor-cell-note">
                            {t.queued
                              ? `${formatVendorMoney(t.queued)} queued`
                              : "available balance"}
                          </small>
                        </td>
                        <td>
                          <span className="vendor-rating">
                            <Icon name="star" />
                            <strong>
                              {t.rating ? t.rating.toFixed(1) : "—"}
                            </strong>
                          </span>
                        </td>
                        <td>
                          <VendorStatusPill value={e.kyc || "Verified"} />
                        </td>
                        <td>
                          <div className="vendor-status-stack">
                            <VendorStatusPill value={e.status || "Active"} />
                            <small>{String(e.payoutStatus || "Ready")}</small>
                          </div>
                        </td>
                        <td className="vendor-action-cell">
                          <RowActionsMenu
                            label={String(e.name || "")}
                            panelClassName="vendor-row-menu-panel"
                            estimatedHeight={430}
                            actions={[
                              {
                                label: "View vendor",
                                icon: "eye",
                                onClick: () =>
                                  y({
                                    kind: "detail",
                                    id: e.id,
                                  }),
                              },
                              {
                                label: "Edit vendor",
                                icon: "pencil",
                                onClick: () =>
                                  y({
                                    kind: "record",
                                    mode: "edit",
                                    id: e.id,
                                  }),
                              },
                              {
                                label: "Vendor products",
                                icon: "shopping-bag",
                                onClick: () => {
                                  navigate(
                                    `/commerce/products?q=${encodeURIComponent(String(e.brand || e.category || ""))}`,
                                  );
                                },
                              },
                              {
                                label: "Vendor orders",
                                icon: "basket",
                                onClick: () => {
                                  navigate(
                                    `/commerce/vendor-orders?q=${encodeURIComponent(String(e.name || ""))}`,
                                  );
                                },
                              },
                              {
                                label: "Finance & balances",
                                icon: "wallet",
                                onClick: () =>
                                  y({
                                    kind: "finance",
                                    id: e.id,
                                  }),
                              },
                              {
                                label: "Adjust commission",
                                icon: "seal-percent",
                                onClick: () =>
                                  y({
                                    kind: "commission",
                                    id: e.id,
                                  }),
                              },
                              {
                                label: "Activity",
                                icon: "history",
                                onClick: () =>
                                  y({
                                    kind: "activity",
                                    id: e.id,
                                  }),
                              },
                              {
                                label: r
                                  ? "Release payout hold"
                                  : "Hold payouts",
                                icon: r ? "play" : "pause",
                                separatorBefore: true,
                                onClick: () =>
                                  N(
                                    e.id,
                                    {
                                      payoutStatus: r ? "Ready" : "On hold",
                                    },
                                    r
                                      ? "Payout hold released."
                                      : "Vendor payouts placed on hold.",
                                  ),
                              },
                              {
                                label: i
                                  ? "Reactivate vendor"
                                  : "Suspend vendor",
                                icon: i ? "check-circle" : "x",
                                danger: !i,
                                onClick: () =>
                                  N(
                                    e.id,
                                    {
                                      status: i ? "Active" : "Suspended",
                                    },
                                    i
                                      ? "Vendor reactivated."
                                      : "Vendor suspended.",
                                  ),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {T.length ? null : (
                <div className="c-empty">
                  <h3>No vendor matches</h3>
                  <p>Try another search or filter.</p>
                </div>
              )}
            </div>
            <TablePagination
              page={w}
              pages={C}
              size={m}
              total={S.length}
              onPrevious={() => p(Math.max(1, w - 1))}
              onNext={() => p(Math.min(C, w + 1))}
              onSizeChange={(e) => {
                h(e);
                p(1);
              }}
            />
          </div>
        </div>
      </section>
      {v?.kind === "record" ? (
        <ResourceRecordDialog
          module={vendorsModuleConfig}
          mode={v.mode === "edit" ? "edit" : "create"}
          recordId={v.id}
          onClose={() => y(null)}
          onChanged={b}
          onEdit={(e) =>
            y({
              kind: "record",
              mode: "edit",
              id: e,
            })
          }
        />
      ) : null}
      {v?.kind === "detail" && v.id ? (
        <VendorDetailDialog
          id={v.id}
          onClose={() => y(null)}
          onEdit={() =>
            y({
              kind: "record",
              mode: "edit",
              id: v.id,
            })
          }
          onFinance={() =>
            y({
              kind: "finance",
              id: v.id,
            })
          }
          onCommission={() =>
            y({
              kind: "commission",
              id: v.id,
            })
          }
        />
      ) : null}
      {v?.kind === "finance" && v.id ? (
        <VendorFinanceDialog
          id={v.id}
          onClose={() => y(null)}
          onToggleHold={() => {
            const e = findRecord("vendors", v.id);
            N(
              e.id,
              {
                payoutStatus:
                  e.payoutStatus === "On hold" ? "Ready" : "On hold",
              },
              e.payoutStatus === "On hold"
                ? "Payout hold released."
                : "Vendor payouts placed on hold.",
            );
          }}
        />
      ) : null}
      {v?.kind === "commission" && v.id ? (
        <VendorCommissionDialog
          id={v.id}
          onClose={() => y(null)}
          onChanged={() => {
            b();
            y(null);
          }}
        />
      ) : null}
      {v?.kind === "activity" && v.id ? (
        <VendorActivityDialog id={v.id} onClose={() => y(null)} />
      ) : null}
    </Fragment>
  );
}
