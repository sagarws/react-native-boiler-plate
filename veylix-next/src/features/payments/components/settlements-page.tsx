// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { SummaryList } from "@/components/ui/summary-list";
import { PaymentWorkspaceNav } from "@/features/payments/components/payment-workspace-nav";
import { SettlementDetailDialog } from "@/features/payments/components/settlement-detail-dialog";
import { SettlementStatusPill } from "@/features/payments/components/settlement-status-pill";
import { TransactionDetailDialog } from "@/features/payments/components/transaction-detail-dialog";
import {
  settlementProviderOptions,
  settlementStatusOptions,
} from "@/features/payments/constants";
import { getSettlementMetrics } from "@/features/payments/lib/payment-metrics";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency, formatNumber } from "@/lib/format";
import { buildHref, navigate } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

function SettlementSortableHeader({ label, sortKey, sort, direction, onSort }) {
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

export function SettlementsPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState("");
  const [s, c] = useState("");
  const [u, d] = useState(1);
  const [f, p] = useState(1);
  const [m, h] = useState(8);
  const [g, _] = useState(null);
  const v = listRecords("settlements");
  const y = getSettlementMetrics(v);
  const b = [
    ["Settlement batches", v.length, `${y.openCount} still open`],
    ["Open net value", formatCurrency(y.openNet, 2), "Expected from providers"],
    ["Processing fees", formatCurrency(y.fees, 2), "Across listed batches"],
    ["On hold", y.holds, y.holds ? "Needs provider review" : "No payout holds"],
  ];
  const x = useMemo(() => {
    let e = [...v];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) =>
        [e.reference, e.provider, e.period, e.currency, e.bankAccount, e.status]
          .join(" ")
          .toLowerCase()
          .includes(n),
      );
    }
    if (a) {
      e = e.filter((e) => e.status === a);
    }
    if (r) {
      e = e.filter((e) => e.provider === r);
    }
    if (s) {
      e.sort((e, t) => {
        const n = (e, t) =>
          ["gross", "fees", "refunds", "net", "transactions"].includes(t)
            ? Number(e[t] || 0)
            : ["expected", "paidAt"].includes(t)
              ? Date.parse(String(e[t] || "")) || 0
              : e[t];
        const r = n(e, s);
        const i = n(t, s);
        return (
          u *
          (typeof r == "number" && typeof i == "number"
            ? r - i
            : String(r || "").localeCompare(String(i || "")))
        );
      });
    }
    return e;
  }, [v, t, a, r, s, u]);
  const S = Math.max(1, Math.ceil(x.length / m));
  const C = Math.min(f, S);
  const w = x.slice((C - 1) * m, C * m);
  const T = x.length ? (C - 1) * m + 1 : 0;
  const E = Math.min(C * m, x.length);
  const D = (e) => {
    d((t) => (s === e && t === 1 ? -1 : 1));
    c(e);
    p(1);
  };
  const O = async (e) => {
    try {
      await navigator.clipboard.writeText(String(e.reference || ""));
      showToast("Settlement reference copied.");
    } catch {
      showToast("Copy is unavailable in this browser.");
    }
  };
  const k = () => {
    downloadFile(
      "veylix-payment-settlements.csv",
      "﻿" +
        buildCsv(
          x.map((e) => ({
            reference: e.reference,
            provider: e.provider,
            period: e.period,
            currency: e.currency,
            gross: e.gross,
            fees: e.fees,
            refunds: e.refunds,
            net: e.net,
            transactions: e.transactions,
            destination: e.bankAccount,
            expected: e.expected,
            paidAt: e.paidAt,
            status: e.status,
          })),
          [
            "reference",
            "provider",
            "period",
            "currency",
            "gross",
            "fees",
            "refunds",
            "net",
            "transactions",
            "destination",
            "expected",
            "paidAt",
            "status",
          ],
          [
            "Settlement",
            "Provider",
            "Period",
            "Currency",
            "Gross",
            "Fees",
            "Refunds",
            "Net",
            "Transactions",
            "Destination",
            "Expected",
            "Paid date",
            "Status",
          ],
        ),
    );
    showToast("Filtered settlements exported.");
  };
  const A = (e) => [
    {
      label: "View settlement",
      icon: "eye",
      onClick: () =>
        _({
          mode: "detail",
          id: e.id,
        }),
    },
    {
      label: "View transactions",
      icon: "wallet",
      onClick: () =>
        navigate(
          `/commerce/transactions?q=${encodeURIComponent(String(e.reference || ""))}`,
        ),
    },
    {
      label: "Copy reference",
      icon: "copy",
      onClick: () => void O(e),
    },
    {
      label: "Provider settings",
      icon: "globe",
      onClick: () => navigate("/commerce/providers"),
    },
  ];
  return (
    <Fragment>
      <CommercePageHeading
        title="Settlements"
        onExport={k}
        afterExportActions={
          <Link
            className="primary-button"
            href={buildHref("/commerce/providers")}
          >
            Provider settings
            <Icon name="arrow-right" />
          </Link>
        }
      />
      <PaymentWorkspaceNav active="settlements" />
      <SummaryList items={b} />
      <section className="glass-card payment-filter-card">
        <div className="c-toolbar payment-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter by provider</span>
            <select
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                p(1);
              }}
            >
              <option value="">All providers</option>
              {settlementProviderOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by settlement status</span>
            <select
              value={a}
              onChange={(e) => {
                o(e.currentTarget.value);
                p(1);
              }}
            >
              <option value="">All statuses</option>
              {settlementStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-search payment-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search settlement or destination..."
              value={t}
              aria-label="Search settlements"
              onChange={(e) => {
                n(e.currentTarget.value);
                p(1);
              }}
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource payment-resource">
        <div className="payment-list-heading">
          <div>
            <span>PAYOUT RECONCILIATION</span>
            <h2>Settlement batches</h2>
            <p>
              Gross volume, fees, refunds and the net amount expected from each
              provider.
            </p>
          </div>
          <small>
            {formatNumber(x.length)}
            {" matching batches"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="table-scroll c-table-scroll settlement-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Payment settlements"
          >
            {x.length ? (
              <table className="c-table settlement-table">
                <thead>
                  <tr>
                    <SettlementSortableHeader
                      label="Settlement"
                      sortKey="reference"
                      sort={s}
                      direction={u}
                      onSort={D}
                    />
                    <SettlementSortableHeader
                      label="Provider"
                      sortKey="provider"
                      sort={s}
                      direction={u}
                      onSort={D}
                    />
                    <SettlementSortableHeader
                      label="Gross"
                      sortKey="gross"
                      sort={s}
                      direction={u}
                      onSort={D}
                    />
                    <SettlementSortableHeader
                      label="Fees"
                      sortKey="fees"
                      sort={s}
                      direction={u}
                      onSort={D}
                    />
                    <SettlementSortableHeader
                      label="Refunds"
                      sortKey="refunds"
                      sort={s}
                      direction={u}
                      onSort={D}
                    />
                    <SettlementSortableHeader
                      label="Net"
                      sortKey="net"
                      sort={s}
                      direction={u}
                      onSort={D}
                    />
                    <SettlementSortableHeader
                      label="Transactions"
                      sortKey="transactions"
                      sort={s}
                      direction={u}
                      onSort={D}
                    />
                    <SettlementSortableHeader
                      label="Destination"
                      sortKey="bankAccount"
                      sort={s}
                      direction={u}
                      onSort={D}
                    />
                    <SettlementSortableHeader
                      label="Status"
                      sortKey="status"
                      sort={s}
                      direction={u}
                      onSort={D}
                    />
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {w.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <button
                          type="button"
                          className="payment-reference"
                          onClick={() =>
                            _({
                              mode: "detail",
                              id: e.id,
                            })
                          }
                        >
                          <strong>{String(e.reference || "")}</strong>
                          <small>
                            {String(e.period || "Settlement period")}
                          </small>
                        </button>
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
                            <small>{String(e.currency || "USD")}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>
                          {formatCurrency(Number(e.gross || 0), 2)}
                        </strong>
                      </td>
                      <td>
                        <span className="payment-fee">
                          {formatCurrency(Number(e.fees || 0), 2)}
                        </span>
                      </td>
                      <td>
                        <span className="settlement-refund">
                          {formatCurrency(Number(e.refunds || 0), 2)}
                        </span>
                      </td>
                      <td>
                        <strong className="payment-net">
                          {formatCurrency(Number(e.net || 0), 2)}
                        </strong>
                      </td>
                      <td>
                        <span className="settlement-count">
                          {formatNumber(Number(e.transactions || 0))}
                        </span>
                      </td>
                      <td>
                        <div className="settlement-destination">
                          <strong>{String(e.bankAccount || "—")}</strong>
                          <small>
                            {e.paidAt
                              ? `Paid ${String(e.paidAt)}`
                              : `Expected ${String(e.expected || "TBD")}`}
                          </small>
                        </div>
                      </td>
                      <td>
                        <SettlementStatusPill
                          value={String(e.status || "Pending")}
                        />
                      </td>
                      <td className="product-actions-cell payment-actions-cell">
                        <RowActionsMenu
                          label={String(e.reference || "settlement")}
                          actions={A(e)}
                          triggerClassName="payment-row-menu"
                          panelClassName="payment-row-menu-panel"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="c-empty">
                <Icon name="wallet" />
                <h3>No settlements match these filters</h3>
                <p>Try another provider, status or search.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {T}–{E}
              {" of "}
              {x.length}
              {" settlements"}
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
                <option value={8}>8</option>
                <option value={16}>16</option>
                <option value={32}>32</option>
              </select>
            </label>
            <div>
              <button
                type="button"
                className="secondary-button"
                disabled={C === 1}
                onClick={() => p(Math.max(1, C - 1))}
              >
                Previous
              </button>
              <span>
                {C}
                {" / "}
                {S}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={C === S}
                onClick={() => p(Math.min(S, C + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {g?.mode === "detail" ? (
        <SettlementDetailDialog
          id={g.id}
          onClose={() => _(null)}
          onOpenTransaction={(e) =>
            _({
              mode: "transaction",
              id: e,
            })
          }
        />
      ) : null}
      {g?.mode === "transaction" ? (
        <TransactionDetailDialog
          id={g.id}
          onClose={() => _(null)}
          onMarkReviewed={(e) => {
            saveRecord(
              "transactions",
              {
                reconciliation:
                  e.reconciliation === "Needs review"
                    ? "Matched"
                    : e.reconciliation,
                risk: e.risk === "Review" ? "Normal" : e.risk,
              },
              e.id,
            );
            showToast(
              "Transaction marked reconciled in the local demo ledger.",
            );
            _(null);
          }}
        />
      ) : null}
    </Fragment>
  );
}
