// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { MarketplaceOperationsNav } from "@/features/marketplace/components/marketplace-operations-nav";
import {
  MarketplaceSortableHeader,
  VendorSummaryCard,
} from "@/features/marketplace/components/marketplace-review-ui";
import { PayoutBatchDialog } from "@/features/marketplace/components/payout-batch-dialog";
import { PayoutStatusPill } from "@/features/marketplace/components/payout-status-pill";
import {
  formatPayoutDate,
  formatPayoutMoney,
  getPayoutVendorInitials,
  payoutBatchStatusOptions,
  payoutNumberFormatter,
} from "@/features/marketplace/lib/payout-helpers";
import {
  calculatePayoutStatement,
  getPayoutSummary,
  readMarketplaceSettlementSettings,
  togglePayoutBatchHold,
  updatePayoutBatchStatus,
} from "@/features/marketplace/lib/settlements";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";

export function VendorPayoutsPage({ initialQuery = "" }) {
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
  const x = readMarketplaceSettlementSettings();
  const S = useMemo(() => listRecords("payouts"), [g]);
  const C = useMemo(() => {
    let e = [...S];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) =>
        [
          e.reference,
          getRecordLabel("vendors", e.vendorId),
          e.method,
          e.destination,
          e.status,
          e.holdReason,
        ]
          .join(" ")
          .toLowerCase()
          .includes(n),
      );
    }
    if (r) {
      e = e.filter((e) => e.vendorId === r);
    }
    if (a) {
      e = e.filter((e) => e.status === a);
    }
    const n = (e, t) =>
      t === "amount"
        ? Number(e.amount || 0)
        : t === "expectedAt" || t === "date"
          ? Date.parse(String(e[t] || "")) || 0
          : t === "vendor"
            ? getRecordLabel("vendors", e.vendorId)
            : String(e[t] || "");
    if (s) {
      e.sort((e, t) => {
        const r = n(e, s);
        const i = n(t, s);
        return (
          u *
          (typeof r == "number" && typeof i == "number"
            ? r - i
            : String(r).localeCompare(String(i)))
        );
      });
    } else {
      e.sort((e, t) =>
        String(t.date || "").localeCompare(String(e.date || "")),
      );
    }
    return e;
  }, [S, t, r, a, s, u]);
  const w = getPayoutSummary();
  const T = Math.max(1, Math.ceil(C.length / m));
  const E = Math.min(f, T);
  const D = C.slice((E - 1) * m, E * m);
  const O = (e) => {
    if (s === e) {
      d((e) => (e === 1 ? -1 : 1));
    } else {
      c(e);
      d(1);
    }
    p(1);
  };
  const k = (e, t) => {
    try {
      e();
      b();
      showToast(t);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Payout update failed.");
    }
  };
  const A = () => {
    downloadFile(
      "veylix-marketplace-payouts.csv",
      "﻿" +
        buildCsv(
          C.map((e) => {
            const t = calculatePayoutStatement(e);
            return {
              vendor: getRecordLabel("vendors", e.vendorId),
              reference: e.reference,
              period: `${e.periodStart || ""} to ${e.periodEnd || ""}`,
              orders: t.splits.length,
              gross: t.gross,
              deductions: t.commission + t.refunds,
              reserve: t.reserve,
              adjustment: t.adjustment,
              amount: t.amount,
              method: e.method,
              destination: e.destination,
              expected: e.expectedAt,
              status: e.status,
            };
          }),
          [
            "vendor",
            "reference",
            "period",
            "orders",
            "gross",
            "deductions",
            "reserve",
            "adjustment",
            "amount",
            "method",
            "destination",
            "expected",
            "status",
          ],
          [
            "Vendor",
            "Reference",
            "Period",
            "Order lines",
            "Gross",
            "Commission fees & refunds",
            "Reserve held",
            "Adjustment",
            "Net payout",
            "Method",
            "Destination",
            "Expected",
            "Status",
          ],
        ),
    );
    showToast("Filtered vendor payouts exported.");
  };
  const j = (e) => {
    const t = ["Draft", "Failed"].includes(String(e.status));
    const n = e.status === "Ready for processing";
    const r = e.status === "Processing";
    const i = e.status === "On hold";
    return [
      {
        label: "View statement",
        icon: "eye",
        onClick: () =>
          y({
            kind: "detail",
            id: e.id,
          }),
      },
      {
        label: "Open vendor",
        icon: "users",
        onClick: () =>
          navigate(
            `/commerce/vendors?q=${encodeURIComponent(getRecordLabel("vendors", e.vendorId))}`,
          ),
      },
      {
        label: "Included vendor orders",
        icon: "basket",
        onClick: () =>
          navigate(
            `/commerce/vendor-orders?q=${encodeURIComponent(getRecordLabel("vendors", e.vendorId))}`,
          ),
      },
      {
        label: "Copy reference",
        icon: "copy",
        onClick: () =>
          navigator.clipboard
            ?.writeText(String(e.reference || e.id))
            .then(() => showToast("Payout reference copied.")),
      },
      ...(["Paid", "Cancelled"].includes(String(e.status))
        ? []
        : [
            {
              label: "Edit payout batch",
              icon: "pencil",
              onClick: () =>
                y({
                  kind: "edit",
                  id: e.id,
                }),
            },
          ]),
      ...(t
        ? [
            {
              label: "Mark ready",
              icon: "check-circle",
              separatorBefore: true,
              onClick: () =>
                k(
                  () => updatePayoutBatchStatus(e.id, "Ready for processing"),
                  `Payout ${e.reference} marked ready for processing.`,
                ),
            },
          ]
        : []),
      ...(n
        ? [
            {
              label: "Start processing",
              icon: "timer",
              separatorBefore: !t,
              onClick: () =>
                k(
                  () => updatePayoutBatchStatus(e.id, "Processing"),
                  `Payout ${e.reference} marked processing.`,
                ),
            },
          ]
        : []),
      ...(r
        ? [
            {
              label: "Mark paid",
              icon: "check-circle",
              separatorBefore: true,
              onClick: () =>
                k(
                  () => updatePayoutBatchStatus(e.id, "Paid"),
                  `Payout ${e.reference} marked paid.`,
                ),
            },
          ]
        : []),
      ...(["Paid", "Cancelled"].includes(String(e.status))
        ? []
        : [
            {
              label: i ? "Release hold" : "Place on hold",
              icon: i ? "play" : "pause",
              onClick: () =>
                k(
                  () => togglePayoutBatchHold(e.id),
                  i ? "Payout hold released." : "Payout placed on hold.",
                ),
            },
            {
              label: "Cancel batch",
              icon: "x",
              danger: true,
              onClick: () =>
                k(
                  () => updatePayoutBatchStatus(e.id, "Cancelled"),
                  `Payout ${e.reference} cancelled.`,
                ),
            },
          ]),
    ];
  };
  return (
    <Fragment>
      <CommercePageHeading
        title="Vendor payouts"
        onExport={A}
        onCreate={() =>
          y({
            kind: "create",
          })
        }
        createLabel="Create payout batch"
      />
      <MarketplaceOperationsNav active="payouts" />
      <section
        className="commission-summary-grid"
        aria-label="Vendor payout overview"
      >
        <VendorSummaryCard
          icon="wallet"
          label="Available to settle"
          value={formatPayoutMoney(w.available)}
          detail={`${w.readyLines} payout-ready vendor lines`}
        />
        <VendorSummaryCard
          icon="timer"
          label="Scheduled"
          value={formatPayoutMoney(w.scheduled)}
          detail={`${w.scheduledCount} active payout batches`}
          tone="blue"
        />
        <VendorSummaryCard
          icon="info"
          label="On hold"
          value={formatPayoutMoney(w.held)}
          detail={
            w.held ? "Verification, reserve or dispute hold" : "No payout holds"
          }
          tone={w.held ? "red" : "green"}
        />
        <VendorSummaryCard
          icon="check-circle"
          label="Paid"
          value={formatPayoutMoney(w.paid)}
          detail={`${w.paidCount} completed settlement batches`}
          tone="amber"
        />
      </section>
      <section className="glass-card vendor-split-flow payout-flow">
        <div>
          <span>SETTLEMENT CONTROL</span>
          <h2>Turn vendor earnings into traceable payout batches.</h2>
          <p>
            Eligible order lines are reserved once a batch is created.
            Verification, dispute holds, rolling reserve and the minimum payout
            policy stay visible before funds are marked paid.
          </p>
        </div>
        <div className="vendor-split-formula">
          <span>Vendor net</span>
          <Icon name="arrow-right" />
          <span>{Number(x.reserve || 0).toFixed(1)}% reserve policy</span>
          <Icon name="arrow-right" />
          <span>Adjustments</span>
          <Icon name="arrow-right" />
          <strong>
            {String(x.payout || "Weekly")}
            {" payout"}
          </strong>
        </div>
      </section>
      <section className="glass-card c-resource payout-resource">
        <div className="marketplace-review-heading">
          <div>
            <span>VENDOR SETTLEMENTS</span>
            <h2>Payout control center</h2>
            <p>
              Reserve eligible vendor earnings, review holds, track destination
              accounts and keep every settlement tied back to its vendor order
              economics.
            </p>
          </div>
          <small>
            {payoutNumberFormatter.format(C.length)}
            {" matching payouts"}
          </small>
        </div>
        <div className="c-toolbar marketplace-review-toolbar">
          <label className="c-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search vendor, reference, method..."
              value={t}
              aria-label="Search vendor payouts"
              onChange={(e) => {
                n(e.currentTarget.value);
                p(1);
              }}
            />
          </label>
          <label className="c-filter">
            <select
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                p(1);
              }}
            >
              <option value="">All vendors</option>
              {listRecords("vendors").map((e) => (
                <option key={e.id} value={e.id}>
                  {String(e.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <select
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                p(1);
              }}
            >
              <option value="">All statuses</option>
              {payoutBatchStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
        <div id="resource-results">
          <div className="vendor-table-wrap">
            <div
              className="table-scroll payout-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Vendor payouts"
            >
              <table className="payout-table">
                <thead>
                  <tr>
                    <MarketplaceSortableHeader
                      label="Vendor / batch"
                      sortKey="vendor"
                      sort={s}
                      direction={u}
                      onSort={O}
                    />
                    <th>Settlement period</th>
                    <th>Gross</th>
                    <th>Deductions</th>
                    <MarketplaceSortableHeader
                      label="Net payout"
                      sortKey="amount"
                      sort={s}
                      direction={u}
                      onSort={O}
                    />
                    <th>Destination</th>
                    <MarketplaceSortableHeader
                      label="Expected"
                      sortKey="expectedAt"
                      sort={s}
                      direction={u}
                      onSort={O}
                    />
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {D.map((e) => {
                    const t = calculatePayoutStatement(e);
                    const n = findRecord("vendors", e.vendorId);
                    return (
                      <tr key={e.id}>
                        <td>
                          <button
                            type="button"
                            className="vendor-identity payout-vendor-cell"
                            onClick={() =>
                              y({
                                kind: "detail",
                                id: e.id,
                              })
                            }
                          >
                            <span className="vendor-avatar">
                              {getPayoutVendorInitials(n)}
                            </span>
                            <span>
                              <strong>
                                {getRecordLabel("vendors", e.vendorId)}
                              </strong>
                              <small>
                                {String(e.reference || "Settlement")}
                                {" · "}
                                {String(e.schedule || "Manual")}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <div className="commission-effective">
                            <strong>
                              {formatPayoutDate(e.periodStart)}
                              {" → "}
                              {formatPayoutDate(e.periodEnd)}
                            </strong>
                            <small>
                              {t.splits.length}
                              {" vendor order line"}
                              {t.splits.length === 1 ? "" : "s"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="vendor-split-money">
                            <strong>{formatPayoutMoney(t.gross)}</strong>
                            <small>shopper gross</small>
                          </div>
                        </td>
                        <td>
                          <div className="vendor-split-money">
                            <strong>
                              −{formatPayoutMoney(t.commission + t.refunds)}
                            </strong>
                            <small>fees + refunds</small>
                          </div>
                        </td>
                        <td>
                          <div className="vendor-split-money">
                            <strong>{formatPayoutMoney(t.amount)}</strong>
                            <small>
                              {t.reserve
                                ? `${formatPayoutMoney(t.reserve)} reserve held`
                                : "net payout"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="commission-policy">
                            <strong>{String(e.method || "—")}</strong>
                            <small>
                              {String(e.destination || "No destination")}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="commission-effective">
                            <strong>{formatPayoutDate(e.expectedAt)}</strong>
                            <small>
                              {e.processedAt
                                ? `Paid ${formatPayoutDate(e.processedAt)}`
                                : "Expected payout"}
                            </small>
                          </div>
                        </td>
                        <td>
                          <PayoutStatusPill value={e.status} />
                        </td>
                        <td className="vendor-action-cell">
                          <RowActionsMenu
                            label={String(e.reference || e.id)}
                            actions={j(e)}
                            panelClassName="marketplace-row-menu-panel"
                            estimatedHeight={430}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {D.length ? null : (
                <div className="c-empty">
                  <h3>
                    {t || r || a
                      ? "No payout batch matches"
                      : "No payout batches yet"}
                  </h3>
                  <p>
                    Create a settlement batch from payout-ready vendor order
                    lines.
                  </p>
                </div>
              )}
            </div>
            <footer className="c-pagination">
              <span>
                {C.length ? (E - 1) * m + 1 : 0}–{Math.min(E * m, C.length)}
                {" of "}
                {C.length}
                {" payouts"}
              </span>
              <label>
                {"Per page "}
                <select
                  value={m}
                  onChange={(e) => {
                    h(Number(e.currentTarget.value));
                    p(1);
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
                  disabled={E === 1}
                  onClick={() => p((e) => Math.max(1, e - 1))}
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
                  onClick={() => p((e) => Math.min(T, e + 1))}
                >
                  Next
                </button>
              </div>
            </footer>
          </div>
        </div>
      </section>
      {v ? (
        <PayoutBatchDialog
          state={v}
          onClose={() => y(null)}
          onChanged={b}
          onEdit={(e) =>
            y({
              kind: "edit",
              id: e,
            })
          }
        />
      ) : null}
    </Fragment>
  );
}
