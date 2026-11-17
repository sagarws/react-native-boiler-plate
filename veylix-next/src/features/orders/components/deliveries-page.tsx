// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { modulesById } from "@/config/modules/registry";
import { DeliveryExceptionDialog } from "@/features/orders/components/delivery-exception-dialog";
import {
  ShipmentStatusPill,
  ShippingSortableHeader,
} from "@/features/orders/components/shipment-badges";
import {
  ShippingSummaryGrid,
  ShippingWorkspaceNav,
} from "@/features/orders/components/shipping-workspace-nav";
import { deliveryStatusOptions } from "@/features/orders/constants/shipping";
import {
  copyDeliveryTrackingNumber,
  formatShippingDate,
  getNextDeliveryAction,
  getShipmentCustomer,
  getShipmentOrder,
} from "@/features/orders/lib/shipping";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { updateDeliveryStatus } from "@/lib/store/orders";
import { archiveRecords } from "@/lib/store/records";

export function DeliveriesPage({ initialQuery = "" }) {
  const t = modulesById.deliveries;
  const [n, r] = useState(initialQuery);
  const [i, a] = useState("");
  const [o, s] = useState("");
  const [c, u] = useState("");
  const [d, f] = useState(1);
  const [p, m] = useState(1);
  const [h, g] = useState(8);
  const [_, v] = useState(false);
  const [y, b] = useState(0);
  const [x, S] = useState(null);
  const [C, w] = useState(null);
  const T = useMemo(() => listRecords("deliveries"), [y]);
  const E = useMemo(
    () =>
      listRecords("deliveries", {
        archived: _,
      }),
    [_, y],
  );
  const D = useMemo(
    () => [
      ...new Set(
        listRecords("deliveries")
          .map((e) => String(e.courier || ""))
          .filter(Boolean),
      ),
    ],
    [y],
  );
  const O = useMemo(() => {
    let e = [...E];
    if (n) {
      const t = n.toLowerCase();
      e = e.filter((e) => {
        const n = getShipmentOrder(e);
        const r = getShipmentCustomer(n);
        return [
          n?.number,
          r?.name,
          e.courier,
          e.service,
          e.tracking,
          e.milestone,
          e.status,
          e.exceptionType,
          e.exceptionNote,
        ]
          .join(" ")
          .toLowerCase()
          .includes(t);
      });
    }
    if (i) {
      e = e.filter((e) => e.status === i);
    }
    if (o) {
      e = e.filter((e) => e.courier === o);
    }
    if (c) {
      e.sort((e, t) => {
        const n = (e, t) =>
          t === "order"
            ? String(getShipmentOrder(e)?.number || "")
            : ["eta", "dispatchDate"].includes(t)
              ? Date.parse(String(e[t] || "")) || 0
              : typeof e[t] == "number"
                ? Number(e[t])
                : String(e[t] || "");
        const r = n(e, c);
        const i = n(t, c);
        return (
          d *
          (typeof r == "number" && typeof i == "number"
            ? r - i
            : String(r).localeCompare(String(i)))
        );
      });
    }
    return e;
  }, [E, n, i, o, c, d]);
  const k = Math.max(1, Math.ceil(O.length / h));
  const A = Math.min(p, k);
  const j = O.slice((A - 1) * h, A * h);
  const M = O.length ? (A - 1) * h + 1 : 0;
  const N = Math.min(A * h, O.length);
  const ee = () => b((e) => e + 1);
  const te = (e, t) => {
    e(t);
    m(1);
  };
  const ne = (e) => {
    f((t) => (c === e && t === 1 ? -1 : 1));
    u(e);
    m(1);
  };
  const re = T.filter((e) =>
    [
      "Shipped",
      "In transit",
      "Out for delivery",
      "Delayed",
      "Delivery attempted",
    ].includes(String(e.status || "")),
  ).length;
  const ie = T.filter((e) => e.status === "Out for delivery").length;
  const ae = T.filter((e) => e.status === "Delivered").length;
  const oe = T.filter(
    (e) =>
      ["Delayed", "Failed", "Delivery attempted"].includes(
        String(e.status || ""),
      ) ||
      (e.exceptionType && e.exceptionType !== "None"),
  ).length;
  const se = [
    {
      icon: "truck",
      label: "Active shipments",
      value: formatNumber(re),
      detail: "Carrier handoff in progress",
      tone: "blue",
    },
    {
      icon: "timer",
      label: "Out for delivery",
      value: formatNumber(ie),
      detail: "Final-mile shipments",
      tone: "amber",
    },
    {
      icon: "check-circle",
      label: "Delivered",
      value: formatNumber(ae),
      detail: "Completed delivery events",
      tone: "green",
    },
    {
      icon: "info",
      label: "Exceptions",
      value: formatNumber(oe),
      detail: oe ? "Needs team review" : "No delivery exceptions",
      tone: "red",
    },
  ];
  const ce = (e, t, n = "", r) => {
    try {
      const i = updateDeliveryStatus(e, t, n);
      ee();
      showToast(r || `Delivery moved to ${i.status}.`);
    } catch (e) {
      showToast(
        e instanceof Error
          ? e.message
          : "This delivery update could not be completed.",
      );
    }
  };
  const le = () => {
    downloadFile(
      "veylix-delivery-tracking.csv",
      "﻿" +
        buildCsv(
          O.map((e) => ({
            order: String(getShipmentOrder(e)?.number || ""),
            method: e.method,
            courier: e.courier,
            service: e.service,
            tracking: e.tracking,
            milestone: e.milestone,
            dispatchDate: e.dispatchDate,
            eta: e.eta,
            deliveredDate: e.deliveredDate,
            exceptionType: e.exceptionType,
            exceptionNote: e.exceptionNote,
            status: e.status,
          })),
          [
            "order",
            "method",
            "courier",
            "service",
            "tracking",
            "milestone",
            "dispatchDate",
            "eta",
            "deliveredDate",
            "exceptionType",
            "exceptionNote",
            "status",
          ],
          [
            "Order",
            "Method",
            "Courier",
            "Service",
            "Tracking",
            "Milestone",
            "Dispatch date",
            "ETA",
            "Delivered date",
            "Exception type",
            "Exception note",
            "Status",
          ],
        ),
    );
    showToast("Filtered delivery tracking exported.");
  };
  const ue = (e) => {
    if (_)
      return [
        {
          label: "Restore",
          icon: "check-circle",
          onClick: () => {
            archiveRecords("deliveries", [e.id], true);
            ee();
            showToast("Delivery restored.");
          },
        },
      ];
    const t = getNextDeliveryAction(e);
    const n = getShipmentOrder(e);
    const r = [
      {
        label: "View shipment",
        icon: "eye",
        onClick: () =>
          S({
            mode: "detail",
            id: e.id,
          }),
      },
      {
        label: "Edit tracking",
        icon: "pencil",
        onClick: () =>
          S({
            mode: "edit",
            id: e.id,
          }),
      },
      {
        label: "View order",
        icon: "clipboard-text",
        onClick: () =>
          navigate(
            `/commerce/orders?q=${encodeURIComponent(String(n?.number || ""))}`,
          ),
      },
      ...(e.tracking
        ? [
            {
              label: "Copy tracking",
              icon: "copy",
              onClick: () => copyDeliveryTrackingNumber(e),
            },
          ]
        : []),
    ];
    if (t) {
      r.push({
        label: t[1],
        icon: t[2],
        separatorBefore: true,
        onClick: () => ce(e.id, t[0]),
      });
    }
    if (
      ["Delayed", "Delivery attempted", "Failed"].includes(
        String(e.status || ""),
      )
    ) {
      r.push({
        label: "Clear exception",
        icon: "check-circle",
        onClick: () =>
          ce(
            e.id,
            "In transit",
            "",
            "Exception cleared. Shipment is in transit.",
          ),
      });
    } else if (e.status !== "Delivered") {
      r.push({
        label: "Report delay",
        icon: "info",
        onClick: () =>
          ce(
            e.id,
            "Delayed",
            "Shipment flagged for carrier follow-up.",
            "Delivery exception recorded.",
          ),
      });
    }
    r.push({
      label: "Open fulfillment",
      icon: "package",
      onClick: () =>
        navigate(
          `/commerce/fulfillment?q=${encodeURIComponent(String(n?.number || ""))}`,
        ),
    });
    return r;
  };
  return (
    <Fragment>
      <CommercePageHeading
        title={"Delivery & shipment tracking"}
        onExport={le}
        onCreate={() =>
          S({
            mode: "create",
          })
        }
        createLabel="Add delivery"
      />
      <ShippingWorkspaceNav active="deliveries" />
      <ShippingSummaryGrid items={se} />
      <section className="glass-card shipping-filter-card">
        <div className="c-toolbar shipping-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter carrier</span>
            <select value={o} onChange={(e) => te(s, e.currentTarget.value)}>
              <option value="">All carriers</option>
              {D.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter status</span>
            <select value={i} onChange={(e) => te(a, e.currentTarget.value)}>
              <option value="">All statuses</option>
              {deliveryStatusOptions.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-search shipping-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search order, customer, tracking..."
              value={n}
              onChange={(e) => te(r, e.currentTarget.value)}
              aria-label="Search delivery tracking"
            />
          </label>
          <label className="c-archive-toggle">
            <input
              type="checkbox"
              checked={_}
              onChange={(e) => {
                v(e.currentTarget.checked);
                m(1);
              }}
            />
            {" Archived"}
          </label>
        </div>
      </section>
      <section className="glass-card c-resource shipping-resource">
        <div className="shipping-section-heading">
          <div>
            <span>LAST MILE</span>
            <h2>Shipment tracking</h2>
            <p>
              Carrier milestone, expected delivery and exception handling
              without leaving the order context.
            </p>
          </div>
          <small>
            {formatNumber(O.length)}
            {" matching deliveries"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="table-scroll c-table-scroll shipment-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Delivery tracking"
          >
            {O.length ? (
              <table className="c-table shipment-table delivery-table">
                <thead>
                  <tr>
                    <ShippingSortableHeader
                      label="Order"
                      sortKey="order"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <ShippingSortableHeader
                      label="Carrier / service"
                      sortKey="courier"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <th>Tracking</th>
                    <ShippingSortableHeader
                      label="Milestone"
                      sortKey="milestone"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <ShippingSortableHeader
                      label="ETA"
                      sortKey="eta"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <th>Exception</th>
                    <ShippingSortableHeader
                      label="Status"
                      sortKey="status"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {j.map((e) => {
                    const t = getShipmentOrder(e);
                    const n = getShipmentCustomer(t);
                    const r = !!(e.exceptionType && e.exceptionType !== "None");
                    return (
                      <tr key={e.id}>
                        <td>
                          <button
                            type="button"
                            className="shipment-order-cell"
                            onClick={() =>
                              navigate(
                                `/commerce/orders?q=${encodeURIComponent(String(t?.number || ""))}`,
                              )
                            }
                          >
                            <strong>#{String(t?.number || "Unknown")}</strong>
                            <small>{String(n?.name || "Customer")}</small>
                          </button>
                        </td>
                        <td>
                          <span className="shipment-service">
                            <strong>
                              {String(e.courier || "Not assigned")}
                            </strong>
                            <small>
                              {String(
                                e.service || e.method || "Service pending",
                              )}
                            </small>
                          </span>
                        </td>
                        <td>
                          <span className="shipment-tracking">
                            <strong>
                              {String(e.tracking || "Not assigned")}
                            </strong>
                            <small>{String(e.method || "Delivery")}</small>
                          </span>
                        </td>
                        <td>
                          <span className="shipment-milestone">
                            <strong>
                              {String(e.milestone || "Label created")}
                            </strong>
                            <small>
                              {"Dispatched "}
                              {formatShippingDate(e.dispatchDate)}
                            </small>
                          </span>
                        </td>
                        <td>
                          <span className="shipment-date">
                            <strong>{formatShippingDate(e.eta)}</strong>
                            <small>
                              {e.deliveredDate
                                ? `Delivered ${formatShippingDate(e.deliveredDate)}`
                                : "Expected delivery"}
                            </small>
                          </span>
                        </td>
                        <td>
                          {r ? (
                            <button
                              type="button"
                              className="delivery-exception"
                              onClick={() => w(e.id)}
                            >
                              <Icon name="info" />
                              <span>
                                <strong>{String(e.exceptionType)}</strong>
                                <small>
                                  {String(e.exceptionNote || "Needs review")}
                                </small>
                              </span>
                            </button>
                          ) : (
                            <span className="delivery-exception clear">
                              <Icon name="check-circle" />
                              <span>
                                <strong>Clear</strong>
                                <small>No exception</small>
                              </span>
                            </span>
                          )}
                        </td>
                        <td>
                          <ShipmentStatusPill value={e.status} />
                        </td>
                        <td className="product-actions-cell shipment-actions-cell">
                          <RowActionsMenu
                            label={`delivery ${String(t?.number || e.id)}`}
                            actions={ue(e)}
                            triggerClassName="shipment-row-menu"
                            panelClassName="shipment-row-menu-panel"
                            estimatedHeight={400}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="c-empty">
                <Icon name="truck" />
                <h3>No deliveries match</h3>
                <p>Try another search, carrier or status filter.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {M}–{N}
              {" of "}
              {O.length}
              {" deliveries"}
            </span>
            <label>
              {"Per page "}
              <select
                value={h}
                onChange={(e) => {
                  g(Number(e.currentTarget.value));
                  m(1);
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
                disabled={A === 1}
                onClick={() => m(Math.max(1, A - 1))}
              >
                Previous
              </button>
              <span>
                {A}
                {" / "}
                {k}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={A === k}
                onClick={() => m(Math.min(k, A + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {x?.mode === "create" ? (
        <ResourceRecordDialog
          module={t}
          mode="create"
          onClose={() => S(null)}
          onChanged={ee}
        />
      ) : null}
      {x?.mode === "edit" && x.id ? (
        <ResourceRecordDialog
          module={t}
          mode="edit"
          recordId={x.id}
          onClose={() => S(null)}
          onChanged={ee}
        />
      ) : null}
      {x?.mode === "detail" && x.id ? (
        <ResourceRecordDialog
          module={t}
          mode="detail"
          recordId={x.id}
          onClose={() => S(null)}
          onChanged={ee}
          onEdit={(e) =>
            S({
              mode: "edit",
              id: e,
            })
          }
        />
      ) : null}
      {C ? (
        <DeliveryExceptionDialog
          id={C}
          onClose={() => w(null)}
          onEdit={(e) => {
            w(null);
            S({
              mode: "edit",
              id: e,
            });
          }}
        />
      ) : null}
    </Fragment>
  );
}
