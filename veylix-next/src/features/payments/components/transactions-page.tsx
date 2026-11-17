// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { PaymentWorkspaceNav } from "@/features/payments/components/payment-workspace-nav";
import { TransactionActivityList } from "@/features/payments/components/transaction-activity-list";
import { TransactionDetailDialog } from "@/features/payments/components/transaction-detail-dialog";
import {
  TransactionRiskPill,
  TransactionSettlementPill,
  TransactionStatusPill,
} from "@/features/payments/components/transaction-status-pills";
import {
  transactionDateFormatter,
  transactionProviderOptions,
  transactionSettlementOptions,
  transactionStatusOptions,
  transactionTypeOptions,
} from "@/features/payments/constants";
import {
  getSignedTransactionAmount,
  getTransactionAttentionReason,
  getTransactionMetrics,
  getTransactionNetAmount,
} from "@/features/payments/lib/payment-metrics";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency, formatNumber } from "@/lib/format";
import { buildHref, navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

function PaymentSummaryCard({ icon, label, value, detail, tone = "" }) {
  return (
    <article className={`payment-summary-card ${tone}`}>
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </article>
  );
}

function PaymentHealthStat({ icon, label, value, detail, tone = "" }) {
  return (
    <article className={`payment-health-stat ${tone}`}>
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </article>
  );
}

export function TransactionsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState("");
  const [u, d] = useState("");
  const [f, p] = useState("");
  const [m, h] = useState(1);
  const [g, _] = useState(1);
  const [v, y] = useState(8);
  const [b, x] = useState(0);
  const [S, C] = useState(null);
  const w = useMemo(() => listRecords("transactions"), [b]);
  const T = useMemo(() => getTransactionMetrics(w), [w]);
  const E = useMemo(() => {
    let e = [...w];
    const n = t.trim().toLowerCase();
    if (n) {
      e = e.filter((e) => {
        const t = findRecord("orders", String(e.orderId || ""));
        const r = t
          ? findRecord("customers", String(t.customerId || ""))
          : void 0;
        return [
          e.reference,
          e.provider,
          e.type,
          e.method,
          e.status,
          e.settlement,
          e.settlementRef,
          e.risk,
          e.reconciliation,
          t?.number,
          r?.name,
          r?.email,
        ]
          .join(" ")
          .toLowerCase()
          .includes(n);
      });
    }
    if (r) {
      e = e.filter((e) => e.status === r);
    }
    if (a) {
      e = e.filter((e) => e.provider === a);
    }
    if (s) {
      e = e.filter((e) => e.type === s);
    }
    if (u) {
      e = e.filter((e) => e.settlement === u);
    }
    if (f) {
      e.sort((e, t) => {
        const n = (e) =>
          f === "order"
            ? getRecordLabel("orders", e.orderId)
            : f === "amount"
              ? getSignedTransactionAmount(e)
              : f === "net"
                ? getTransactionNetAmount(e)
                : f === "date"
                  ? Date.parse(String(e.date || "")) || 0
                  : e[f];
        const r = n(e);
        const i = n(t);
        return (
          m *
          (typeof r == "number" && typeof i == "number"
            ? r - i
            : String(r || "").localeCompare(String(i || "")))
        );
      });
    }
    return e;
  }, [w, t, r, a, s, u, f, m]);
  const D = Math.max(1, Math.ceil(E.length / v));
  const O = Math.min(g, D);
  const k = E.slice((O - 1) * v, O * v);
  const A = E.length ? (O - 1) * v + 1 : 0;
  const j = Math.min(O * v, E.length);
  const M = listRecords("settlements")
    .filter((e) => e.status !== "Paid")
    .slice(0, 3);
  const N = w
    .filter(
      (e) =>
        ["Failed", "Requires action"].includes(String(e.status || "")) ||
        e.reconciliation === "Needs review" ||
        ["High", "Review"].includes(String(e.risk || "")),
    )
    .slice(0, 4);
  const ee = (e) => {
    h((t) => (f === e && t === 1 ? -1 : 1));
    p(e);
    _(1);
  };
  const te = (e) => {
    saveRecord(
      "transactions",
      {
        reconciliation:
          e.reconciliation === "Needs review" ? "Matched" : e.reconciliation,
        risk: e.risk === "Review" ? "Normal" : e.risk,
      },
      e.id,
    );
    x((e) => e + 1);
    showToast(
      e.risk === "Review"
        ? "Payment review cleared in the local demo ledger."
        : "Transaction marked reconciled in the local demo ledger.",
    );
  };
  const ne = async (e) => {
    try {
      await navigator.clipboard.writeText(String(e.reference || ""));
      showToast("Payment reference copied.");
    } catch {
      showToast("Copy is unavailable in this browser.");
    }
  };
  const re = () => {
    downloadFile(
      "veylix-payment-transactions.csv",
      "﻿" +
        buildCsv(
          E.map((e) => ({
            reference: e.reference,
            order: getRecordLabel("orders", e.orderId),
            provider: e.provider,
            type: e.type,
            method: e.method,
            currency: e.currency,
            amount: getSignedTransactionAmount(e),
            fee: Number(e.fee || 0),
            net: getTransactionNetAmount(e),
            status: e.status,
            settlement: e.settlement,
            settlementRef: e.settlementRef,
            risk: e.risk,
            reconciliation: e.reconciliation,
            date: e.date,
          })),
          [
            "reference",
            "order",
            "provider",
            "type",
            "method",
            "currency",
            "amount",
            "fee",
            "net",
            "status",
            "settlement",
            "settlementRef",
            "risk",
            "reconciliation",
            "date",
          ],
          [
            "Reference",
            "Order",
            "Provider",
            "Type",
            "Method",
            "Currency",
            "Amount",
            "Fee",
            "Net",
            "Status",
            "Settlement",
            "Settlement reference",
            "Risk",
            "Reconciliation",
            "Date",
          ],
        ),
    );
    showToast("Filtered payment transactions exported.");
  };
  const ie = (e) => [
    {
      label: "View transaction",
      icon: "eye",
      onClick: () =>
        C({
          mode: "detail",
          id: e.id,
        }),
    },
    {
      label: "View order",
      icon: "clipboard-text",
      onClick: () =>
        navigate(
          `/commerce/orders?q=${encodeURIComponent(getRecordLabel("orders", e.orderId))}`,
        ),
    },
    {
      label: "Copy reference",
      icon: "copy",
      onClick: () => void ne(e),
    },
    {
      label: "Activity",
      icon: "history",
      onClick: () =>
        C({
          mode: "activity",
          id: e.id,
        }),
    },
    ...(e.settlementRef
      ? [
          {
            label: "View settlement",
            icon: "wallet",
            onClick: () =>
              navigate(
                `/commerce/settlements?q=${encodeURIComponent(String(e.settlementRef))}`,
              ),
          },
        ]
      : []),
    ...(e.reconciliation === "Needs review"
      ? [
          {
            label: "Mark reconciled",
            icon: "check-circle",
            onClick: () => te(e),
          },
        ]
      : []),
    ...(e.type !== "Refund" &&
    ["Succeeded", "Refunded"].includes(String(e.status || ""))
      ? [
          {
            label: "Open refund workflow",
            icon: "arrow-left",
            separatorBefore: true,
            onClick: () =>
              navigate(
                `/commerce/refunds?q=${encodeURIComponent(getRecordLabel("orders", e.orderId))}`,
              ),
          },
        ]
      : []),
  ];
  return (
    <Fragment>
      <CommercePageHeading
        title="Transactions"
        actions={
          <Fragment>
            <button type="button" className="secondary-button" onClick={re}>
              <Icon name="download" />
              {" Export"}
            </button>
            <Link
              className="primary-button"
              href={buildHref("/commerce/providers")}
            >
              Provider settings
              <Icon name="arrow-right" />
            </Link>
          </Fragment>
        }
      />
      <PaymentWorkspaceNav active="transactions" />
      <section className="payment-summary-grid" aria-label="Payment overview">
        <PaymentSummaryCard
          icon="wallet"
          label="Captured volume"
          value={formatCurrency(T.captured, 2)}
          detail={`${w.filter((e) => e.type === "Charge").length} charge records`}
          tone="green"
        />
        <PaymentSummaryCard
          icon="chart-line-up"
          label="Net after fees"
          value={formatCurrency(T.net, 2)}
          detail={`${formatCurrency(T.fees, 2)} provider fees`}
          tone="blue"
        />
        <PaymentSummaryCard
          icon="timer"
          label="Pending settlement"
          value={formatCurrency(T.pending, 2)}
          detail="In transit, pending or held"
          tone="amber"
        />
        <PaymentSummaryCard
          icon="info"
          label="Needs attention"
          value={formatNumber(T.attention)}
          detail={
            T.attention
              ? "Risk, reconciliation or payment review"
              : "No payment exceptions"
          }
          tone="red"
        />
      </section>
      <section
        className="payment-health-strip"
        aria-label="Payment health snapshot"
      >
        <PaymentHealthStat
          icon="check-circle"
          label="Charge success"
          value={`${T.successRate.toFixed(1)}%`}
          detail={`${T.succeeded} of ${T.charges} charge attempts`}
          tone="good"
        />
        <PaymentHealthStat
          icon="arrow-left"
          label="Refund volume"
          value={formatCurrency(T.refunds, 2)}
          detail={`${w.filter((e) => e.type === "Refund" || e.status === "Refunded").length} refund-related records`}
          tone="info"
        />
        <PaymentHealthStat
          icon="info"
          label="Payment blockers"
          value={formatNumber(T.failed)}
          detail={
            T.failed
              ? "Failed or customer-action payment states"
              : "No blocked payment attempts"
          }
          tone="warn"
        />
        <PaymentHealthStat
          icon="seal-percent"
          label="Provider fee rate"
          value={`${T.feeRate.toFixed(2)}%`}
          detail={`${formatCurrency(T.fees, 2)} posted provider fees`}
          tone="neutral"
        />
      </section>
      <div className="payment-ops-grid">
        <section className="glass-card payment-ops-card">
          <div className="payment-ops-heading">
            <div>
              <span>SETTLEMENT PIPELINE</span>
              <h2>Money on the way</h2>
              <p>
                Provider payout batches expected to reach your destination
                account.
              </p>
            </div>
            <Link
              href={buildHref("/commerce/settlements")}
              className="secondary-button"
            >
              View all
              <Icon name="arrow-right" />
            </Link>
          </div>
          <div className="payment-settlement-list">
            {M.length ? (
              M.map((e) => (
                <Link
                  key={e.id}
                  href={buildHref(
                    `/commerce/settlements?q=${encodeURIComponent(String(e.reference || ""))}`,
                  )}
                  className="payment-settlement-item"
                >
                  <span className="payment-provider-logo">
                    <Icon name="wallet" />
                  </span>
                  <span className="payment-settlement-copy">
                    <strong>{String(e.provider || "")}</strong>
                    <small>{String(e.reference || "")}</small>
                    <em>
                      <Icon name="calendar" />
                      {" Expected "}
                      {String(e.expected || "date pending")}
                    </em>
                  </span>
                  <span className="payment-settlement-value">
                    <b>{formatCurrency(Number(e.net || 0), 2)}</b>
                    <TransactionStatusPill
                      value={String(e.status || "Pending")}
                    />
                  </span>
                </Link>
              ))
            ) : (
              <p className="payment-panel-empty">No open settlement batches.</p>
            )}
          </div>
        </section>
        <section className="glass-card payment-ops-card payment-review-card">
          <div className="payment-ops-heading">
            <div>
              <span>REVIEW QUEUE</span>
              <h2>Payment attention</h2>
              <p>
                Prioritized payment exceptions with enough space to scan,
                understand and act.
              </p>
            </div>
            <span className="payment-review-count">
              {formatNumber(N.length)}
              {" open"}
            </span>
          </div>
          <div className="payment-attention-list">
            {N.length ? (
              N.map((e) => {
                const t = getTransactionAttentionReason(e);
                const n = findRecord("orders", String(e.orderId || ""));
                const r = n
                  ? findRecord("customers", String(n.customerId || ""))
                  : void 0;
                const i =
                  e.reconciliation === "Needs review" || e.risk === "Review";
                return (
                  <article
                    key={e.id}
                    className={`payment-attention-item ${t.tone}`}
                  >
                    <button
                      type="button"
                      className="payment-attention-main"
                      onClick={() =>
                        C({
                          mode: "detail",
                          id: e.id,
                        })
                      }
                    >
                      <span className="payment-attention-icon">
                        <Icon name={t.icon} />
                      </span>
                      <span className="payment-attention-copy">
                        <span className="payment-attention-title">
                          <strong>{String(e.reference || "")}</strong>
                          <i>{t.label}</i>
                        </span>
                        <small>
                          {t.detail}
                          {" · "}
                          {String(e.provider || "")}
                        </small>
                        <em>
                          {String(n?.number || "No order")}
                          {" · "}
                          {String(r?.name || "Customer")}
                        </em>
                      </span>
                      <span className="payment-attention-amount">
                        <b>
                          {formatCurrency(Math.abs(Number(e.amount || 0)), 2)}
                        </b>
                        <small>amount reviewed</small>
                      </span>
                    </button>
                    <div className="payment-attention-actions">
                      <button
                        type="button"
                        onClick={() =>
                          C({
                            mode: "detail",
                            id: e.id,
                          })
                        }
                      >
                        <Icon name="eye" />
                        {" Review"}
                      </button>
                      {n ? (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/commerce/orders?q=${encodeURIComponent(String(n.number || ""))}`,
                            )
                          }
                        >
                          <Icon name="clipboard-text" />
                          {" Order"}
                        </button>
                      ) : null}
                      {i ? (
                        <button
                          type="button"
                          className="payment-attention-resolve"
                          onClick={() => te(e)}
                        >
                          <Icon name="check-circle" />
                          {" Mark reviewed"}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="payment-panel-empty">Nothing needs attention.</p>
            )}
          </div>
        </section>
      </div>
      <section className="glass-card payment-filter-card">
        <div className="c-toolbar payment-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter by provider</span>
            <select
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                _(1);
              }}
            >
              <option value="">All providers</option>
              {transactionProviderOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by status</span>
            <select
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                _(1);
              }}
            >
              <option value="">All statuses</option>
              {transactionStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by transaction type</span>
            <select
              value={s}
              onChange={(e) => {
                c(e.currentTarget.value);
                _(1);
              }}
            >
              <option value="">All transaction types</option>
              {transactionTypeOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by settlement</span>
            <select
              value={u}
              onChange={(e) => {
                d(e.currentTarget.value);
                _(1);
              }}
            >
              <option value="">All settlements</option>
              {transactionSettlementOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-search payment-search">
            <Icon name="search" />
            <input
              type="search"
              value={t}
              placeholder="Search reference, order, customer..."
              aria-label="Search payment transactions"
              onChange={(e) => {
                n(e.currentTarget.value);
                _(1);
              }}
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource payment-resource">
        <div className="payment-list-heading">
          <div>
            <span>PAYMENT LEDGER</span>
            <h2>Transactions</h2>
            <p>
              Charges, authorizations, refunds, fees and settlement context in
              one readable view.
            </p>
          </div>
          <small>
            {formatNumber(E.length)}
            {" matching records"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="table-scroll c-table-scroll payment-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Payment transactions"
          >
            {E.length ? (
              <table className="c-table payment-table">
                <thead>
                  <tr>
                    {[
                      ["Reference", "reference"],
                      ["Order & customer", "order"],
                      ["Provider", "provider"],
                      ["Amount", "amount"],
                    ].map(([e, t]) => (
                      <TransactionSortableHeader
                        key={t}
                        label={e}
                        sortKey={t}
                        sort={f}
                        direction={m}
                        onSort={ee}
                      />
                    ))}
                    <th>Fee</th>
                    <TransactionSortableHeader
                      label="Net"
                      sortKey="net"
                      sort={f}
                      direction={m}
                      onSort={ee}
                    />
                    <TransactionSortableHeader
                      label="Status"
                      sortKey="status"
                      sort={f}
                      direction={m}
                      onSort={ee}
                    />
                    <TransactionSortableHeader
                      label="Settlement"
                      sortKey="settlement"
                      sort={f}
                      direction={m}
                      onSort={ee}
                    />
                    <TransactionSortableHeader
                      label="Risk"
                      sortKey="risk"
                      sort={f}
                      direction={m}
                      onSort={ee}
                    />
                    <TransactionSortableHeader
                      label="Date"
                      sortKey="date"
                      sort={f}
                      direction={m}
                      onSort={ee}
                    />
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {k.map((e) => {
                    const t = findRecord("orders", String(e.orderId || ""));
                    const n = t
                      ? findRecord("customers", String(t.customerId || ""))
                      : void 0;
                    const r = getSignedTransactionAmount(e);
                    const i = getTransactionNetAmount(e);
                    return (
                      <tr key={e.id}>
                        <td>
                          <button
                            type="button"
                            className="payment-reference"
                            onClick={() =>
                              C({
                                mode: "detail",
                                id: e.id,
                              })
                            }
                          >
                            <strong>{String(e.reference || "")}</strong>
                            <small>
                              {String(e.type || "")}
                              {" · "}
                              {String(e.currency || "USD")}
                            </small>
                          </button>
                        </td>
                        <td>
                          <div className="payment-order-context">
                            <strong>
                              {String(
                                t?.number ||
                                  getRecordLabel("orders", e.orderId),
                              )}
                            </strong>
                            <small>
                              {String(n?.name || "Customer")}
                              {" · "}
                              {String(n?.email || "No email")}
                            </small>
                          </div>
                        </td>
                        <td>
                          <div className="payment-provider">
                            <span>
                              <Icon
                                name={
                                  e.provider === "Offline"
                                    ? "storefront"
                                    : "wallet"
                                }
                              />
                            </span>
                            <div>
                              <strong>{String(e.provider || "")}</strong>
                              <small>
                                {String(e.method || "Payment method")}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong
                            className={`payment-amount ${r < 0 ? "negative" : ""}`}
                          >
                            {formatCurrency(r, 2)}
                          </strong>
                        </td>
                        <td>
                          <span className="payment-fee">
                            {formatCurrency(Number(e.fee || 0), 2)}
                          </span>
                        </td>
                        <td>
                          <strong
                            className={`payment-net ${i < 0 ? "negative" : ""}`}
                          >
                            {formatCurrency(i, 2)}
                          </strong>
                        </td>
                        <td>
                          <TransactionStatusPill
                            value={String(e.status || "Pending")}
                          />
                        </td>
                        <td>
                          <div className="payment-settlement-cell">
                            <TransactionSettlementPill
                              value={String(e.settlement || "Pending")}
                            />
                            <small>
                              {String(e.settlementRef || "No payout batch")}
                            </small>
                          </div>
                        </td>
                        <td>
                          <TransactionRiskPill
                            value={String(e.risk || "Normal")}
                          />
                        </td>
                        <td>
                          <span className="payment-date">
                            {e.date
                              ? transactionDateFormatter.format(
                                  new Date(`${String(e.date)}T00:00:00`),
                                )
                              : "—"}
                          </span>
                        </td>
                        <td className="product-actions-cell payment-actions-cell">
                          <RowActionsMenu
                            label={String(e.reference || "transaction")}
                            actions={ie(e)}
                            triggerClassName="payment-row-menu"
                            panelClassName="payment-row-menu-panel"
                            estimatedHeight={430}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="c-empty">
                <Icon name="wallet" />
                <h3>No transactions match these filters</h3>
                <p>Try another provider, status or search.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {A}–{j}
              {" of "}
              {E.length}
              {" transactions"}
            </span>
            <label>
              {"Per page "}
              <select
                value={v}
                onChange={(e) => {
                  y(Number(e.currentTarget.value));
                  _(1);
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
                disabled={O === 1}
                onClick={() => _(Math.max(1, O - 1))}
              >
                Previous
              </button>
              <span>
                {O}
                {" / "}
                {D}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={O === D}
                onClick={() => _(Math.min(D, O + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {S?.mode === "detail" ? (
        <TransactionDetailDialog
          id={S.id}
          onClose={() => C(null)}
          onMarkReviewed={(e) => {
            te(e);
            C(null);
          }}
        />
      ) : null}
      {S?.mode === "activity" ? (
        <TransactionActivityList id={S.id} onClose={() => C(null)} />
      ) : null}
    </Fragment>
  );
}

function TransactionSortableHeader({
  label,
  sortKey,
  sort,
  direction,
  onSort,
}) {
  return (
    <th
      scope="col"
      aria-sort={
        sort === sortKey
          ? direction === 1
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
        <Icon
          name={sort === sortKey && direction < 0 ? "arrow-down" : "arrow-up"}
        />
      </button>
    </th>
  );
}
