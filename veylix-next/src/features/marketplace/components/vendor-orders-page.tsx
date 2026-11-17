// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { AddVendorSplitDialog } from "@/features/marketplace/components/add-vendor-split-dialog";
import { MarketplaceOperationsNav } from "@/features/marketplace/components/marketplace-operations-nav";
import { VendorSummaryCard } from "@/features/marketplace/components/marketplace-review-ui";
import { VendorOrderCommissionSnapshotDialog } from "@/features/marketplace/components/vendor-order-commission-snapshot-dialog";
import { VendorOrderStatusPill } from "@/features/marketplace/components/vendor-order-status-pill";
import { VendorSplitDetailDialog } from "@/features/marketplace/components/vendor-split-detail-dialog";
import {
  formatVendorOrderMoney,
  vendorOrderNumberFormatter,
  vendorOrderPayoutStatusOptions,
  vendorOrderStatusOptions,
} from "@/features/marketplace/data/vendor-orders";
import {
  advanceVendorOrderStatus,
  calculateVendorOrderCommission,
  toggleVendorOrderPayoutHold,
} from "@/features/marketplace/lib/vendor-order-splits";
import {
  formatVendorOrderDate,
  resolveVendorOrderRecordLabel,
} from "@/features/marketplace/lib/vendor-orders";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { navigate } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";

