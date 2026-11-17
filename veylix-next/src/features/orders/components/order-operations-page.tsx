// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { modulesById } from "@/config/modules/registry";
import { AbandonedCartRecoveryFunnel } from "@/features/orders/components/abandoned-cart-recovery-funnel";
import { OrderOperationsDialogHost } from "@/features/orders/components/order-operations-dialog-host";
import { OrderOpsFlowPanel } from "@/features/orders/components/order-ops-flow-panel";
import { OrderOpsMetricGrid } from "@/features/orders/components/order-ops-metric-grid";
import { orderOperationStatusOptions } from "@/features/orders/constants/order-operations";
import {
  formatOrderOpsDate,
  getOrderOpsCustomer,
  matchesOrderOpsQuery,
} from "@/features/orders/lib/order-operations";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency, formatNumber } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { findRecord, getRecordLabel, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";
import { saveRecord } from "@/lib/store/records";

export function OrderOperationsPage({ moduleId, initialQuery = "" }) {
  const n = modulesById[moduleId];
  const [r, i] = useState(initialQuery);
  const [a, o] = useState("");
  const [s, c] = useState(1);
  const [u, d] = useState(8);
  const [f, p] = useState(false);
  const [m, h] = useState(0);
  const [g, _] = useState(null);
  const [v, y] = useState(null);
  const b = useMemo(() => listRecords(moduleId), [moduleId, m]);
  const x = useMemo(
    () =>
      listRecords(moduleId, {
        archived: f,
      }),
    [moduleId, f, m],
  );
  const S = useMemo(
    () =>
      x.filter((t) => {
        if (a && t.status !== a) return false;
        if (moduleId === "abandoned")
          return matchesOrderOpsQuery(t, r, [
            getRecordLabel("customers", t.customerId),
            t.email,
          ]);
        const n = findRecord("orders", t.orderId);
        const i = getOrderOpsCustomer(n);
        return matchesOrderOpsQuery(t, r, [
          n?.number,
          i?.name,
          i?.email,
          n?.status,
          n?.payment,
        ]);
      }),
    [x, a, moduleId, r],
  );
  const C = Math.max(1, Math.ceil(S.length / u));
  const w = Math.min(s, C);
  const T = S.slice((w - 1) * u, w * u);
  const E = S.length ? (w - 1) * u + 1 : 0;
  const D = Math.min(w * u, S.length);
  const O = () => h((e) => e + 1);
  const k = (e) => {
    i(e);
    c(1);
  };
  const A = (e) => {
    o(e);
    c(1);
  };
  const j = (t, n, r) => {
    try {
      saveRecord(moduleId, n, t);
      O();
      showToast(r);
    } catch (e) {
      showToast(
        e instanceof Error
          ? e.message
          : "This operation could not be completed.",
      );
    }
  };
  const M = (e) => {
    const t = findRecord("abandoned", e);
    const n = ["No outreach", "Reminder 1 sent", "Reminder 2 sent"];
    const r = Math.max(0, n.indexOf(String(t?.recoveryStage || "No outreach")));
    const i = n[Math.min(n.length - 1, r + 1)];
    j(
      e,
      {
        recoveryStage: i,
        status: "In recovery",
        lastContact: new Date().toISOString().slice(0, 10),
      },
      `${i} recorded.`,
    );
  };
  const N = (t) => {
    if (moduleId === "refunds") {
      const n = ["Completed", "Rejected"].includes(String(t.status || ""));
      const r = [
        {
          label: "Review refund",
          icon: "eye",
          onClick: () =>
            y({
              mode: "review",
              moduleId: moduleId,
              id: t.id,
            }),
        },
        {
          label: "Open order",
          icon: "clipboard-text",
          onClick: () =>
            navigate(
              `/commerce/orders?q=${encodeURIComponent(String(getRecordLabel("orders", t.orderId) || t.orderId))}`,
            ),
        },
        {
          label: "Edit request",
          icon: "pencil",
          onClick: () =>
            _({
              mode: "edit",
              id: t.id,
            }),
        },
      ];
      if (!n) {
        if (t.status === "Requested") {
          r.push({
            label: "Move to review",
            icon: "timer",
            separatorBefore: true,
            onClick: () =>
              j(
                t.id,
                {
                  status: "Under review",
                },
                "Refund moved to under review.",
              ),
          });
        }
        if (["Requested", "Under review"].includes(String(t.status || ""))) {
          r.push({
            label: "Approve for processing",
            icon: "check-circle",
            separatorBefore: t.status !== "Requested",
            onClick: () =>
              j(
                t.id,
                {
                  status: "Approved for processing",
                },
                "Refund approved for processing.",
              ),
          });
        }
        if (t.status === "Approved for processing") {
          r.push({
            label: "Start processing",
            icon: "arrow-right",
            separatorBefore: true,
            onClick: () =>
              j(
                t.id,
                {
                  status: "Processing",
                  providerStatus:
                    t.providerStatus === "Not started"
                      ? "Processing"
                      : t.providerStatus,
                },
                "Refund moved to processing.",
              ),
          });
        }
        if (
          ["Approved for processing", "Processing"].includes(
            String(t.status || ""),
          )
        ) {
          r.push({
            label: "Complete refund",
            icon: "check-circle",
            separatorBefore: t.status === "Approved for processing",
            onClick: () =>
              y({
                mode: "refund-complete",
                id: t.id,
              }),
          });
        }
        r.push({
          label: "Reject request",
          icon: "x",
          danger: true,
          separatorBefore: true,
          onClick: () =>
            j(
              t.id,
              {
                status: "Rejected",
              },
              "Refund request rejected.",
            ),
        });
      }
      return r;
    }
    if (moduleId === "cancellations") {
      const n = ["Approved", "Rejected"].includes(String(t.status || ""));
      const r = [
        {
          label: "Review cancellation",
          icon: "eye",
          onClick: () =>
            y({
              mode: "review",
              moduleId: moduleId,
              id: t.id,
            }),
        },
        {
          label: "Open order",
          icon: "clipboard-text",
          onClick: () =>
            navigate(
              `/commerce/orders?q=${encodeURIComponent(String(getRecordLabel("orders", t.orderId) || t.orderId))}`,
            ),
        },
        {
          label: "Edit request",
          icon: "pencil",
          onClick: () =>
            _({
              mode: "edit",
              id: t.id,
            }),
        },
      ];
      if (!n) {
        if (t.status === "Requested") {
          r.push({
            label: "Move to review",
            icon: "timer",
            separatorBefore: true,
            onClick: () =>
              j(
                t.id,
                {
                  status: "Under review",
                },
                "Cancellation moved to under review.",
              ),
          });
        }
        r.push(
          {
            label: "Approve cancellation",
            icon: "check-circle",
            separatorBefore: t.status !== "Requested",
            onClick: () =>
              y({
                mode: "cancellation-approve",
                id: t.id,
              }),
          },
          {
            label: "Reject request",
            icon: "x",
            danger: true,
            onClick: () =>
              j(
                t.id,
                {
                  status: "Rejected",
                },
                "Cancellation request rejected.",
              ),
          },
        );
      }
      return r;
    }
    const n = ["Recovered", "Expired"].includes(String(t.status || ""));
    const r = [
      {
        label: "Open recovery",
        icon: "eye",
        onClick: () =>
          y({
            mode: "review",
            moduleId: moduleId,
            id: t.id,
          }),
      },
    ];
    if (t.customerId) {
      r.push({
        label: "Open customer",
        icon: "users",
        onClick: () =>
          navigate(
            `/commerce/customers?q=${encodeURIComponent(String(getRecordLabel("customers", t.customerId) || t.customerId))}`,
          ),
      });
    }
    if (!n) {
      r.push(
        {
          label:
            t.recoveryStage === "No outreach"
              ? "Send first reminder"
              : "Advance reminder",
          icon: "paper-plane",
          separatorBefore: true,
          onClick: () => M(t.id),
        },
        {
          label: "Prepare offer",
          icon: "seal-percent",
          onClick: () =>
            j(
              t.id,
              {
                recoveryStage: "Offer prepared",
                status: "In recovery",
                incentive:
                  t.incentive === "None" ? "Free shipping" : t.incentive,
              },
              "Recovery offer prepared for review.",
            ),
        },
        {
          label: "Mark recovered",
          icon: "check-circle",
          onClick: () =>
            y({
              mode: "abandoned-recovered",
              id: t.id,
            }),
        },
        {
          label: "Expire checkout",
          icon: "x",
          danger: true,
          onClick: () =>
            j(
              t.id,
              {
                status: "Expired",
                recoveryStage: "Expired",
              },
              "Recovery case updated.",
            ),
        },
      );
    }
    return r;
  };
  const ee = () => {
    const t =
      moduleId === "refunds"
        ? [
            "order",
            "customer",
            "amount",
            "reason",
            "liability",
            "refundMethod",
            "inventoryAction",
            "providerStatus",
            "status",
            "requestedAt",
            "processedAt",
          ]
        : moduleId === "cancellations"
          ? [
              "order",
              "customer",
              "reason",
              "requestedBy",
              "orderStatus",
              "payment",
              "liability",
              "inventoryAction",
              "refundAction",
              "status",
              "requestedAt",
              "decidedAt",
            ]
          : [
              "checkoutRef",
              "customer",
              "email",
              "value",
              "items",
              "channel",
              "source",
              "recoveryStage",
              "incentive",
              "lastContact",
              "nextAction",
              "recoveredOrder",
              "status",
              "date",
            ];
    const n = S.map((t) => {
      const n =
        moduleId === "abandoned" ? void 0 : findRecord("orders", t.orderId);
      const r =
        moduleId === "abandoned"
          ? findRecord("customers", t.customerId)
          : getOrderOpsCustomer(n);
      return {
        ...t,
        order: n?.number || "",
        customer: r?.name || "",
        orderStatus: n?.status || "",
        payment: n?.payment || "",
        recoveredOrder: getRecordLabel("orders", t.recoveredOrderId),
      };
    });
    downloadFile(
      `veylix-${moduleId}.csv`,
      "﻿" +
        buildCsv(
          n,
          t,
          t.map((e) =>
            e.replace(/([A-Z])/g, " $1").replace(/^./, (e) => e.toUpperCase()),
          ),
        ),
    );
    showToast("Filtered records exported.");
  };
  const te = {
    refunds: "Search order, customer, reason...",
    cancellations: "Search order, customer, reason...",
    abandoned: "Search checkout, customer or basket...",
  };
  return (
    <Fragment>
      <CommercePageHeading
        title={n.title}
        onExport={ee}
        onCreate={() =>
          _({
            mode: "create",
          })
        }
        createLabel={
          moduleId === "refunds"
            ? "New refund request"
            : moduleId === "cancellations"
              ? "New cancellation request"
              : "Add recovery case"
        }
      />
      <OrderOpsMetricGrid moduleId={moduleId} rows={b} />
      {moduleId === "abandoned" ? (
        <AbandonedCartRecoveryFunnel rows={b} />
      ) : (
        <OrderOpsFlowPanel moduleId={moduleId} />
      )}
      <section className="glass-card ops-filter-card">
        <div className="c-toolbar ops-toolbar">
          <label className="c-search">
            <Icon name="search" />
            <input
              type="search"
              value={r}
              placeholder={te[moduleId]}
              onChange={(e) => k(e.currentTarget.value)}
              aria-label={te[moduleId]}
            />
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter status</span>
            <select value={a} onChange={(e) => A(e.currentTarget.value)}>
              <option value="">All statuses</option>
              {orderOperationStatusOptions[moduleId].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-archive-toggle">
            <input
              type="checkbox"
              checked={f}
              onChange={(e) => {
                p(e.currentTarget.checked);
                c(1);
              }}
            />
            {" Archived"}
          </label>
        </div>
      </section>
      <section className="glass-card c-resource ops-resource">
        <div className="ops-list-heading">
          <div>
            <span>
              {moduleId === "refunds"
                ? "REFUND QUEUE"
                : moduleId === "cancellations"
                  ? "CANCELLATION QUEUE"
                  : "RECOVERY QUEUE"}
            </span>
            <h2>
              {moduleId === "refunds"
                ? "Refund operations"
                : moduleId === "cancellations"
                  ? "Cancellation decisions"
                  : "Abandoned checkout recovery"}
            </h2>
            <p>
              {moduleId === "refunds"
                ? "Review customer intent, financial liability, provider progress and inventory impact in one place."
                : moduleId === "cancellations"
                  ? "Keep timing, fulfillment stage, liability, stock release and refund requirements visible before approval."
                  : "Prioritize basket value, outreach stage and next action without inventing discounts or urgency."}
            </p>
          </div>
          <small>
            {formatNumber(S.length)}
            {" matching "}
            {moduleId === "abandoned" ? "checkouts" : "requests"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="ops-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={n.title}
          >
            {S.length ? (
              <table className="ops-table">
                <thead>
                  <tr>
                    {moduleId === "refunds" ? (
                      <Fragment>
                        <th>{"Order & customer"}</th>
                        <th>Amount</th>
                        <th>Liability</th>
                        <th>Outcome</th>
                        <th>Provider</th>
                        <th>Status</th>
                      </Fragment>
                    ) : moduleId === "cancellations" ? (
                      <Fragment>
                        <th>{"Order & customer"}</th>
                        <th>Request</th>
                        <th>Order state</th>
                        <th>{"Liability & stock"}</th>
                        <th>Payment impact</th>
                        <th>Status</th>
                      </Fragment>
                    ) : (
                      <Fragment>
                        <th>Checkout</th>
                        <th>Basket</th>
                        <th>Channel</th>
                        <th>Recovery stage</th>
                        <th>Next action</th>
                        <th>Status</th>
                      </Fragment>
                    )}
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {T.map((t) => (
                    <OrderOperationsTableRow
                      key={t.id}
                      moduleId={moduleId}
                      row={t}
                      onReview={() =>
                        y({
                          mode: "review",
                          moduleId: moduleId,
                          id: t.id,
                        })
                      }
                      actions={N(t)}
                    />
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="c-empty">
                <Icon
                  name={
                    moduleId === "abandoned"
                      ? "cart"
                      : moduleId === "refunds"
                        ? "arrow-left"
                        : "x"
                  }
                />
                <h3>
                  {moduleId === "abandoned"
                    ? "No checkout matches"
                    : moduleId === "refunds"
                      ? "No refund requests match"
                      : "No cancellation requests match"}
                </h3>
                <p>Try another search or status filter.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination ops-pagination">
            <span>
              {E}–{D}
              {" of "}
              {S.length}{" "}
              {moduleId === "refunds"
                ? "refunds"
                : moduleId === "cancellations"
                  ? "requests"
                  : "checkouts"}
            </span>
            <label>
              {"Per page "}
              <select
                value={u}
                onChange={(e) => {
                  d(Number(e.currentTarget.value));
                  c(1);
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
                disabled={w === 1}
                onClick={() => c(Math.max(1, w - 1))}
              >
                Previous
              </button>
              <span>
                {w}
                {" / "}
                {C}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={w === C}
                onClick={() => c(Math.min(C, w + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {g ? (
        <ResourceRecordDialog
          module={n}
          mode={g.mode}
          recordId={g.id}
          onClose={() => _(null)}
          onChanged={O}
          onEdit={(e) =>
            _({
              mode: "edit",
              id: e,
            })
          }
        />
      ) : null}
      <OrderOperationsDialogHost
        dialog={v}
        onClose={() => y(null)}
        onEdit={(e, t) => {
          y(null);
          _({
            mode: "edit",
            id: t,
          });
        }}
        onChanged={O}
        onAdvanceAbandoned={M}
      />
    </Fragment>
  );
}

function OrderOperationsTableRow({ moduleId, row, onReview, actions }) {
  if (moduleId === "abandoned")
    return (
      <tr>
        <td>
          <button type="button" className="ops-primary-cell" onClick={onReview}>
            <strong>{String(row.checkoutRef || row.id)}</strong>
            <small>
              {String(
                getRecordLabel("customers", row.customerId) ||
                  row.email ||
                  "Guest checkout",
              )}
              {" · "}
              {formatOrderOpsDate(row.date)}
            </small>
          </button>
        </td>
        <td>
          <strong>{formatCurrency(Number(row.value || 0), 2)}</strong>
          <small>
            {String(row.items || `${Number(row.itemCount || 0)} items`)}
          </small>
        </td>
        <td>
          <strong>{String(row.channel || "—")}</strong>
          <small>{String(row.source || "Direct")}</small>
        </td>
        <td>
          <strong>{String(row.recoveryStage || "No outreach")}</strong>
          <small>{String(row.incentive || "None")}</small>
        </td>
        <td>
          <strong>{formatOrderOpsDate(row.nextAction)}</strong>
          <small>
            {row.lastContact
              ? `Last ${formatOrderOpsDate(row.lastContact)}`
              : "No outreach yet"}
          </small>
        </td>
        <td>
          <StatusPill value={String(row.status || "")} />
        </td>
        <td className="ops-actions-cell">
          <RowActionsMenu
            label={String(row.checkoutRef || row.id)}
            actions={actions}
            triggerClassName="ops-row-menu"
            panelClassName="ops-row-menu-panel"
            estimatedHeight={360}
          />
        </td>
      </tr>
    );
  const i = findRecord("orders", row.orderId);
  const a = getOrderOpsCustomer(i);
  return moduleId === "refunds" ? (
    <tr>
      <td>
        <button type="button" className="ops-primary-cell" onClick={onReview}>
          <strong>
            {String(i?.number || getRecordLabel("orders", row.orderId))}
          </strong>
          <small>
            {String(a?.name || "Customer unavailable")}
            {" · "}
            {formatOrderOpsDate(row.requestedAt)}
          </small>
        </button>
      </td>
      <td>
        <strong>{formatCurrency(Number(row.amount || 0), 2)}</strong>
        <small>{String(row.reason || "—")}</small>
      </td>
      <td>
        <strong>{String(row.liability || "Under review")}</strong>
        <small>{String(row.requestedBy || "—")}</small>
      </td>
      <td>
        <strong>{String(row.refundMethod || "—")}</strong>
        <small>{String(row.inventoryAction || "—")}</small>
      </td>
      <td>
        <StatusPill value={String(row.providerStatus || "Not started")} />
      </td>
      <td>
        <StatusPill value={String(row.status || "")} />
      </td>
      <td className="ops-actions-cell">
        <RowActionsMenu
          label={String(i?.number || row.id)}
          actions={actions}
          triggerClassName="ops-row-menu"
          panelClassName="ops-row-menu-panel"
          estimatedHeight={430}
        />
      </td>
    </tr>
  ) : (
    <tr>
      <td>
        <button type="button" className="ops-primary-cell" onClick={onReview}>
          <strong>
            {String(i?.number || getRecordLabel("orders", row.orderId))}
          </strong>
          <small>
            {String(a?.name || "Customer unavailable")}
            {" · "}
            {formatOrderOpsDate(row.requestedAt)}
          </small>
        </button>
      </td>
      <td>
        <strong>{String(row.reason || "—")}</strong>
        <small>{String(row.requestedBy || "—")}</small>
      </td>
      <td>
        <StatusPill value={String(i?.status || "Unknown")} />
        <small>{String(i?.payment || "—")}</small>
      </td>
      <td>
        <strong>{String(row.liability || "Under review")}</strong>
        <small>{String(row.inventoryAction || "—")}</small>
      </td>
      <td>
        <strong>{String(row.refundAction || "—")}</strong>
        <small>{i ? formatCurrency(calculateOrderTotal(i), 2) : "—"}</small>
      </td>
      <td>
        <StatusPill value={String(row.status || "")} />
      </td>
      <td className="ops-actions-cell">
        <RowActionsMenu
          label={String(i?.number || row.id)}
          actions={actions}
          triggerClassName="ops-row-menu"
          panelClassName="ops-row-menu-panel"
          estimatedHeight={380}
        />
      </td>
    </tr>
  );
}
