// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { SummaryList } from "@/components/ui/summary-list";
import { modulesById } from "@/config/modules/registry";
import { PaymentLinkDetailDialog } from "@/features/payments/components/payment-link-detail-dialog";
import { PaymentLinkStatusPill } from "@/features/payments/components/payment-link-status-pill";
import { PaymentWorkspaceNav } from "@/features/payments/components/payment-workspace-nav";
import { paymentLinkStatusOptions } from "@/features/payments/constants";
import { getPaymentLinkMetrics } from "@/features/payments/lib/payment-metrics";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency, formatNumber } from "@/lib/format";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";
import { updateOrderPaymentStatus } from "@/lib/store/orders";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const paymentLinksModuleConfig = modulesById["payment-links"];

const paymentLinkDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function PaymentLinkSortableHeader({
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

export function PaymentLinksPage({ initialQuery = "" }) {
  const [t, n] = useState(initialQuery);
  const [r, i] = useState("");
  const [a, o] = useState(false);
  const [s, c] = useState("");
  const [u, d] = useState(1);
  const [f, p] = useState(1);
  const [m, h] = useState(8);
  const [g, _] = useState(0);
  const [v, y] = useState(null);
  const b = useMemo(
    () =>
      listRecords("payment-links", {
        archived: a,
      }),
    [a, g],
  );
  const x = useMemo(() => listRecords("payment-links"), [g]);
  const S = getPaymentLinkMetrics(x);
  const C = [
    ["Payment links", x.length, `${S.activeCount} active`],
    [
      "Awaiting payment",
      formatCurrency(S.outstanding, 2),
      "Across active requests",
    ],
    [
      "Collected value",
      formatCurrency(S.paidValue, 2),
      "Marked paid in this demo",
    ],
    ["Drafts", S.drafts, "Ready to review"],
  ];
  const w = useMemo(() => {
    let e = [...b];
    if (t) {
      const n = t.toLowerCase();
      e = e.filter((e) =>
        [
          e.name,
          e.recipient,
          e.description,
          e.currency,
          e.status,
          getRecordLabel("orders", e.orderId),
        ]
          .join(" ")
          .toLowerCase()
          .includes(n),
      );
    }
    if (r) {
      e = e.filter((e) => e.status === r);
    }
    if (s) {
      e.sort((e, t) => {
        const n = (e, t) =>
          t === "amount"
            ? Number(e.amount || 0)
            : t === "expires"
              ? Date.parse(String(e.expires || "")) || 0
              : t === "order"
                ? getRecordLabel("orders", e.orderId)
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
  }, [b, t, r, s, u]);
  const T = Math.max(1, Math.ceil(w.length / m));
  const E = Math.min(f, T);
  const D = w.slice((E - 1) * m, E * m);
  const O = w.length ? (E - 1) * m + 1 : 0;
  const k = Math.min(E * m, w.length);
  const A = () => _((e) => e + 1);
  const j = (e) => {
    d((t) => (s === e && t === 1 ? -1 : 1));
    c(e);
    p(1);
  };
  const M = async (e) => {
    const t = `https://example.com/pay/${encodeURIComponent(e.id)}`;
    try {
      await navigator.clipboard.writeText(t);
      showToast("Demo payment URL copied.");
    } catch {
      showToast("Copy is unavailable in this browser.");
    }
  };
  const N = (e) => {
    try {
      if (["Paid", "Cancelled", "Expired"].includes(String(e.status || "")))
        throw Error(
          `This payment link is already ${String(e.status || "").toLowerCase()}.`,
        );
      const t = Math.max(1, Number(e.maxUses || 1));
      const n = Math.min(t, Number(e.uses || 0) + 1);
      if (
        (saveRecord(
          "payment-links",
          {
            status: n >= t ? "Paid" : "Active",
            uses: n,
          },
          e.id,
        ),
        e.orderId)
      ) {
        const t = findRecord("orders", String(e.orderId || ""));
        if (t && t.payment !== "Paid") {
          updateOrderPaymentStatus(String(e.orderId), "Paid");
        }
      }
      A();
      showToast("Payment link marked paid in this browser.");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Payment link could not be updated.",
      );
    }
  };
  const ee = (e) => {
    try {
      if (e.status === "Paid")
        throw Error("A paid payment link cannot be expired.");
      saveRecord(
        "payment-links",
        {
          status: "Expired",
        },
        e.id,
      );
      A();
      showToast("Payment link expired.");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Payment link could not be expired.",
      );
    }
  };
  const te = (e, t) => {
    try {
      archiveRecords("payment-links", [e.id], t);
      A();
      showToast(t ? "Payment link restored." : "Payment link archived.");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Payment link could not be archived.",
      );
    }
  };
  const ne = () => {
    downloadFile(
      "veylix-payment-links.csv",
      "﻿" +
        buildCsv(
          w.map((e) => ({
            name: e.name,
            recipient: e.recipient,
            description: e.description,
            amount: e.amount,
            currency: e.currency,
            order: e.orderId ? getRecordLabel("orders", e.orderId) : "",
            uses: e.uses,
            maxUses: e.maxUses,
            expires: e.expires,
            status: e.status,
          })),
          [
            "name",
            "recipient",
            "description",
            "amount",
            "currency",
            "order",
            "uses",
            "maxUses",
            "expires",
            "status",
          ],
          [
            "Name",
            "Recipient",
            "Description",
            "Amount",
            "Currency",
            "Order",
            "Uses",
            "Maximum uses",
            "Expires",
            "Status",
          ],
        ),
    );
    showToast("Filtered payment links exported.");
  };
  const re = (e) =>
    a
      ? [
          {
            label: "Restore",
            icon: "check-circle",
            onClick: () => te(e, true),
          },
        ]
      : [
          {
            label: "View link",
            icon: "eye",
            onClick: () =>
              y({
                mode: "payment-detail",
                recordId: e.id,
              }),
          },
          {
            label: "Edit link",
            icon: "pencil",
            onClick: () =>
              y({
                mode: "edit",
                recordId: e.id,
              }),
          },
          {
            label: "Copy demo URL",
            icon: "copy",
            onClick: () => void M(e),
          },
          ...(["Paid", "Cancelled", "Expired"].includes(String(e.status || ""))
            ? []
            : [
                {
                  label: "Mark paid",
                  icon: "check-circle",
                  onClick: () => N(e),
                },
                {
                  label: "Expire link",
                  icon: "timer",
                  onClick: () => ee(e),
                },
              ]),
          {
            label: "Archive link",
            icon: "trash",
            danger: true,
            separatorBefore: true,
            onClick: () => te(e, false),
          },
        ];
  return (
    <Fragment>
      <CommercePageHeading
        title="Payment links"
        onExport={ne}
        onCreate={() =>
          y({
            mode: "create",
          })
        }
        createLabel="Create payment link"
      />
      <PaymentWorkspaceNav active="payment-links" />
      <SummaryList items={C} />
      <section className="glass-card payment-filter-card">
        <div className="c-toolbar payment-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter by status</span>
            <select
              value={r}
              onChange={(e) => {
                i(e.currentTarget.value);
                p(1);
              }}
            >
              <option value="">All statuses</option>
              {paymentLinkStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-search payment-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search links, recipient, order..."
              value={t}
              aria-label="Search payment links"
              onChange={(e) => {
                n(e.currentTarget.value);
                p(1);
              }}
            />
          </label>
          <label className="c-archive-toggle">
            <input
              type="checkbox"
              checked={a}
              onChange={(e) => {
                o(e.currentTarget.checked);
                p(1);
              }}
            />
            {" Archived"}
          </label>
        </div>
      </section>
      <section className="glass-card c-resource payment-resource">
        <div className="payment-list-heading">
          <div>
            <span>PAYMENT REQUESTS</span>
            <h2>Payment links</h2>
            <p>
              Share controlled payment requests while keeping amount, recipient,
              expiry and usage visible.
            </p>
          </div>
          <small>
            {formatNumber(w.length)}
            {" matching links"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="table-scroll c-table-scroll payment-link-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Payment links"
          >
            {w.length ? (
              <table className="c-table payment-link-table">
                <thead>
                  <tr>
                    <PaymentLinkSortableHeader
                      label="Payment request"
                      sortKey="name"
                      sort={s}
                      direction={u}
                      onSort={j}
                    />
                    <PaymentLinkSortableHeader
                      label="Recipient"
                      sortKey="recipient"
                      sort={s}
                      direction={u}
                      onSort={j}
                    />
                    <PaymentLinkSortableHeader
                      label="Amount"
                      sortKey="amount"
                      sort={s}
                      direction={u}
                      onSort={j}
                    />
                    <PaymentLinkSortableHeader
                      label="Order"
                      sortKey="order"
                      sort={s}
                      direction={u}
                      onSort={j}
                    />
                    <th>Uses</th>
                    <PaymentLinkSortableHeader
                      label="Expires"
                      sortKey="expires"
                      sort={s}
                      direction={u}
                      onSort={j}
                    />
                    <PaymentLinkSortableHeader
                      label="Status"
                      sortKey="status"
                      sort={s}
                      direction={u}
                      onSort={j}
                    />
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {D.map((e) => {
                    const t = e.orderId
                      ? findRecord("orders", String(e.orderId || ""))
                      : void 0;
                    return (
                      <tr key={e.id}>
                        <td>
                          <button
                            type="button"
                            className="payment-link-name"
                            onClick={() =>
                              y({
                                mode: "payment-detail",
                                recordId: e.id,
                              })
                            }
                          >
                            <span>
                              <Icon name="share" />
                            </span>
                            <span>
                              <strong>{String(e.name || "")}</strong>
                              <small>
                                {String(e.description || "Payment request")}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className="payment-recipient">
                            {String(e.recipient || "No recipient")}
                          </span>
                        </td>
                        <td>
                          <strong>
                            {formatCurrency(Number(e.amount || 0), 2)}
                          </strong>
                          <small className="payment-currency">
                            {String(e.currency || "USD")}
                          </small>
                        </td>
                        <td>
                          <span className="payment-order-link">
                            {String(t?.number || "Standalone")}
                          </span>
                        </td>
                        <td>
                          <span className="payment-use-count">
                            {formatNumber(Number(e.uses || 0))}
                            {" / "}
                            {formatNumber(Number(e.maxUses || 1))}
                          </span>
                        </td>
                        <td>
                          <span className="payment-date">
                            {e.expires
                              ? paymentLinkDateFormatter.format(
                                  new Date(`${String(e.expires)}T00:00:00`),
                                )
                              : "No expiry"}
                          </span>
                        </td>
                        <td>
                          <PaymentLinkStatusPill
                            value={String(e.status || "Draft")}
                          />
                        </td>
                        <td className="product-actions-cell payment-actions-cell">
                          <RowActionsMenu
                            label={String(e.name || "payment link")}
                            actions={re(e)}
                            triggerClassName="payment-row-menu"
                            panelClassName="payment-row-menu-panel"
                            estimatedHeight={390}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="c-empty">
                <Icon name="share" />
                <h3>
                  {a ? "No archived payment links" : "No payment links match"}
                </h3>
                <p>Try another search or status filter.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {O}–{k}
              {" of "}
              {w.length}
              {" payment links"}
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
                disabled={E === 1}
                onClick={() => p(Math.max(1, E - 1))}
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
                onClick={() => p(Math.min(T, E + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {v?.mode === "payment-detail" ? (
        <PaymentLinkDetailDialog
          id={v.recordId}
          onClose={() => y(null)}
          onEdit={(e) =>
            y({
              mode: "edit",
              recordId: e,
            })
          }
        />
      ) : null}
      {v && v.mode !== "payment-detail" ? (
        <ResourceRecordDialog
          module={paymentLinksModuleConfig}
          mode={v.mode}
          recordId={v.recordId}
          onClose={() => y(null)}
          onChanged={A}
          onEdit={(e) =>
            y({
              mode: "edit",
              recordId: e,
            })
          }
        />
      ) : null}
    </Fragment>
  );
}