export function VendorOrdersPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState("");
  const [u, d] = useState(1);
  const [f, p] = useState(8);
  const [m, h] = useState(0);
  const [g, _] = useState(null);
  const v = () => h((e) => e + 1);
  const y = useMemo(() => listRecords("vendor-orders"), [m]);
  const b = useMemo(() => {
    let e = [...y];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) =>
        [
          resolveVendorOrderRecordLabel("orders", e.orderId),
          resolveVendorOrderRecordLabel("vendors", e.vendorId),
          resolveVendorOrderRecordLabel("products", e.productId),
          e.appliedRule,
          e.status,
          e.payoutStatus,
        ]
          .join(" ")
          .toLowerCase()
          .includes(n),
      );
    }
    if (s) {
      e = e.filter((e) => e.status === s);
    }
    if (r) {
      e = e.filter((e) => e.vendorId === r);
    }
    if (a) {
      e = e.filter((e) => String(e.payoutStatus || "Unscheduled") === a);
    }
    e.sort((e, t) => String(t.date || "").localeCompare(String(e.date || "")));
    return e;
  }, [y, t, r, a, s]);
  const x = Math.max(1, Math.ceil(b.length / f));
  const S = Math.min(u, x);
  const C = b.slice((S - 1) * f, S * f);
  const w = y.map((e) => calculateVendorOrderCommission(e)).filter(Boolean);
  const T = w.reduce((e, t) => e + t.shopperGross, 0);
  const E = w.reduce((e, t) => e + t.netCommission + t.otherFees, 0);
  const D = w.reduce((e, t) => e + t.vendorNet, 0);
  const O = w.reduce((e, t) => e + t.refundExposure, 0);
  const k = w.reduce((e, t) => e + t.eligibleBase, 0);
  const A = y.filter(
    (e) => Number(e.refunds || 0) + Number(e.chargebacks || 0) > 0,
  ).length;
  const j = (e, t) => {
    try {
      e();
      v();
      showToast(t);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Vendor order update failed.");
    }
  };
  const M = () => {
    downloadFile(
      "veylix-marketplace-vendor-orders.csv",
      "﻿" +
        buildCsv(
          b.map((e) => {
            const t = calculateVendorOrderCommission(e);
            return {
              order: resolveVendorOrderRecordLabel("orders", e.orderId),
              vendor: resolveVendorOrderRecordLabel("vendors", e.vendorId),
              product: resolveVendorOrderRecordLabel("products", e.productId),
              shopperGross: t.shopperGross,
              discount: t.discount,
              vendorDiscount: t.vendorDiscount,
              marketplaceDiscount: t.marketplaceDiscount,
              commission: t.netCommission,
              fees: t.otherFees,
              refunds: t.refundExposure,
              vendorNet: t.vendorNet,
              rule: e.appliedRule || t.rule.name,
              payout: e.payoutStatus,
              status: e.status,
              date: e.date,
            };
          }),
          [
            "order",
            "vendor",
            "product",
            "shopperGross",
            "discount",
            "vendorDiscount",
            "marketplaceDiscount",
            "commission",
            "fees",
            "refunds",
            "vendorNet",
            "rule",
            "payout",
            "status",
            "date",
          ],
          [
            "Order",
            "Vendor",
            "Product",
            "Shopper gross",
            "Discount",
            "Vendor-funded discount",
            "Marketplace-funded discount",
            "Commission",
            "Other fees",
            "Refunds/chargebacks",
            "Vendor net",
            "Rule snapshot",
            "Payout",
            "Fulfillment",
            "Date",
          ],
        ),
    );
    showToast("Filtered vendor order splits exported.");
  };
  const N = (e) => {
    const t =
      e.status === "Pending"
        ? "Accepted"
        : e.status === "Accepted"
          ? "Fulfilled"
          : "";
    return [
      {
        label: "View financial split",
        icon: "eye",
        onClick: () =>
          _({
            kind: "detail",
            id: e.id,
          }),
      },
      {
        label: "View customer order",
        icon: "clipboard-text",
        onClick: () =>
          navigate(
            `/commerce/orders?q=${encodeURIComponent(resolveVendorOrderRecordLabel("orders", e.orderId))}`,
          ),
      },
      {
        label: "Open vendor",
        icon: "users",
        onClick: () =>
          navigate(
            `/commerce/vendors?q=${encodeURIComponent(resolveVendorOrderRecordLabel("vendors", e.vendorId))}`,
          ),
      },
      {
        label: "Commission snapshot",
        icon: "seal-percent",
        onClick: () =>
          _({
            kind: "snapshot",
            id: e.id,
          }),
      },
      {
        label: "Payout queue",
        icon: "wallet",
        onClick: () =>
          navigate(
            `/commerce/payouts?q=${encodeURIComponent(resolveVendorOrderRecordLabel("vendors", e.vendorId))}`,
          ),
      },
      ...(t
        ? [
            {
              label: `Mark ${t.toLowerCase()}`,
              icon: "check-circle",
              separatorBefore: true,
              onClick: () =>
                j(
                  () => advanceVendorOrderStatus(e.id),
                  `Vendor split marked ${t.toLowerCase()}.`,
                ),
            },
          ]
        : []),
      {
        label:
          e.payoutStatus === "On hold" ? "Release payout hold" : "Hold payout",
        icon: e.payoutStatus === "On hold" ? "play" : "pause",
        onClick: () =>
          j(
            () => toggleVendorOrderPayoutHold(e.id),
            e.payoutStatus === "On hold"
              ? "Vendor payout hold released."
              : "Vendor payout placed on hold.",
          ),
      },
    ];
  };
  return (
    <Fragment>
      <CommercePageHeading
        title="Vendor orders"
        onExport={M}
        onCreate={() =>
          _({
            kind: "create",
          })
        }
        createLabel="Add vendor split"
      />
      <MarketplaceOperationsNav active="vendor-orders" />
      <section
        className="commission-summary-grid"
        aria-label="Vendor order economics"
      >
        <VendorSummaryCard
          icon="basket"
          label="Marketplace GMV"
          value={formatVendorOrderMoney(T)}
          detail={`${y.length} vendor financial lines`}
          tone="blue"
        />
        <VendorSummaryCard
          icon="seal-percent"
          label="Platform earnings"
          value={formatVendorOrderMoney(E)}
          detail={
            k
              ? `${((E / k) * 100).toFixed(1)}% effective take rate`
              : "No eligible base"
          }
          tone="amber"
        />
        <VendorSummaryCard
          icon="wallet"
          label="Vendor payable"
          value={formatVendorOrderMoney(D)}
          detail="After commission, fees and refunds"
        />
        <VendorSummaryCard
          icon="info"
          label="Refund exposure"
          value={formatVendorOrderMoney(O)}
          detail={`${A} affected split${A === 1 ? "" : "s"}`}
          tone="red"
        />
      </section>
      <section className="glass-card vendor-split-flow">
        <div>
          <span>ORDER ECONOMICS</span>
          <h2>Every vendor line explains where the money goes.</h2>
          <p>
            Marketplace-funded discounts keep vendor proceeds whole. Refund
            policy can reverse booked commission while the original rule
            snapshot stays immutable.
          </p>
        </div>
        <div className="vendor-split-formula">
          <span>Item revenue</span>
          <Icon name="arrow-right" />
          <span>Funding split</span>
          <Icon name="arrow-right" />
          <span>Commission</span>
          <Icon name="arrow-right" />
          <span>Fees / refunds</span>
          <Icon name="arrow-right" />
          <strong>Vendor net</strong>
        </div>
      </section>
      <section className="glass-card c-resource vendor-split-resource">
        <div className="marketplace-review-heading">
          <div>
            <span>SPLIT-ORDER ACCOUNTING</span>
            <h2>Vendor order ledger</h2>
            <p>
              See gross shopper value, discount funding, booked commission,
              refunds and the exact amount payable to each marketplace partner.
            </p>
          </div>
          <small>
            {vendorOrderNumberFormatter.format(b.length)}
            {" matching splits"}
          </small>
        </div>
        <div className="c-toolbar marketplace-review-toolbar">
          <label className="c-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search order, vendor, product or rule..."
              value={t}
              aria-label="Search vendor orders"
              onChange={(e) => {
                n(e.currentTarget.value);
                d(1);
              }}
            />
          </label>
          <label className="c-filter">
            <select
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                d(1);
              }}
            >
              <option value="">All vendors</option>
              {listRecords("vendors").map((e) => (
                <option key={e.id} value={e.id}>
                  {String(e.name || e.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                d(1);
              }}
            >
              <option value="">All payout states</option>
              {vendorOrderPayoutStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              value={s}
              onChange={(e) => {
                c(e.currentTarget.value);
                d(1);
              }}
            >
              <option value="">All fulfillment</option>
              {vendorOrderStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
        <div id="resource-results">
          <div className="vendor-table-wrap">
            <div
              className="table-scroll vendor-split-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Vendor financial splits"
            >
              <table className="vendor-split-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Vendor</th>
                    <th>Product</th>
                    <th>Shopper gross</th>
                    <th>Discounts</th>
                    <th>Commission</th>
                    <th>Fees / refunds</th>
                    <th>Vendor net</th>
                    <th>Payout</th>
                    <th>Fulfillment</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {C.map((e) => {
                    const t = calculateVendorOrderCommission(e);
                    return (
                      <tr key={e.id}>
                        <td>
                          <button
                            type="button"
                            className="vendor-split-order-cell"
                            onClick={() =>
                              _({
                                kind: "detail",
                                id: e.id,
                              })
                            }
                          >
                            <strong>
                              {resolveVendorOrderRecordLabel(
                                "orders",
                                e.orderId,
                              )}
                            </strong>
                            <small>
                              {formatVendorOrderDate(
                                e.date ||
                                  findRecord("orders", String(e.orderId || ""))
                                    ?.date,
                              )}
                            </small>
                          </button>
                        </td>
                        <td>
                          <div className="vendor-split-vendor">
                            <strong>
                              {resolveVendorOrderRecordLabel(
                                "vendors",
                                e.vendorId,
                              )}
                            </strong>
                            <small>
                              {String(
                                findRecord("vendors", String(e.vendorId || ""))
                                  ?.commissionPlan || "Marketplace partner",
                              )}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="vendor-split-product">
                            <strong>
                              {resolveVendorOrderRecordLabel(
                                "products",
                                e.productId,
                              )}
                            </strong>
                            <small>
                              {String(
                                findRecord(
                                  "products",
                                  String(e.productId || ""),
                                )?.sku || "",
                              )}
                            </small>
                          </div>
                        </td>
                        <td>
                          <strong>
                            {formatVendorOrderMoney(t.shopperGross)}
                          </strong>
                        </td>
                        <td>
                          <div className="vendor-split-money">
                            <strong>
                              {formatVendorOrderMoney(t.discount)}
                            </strong>
                            <small>
                              {formatVendorOrderMoney(t.vendorDiscount)}
                              {" vendor · "}
                              {formatVendorOrderMoney(t.marketplaceDiscount)}
                              {" marketplace"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="vendor-split-money">
                            <strong>
                              {formatVendorOrderMoney(t.netCommission)}
                            </strong>
                            <small>
                              {String(e.appliedRule || t.rule.name)}
                              {" · "}
                              {Number(t.rule.rate || 0).toFixed(1)}%
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="vendor-split-money">
                            <strong>
                              {formatVendorOrderMoney(
                                t.otherFees + t.refundExposure,
                              )}
                            </strong>
                            <small>
                              {formatVendorOrderMoney(t.otherFees)}
                              {" fees · "}
                              {formatVendorOrderMoney(t.refundExposure)}
                              {" refunds"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <strong className="vendor-net-value">
                            {formatVendorOrderMoney(t.vendorNet)}
                          </strong>
                        </td>
                        <td>
                          <VendorOrderStatusPill
                            value={e.payoutStatus || "Unscheduled"}
                          />
                        </td>
                        <td>
                          <VendorOrderStatusPill
                            value={e.status || "Pending"}
                          />
                        </td>
                        <td className="vendor-action-cell">
                          <RowActionsMenu
                            label={`${resolveVendorOrderRecordLabel("orders", e.orderId)} vendor split`}
                            actions={N(e)}
                            triggerClassName="marketplace-row-menu"
                            panelClassName="marketplace-row-menu-panel"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {C.length ? null : (
                <div className="c-empty">
                  <h3>No vendor order splits match</h3>
                  <p>Try another search or filter.</p>
                </div>
              )}
            </div>
            <footer className="c-pagination">
              <span>
                {b.length ? (S - 1) * f + 1 : 0}–{Math.min(S * f, b.length)}
                {" of "}
                {b.length}
                {" splits"}
              </span>
              <label>
                {"Per page "}
                <select
                  value={f}
                  onChange={(e) => {
                    p(Number(e.currentTarget.value));
                    d(1);
                  }}
                >
                  <option>8</option>
                  <option>16</option>
                  <option>32</option>
                </select>
              </label>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={S === 1}
                  onClick={() => d((e) => Math.max(1, e - 1))}
                >
                  Previous
                </button>
                <span>
                  {S}
                  {" / "}
                  {x}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={S === x}
                  onClick={() => d((e) => Math.min(x, e + 1))}
                >
                  Next
                </button>
              </div>
            </footer>
          </div>
        </div>
      </section>
      {g?.kind === "create" ? (
        <AddVendorSplitDialog onClose={() => _(null)} onChanged={v} />
      ) : null}
      {g?.kind === "detail" && g.id ? (
        <VendorSplitDetailDialog
          id={g.id}
          onClose={() => _(null)}
          onSnapshot={() =>
            _({
              kind: "snapshot",
              id: g.id,
            })
          }
        />
      ) : null}
      {g?.kind === "snapshot" && g.id ? (
        <VendorOrderCommissionSnapshotDialog
          id={g.id}
          onClose={() => _(null)}
        />
      ) : null}
    </Fragment>
  );
}
