// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { modulesById } from "@/config/modules/registry";
import { PackingSlipDialog } from "@/features/orders/components/packing-slip-dialog";
import {
  ShipmentPriorityPill,
  ShipmentStatusPill,
  ShippingSortableHeader,
} from "@/features/orders/components/shipment-badges";
import {
  ShippingSummaryGrid,
  ShippingWorkspaceNav,
} from "@/features/orders/components/shipping-workspace-nav";
import { fulfillmentStatusOptions } from "@/features/orders/constants/shipping";
import {
  copyFulfillmentTrackingNumber,
  formatShippingDate,
  getNextFulfillmentAction,
  getOrderUnitCount,
  getShipmentCustomer,
  getShipmentOrder,
} from "@/features/orders/lib/shipping";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { getRecordLabel, listRecords } from "@/lib/store/core";
import { updateFulfillmentStatus } from "@/lib/store/orders";
import { archiveRecords } from "@/lib/store/records";

function FulfillmentStageCard({ rows }) {
  return (
    <section className="glass-card fulfillment-stage-card">
      <div className="shipping-section-heading">
        <div>
          <span>FULFILLMENT FLOW</span>
          <h2>Pick → pack → ship</h2>
          <p>A compact operational view of every shipment stage.</p>
        </div>
        <small>
          {formatNumber(rows.length)}
          {" active records"}
        </small>
      </div>
      <div className="fulfillment-stage-grid">
        {[
          ["Picking", "Pick"],
          ["Packed", "Pack"],
          ["In transit", "Ship"],
          ["Delivered", "Delivered"],
          ["Delayed", "Exceptions"],
        ].map(([t, n]) => {
          const r = rows.filter((e) => e.status === t);
          const i = r.reduce(
            (e, t) => e + getOrderUnitCount(getShipmentOrder(t)),
            0,
          );
          return (
            <div
              key={t}
              className={`fulfillment-stage ${t === "Delayed" ? "danger" : ""}`.trim()}
            >
              <span>{n}</span>
              <strong>{formatNumber(r.length)}</strong>
              <small>
                {formatNumber(i)}
                {" units"}
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function FulfillmentPage({ initialQuery = "" }) {
  const t = modulesById.fulfillment;
  const [n, r] = useState(initialQuery);
  const [i, a] = useState("");
  const [o, s] = useState("");
  const [c, u] = useState("");
  const [d, f] = useState("");
  const [p, m] = useState(1);
  const [h, g] = useState(1);
  const [_, v] = useState(8);
  const [y, b] = useState(false);
  const [x, S] = useState(0);
  const [C, w] = useState(null);
  const [T, E] = useState(null);
  const D = useMemo(() => listRecords("fulfillment"), [x]);
  const O = useMemo(
    () =>
      listRecords("fulfillment", {
        archived: y,
      }),
    [y, x],
  );
  const k = useMemo(
    () => listRecords("warehouses").filter((e) => e.status !== "Paused"),
    [x],
  );
  const A = useMemo(
    () => [
      ...new Set(
        listRecords("fulfillment")
          .map((e) => String(e.carrier || ""))
          .filter(Boolean),
      ),
    ],
    [x],
  );
  const j = useMemo(() => {
    let e = [...O];
    if (n) {
      const t = n.toLowerCase();
      e = e.filter((e) => {
        const n = getShipmentOrder(e);
        const r = getShipmentCustomer(n);
        return [
          n?.number,
          r?.name,
          r?.email,
          e.carrier,
          e.service,
          e.tracking,
          e.pickWave,
          e.status,
          e.exception,
          getRecordLabel("warehouses", e.warehouseId),
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
      e = e.filter((e) => e.warehouseId === o);
    }
    if (c) {
      e = e.filter((e) => e.carrier === c);
    }
    if (d) {
      e.sort((e, t) => {
        const n = (e, t) => {
          const n = getShipmentOrder(e);
          return t === "order"
            ? String(n?.number || "")
            : t === "customer"
              ? String(getShipmentCustomer(n)?.name || "")
              : t === "items"
                ? getOrderUnitCount(n)
                : t === "warehouse"
                  ? getRecordLabel("warehouses", e.warehouseId)
                  : ["shipBy", "eta"].includes(t)
                    ? Date.parse(String(e[t] || "")) || 0
                    : typeof e[t] == "number"
                      ? Number(e[t])
                      : String(e[t] || "");
        };
        const r = n(e, d);
        const i = n(t, d);
        return (
          p *
          (typeof r == "number" && typeof i == "number"
            ? r - i
            : String(r).localeCompare(String(i)))
        );
      });
    }
    return e;
  }, [O, n, i, o, c, d, p]);
  const M = Math.max(1, Math.ceil(j.length / _));
  const N = Math.min(h, M);
  const ee = j.slice((N - 1) * _, N * _);
  const te = j.length ? (N - 1) * _ + 1 : 0;
  const ne = Math.min(N * _, j.length);
  const re = (e, t) => {
    e(t);
    g(1);
  };
  const ie = (e) => {
    m((t) => (d === e && t === 1 ? -1 : 1));
    f(e);
    g(1);
  };
  const ae = () => S((e) => e + 1);
  const oe = [
    {
      icon: "package",
      label: "Ready to pick",
      value: formatNumber(D.filter((e) => e.status === "Picking").length),
      detail: D.some((e) => e.status === "Picking")
        ? "Orders need warehouse attention"
        : "Pick queue is clear",
      tone: "blue",
    },
    {
      icon: "check-circle",
      label: "Packed",
      value: formatNumber(D.filter((e) => e.status === "Packed").length),
      detail: D.some((e) => e.status === "Packed")
        ? "Ready for carrier handoff"
        : "No packed orders waiting",
      tone: "amber",
    },
    {
      icon: "truck",
      label: "In transit",
      value: formatNumber(D.filter((e) => e.status === "In transit").length),
      detail: "Carrier handoff completed",
      tone: "green",
    },
    {
      icon: "info",
      label: "Exceptions",
      value: formatNumber(
        D.filter((e) => e.status === "Delayed" || !!e.exception).length,
      ),
      detail: D.some((e) => e.status === "Delayed" || !!e.exception)
        ? "Review delayed or held shipments"
        : "No shipping exceptions",
      tone: "red",
    },
  ];
  const se = (e, t, n) => {
    try {
      const r = updateFulfillmentStatus(e, t);
      ae();
      showToast(n || `Fulfillment moved to ${r.status}.`);
    } catch (e) {
      showToast(
        e instanceof Error
          ? e.message
          : "This fulfillment update could not be completed.",
      );
    }
  };
  const ce = () => {
    downloadFile(
      "veylix-fulfillment-queue.csv",
      "﻿" +
        buildCsv(
          j.map((e) => {
            const t = getShipmentOrder(e);
            const n = getShipmentCustomer(t);
            return {
              order: t?.number || "",
              customer: n?.name || "",
              warehouse: getRecordLabel("warehouses", e.warehouseId),
              pickWave: e.pickWave,
              priority: e.priority,
              carrier: e.carrier,
              service: e.service,
              tracking: e.tracking,
              packageType: e.packageType,
              weight: e.weight,
              shipBy: e.shipBy,
              eta: e.eta,
              exception: e.exception,
              status: e.status,
            };
          }),
          [
            "order",
            "customer",
            "warehouse",
            "pickWave",
            "priority",
            "carrier",
            "service",
            "tracking",
            "packageType",
            "weight",
            "shipBy",
            "eta",
            "exception",
            "status",
          ],
          [
            "Order",
            "Customer",
            "Warehouse",
            "Pick wave",
            "Priority",
            "Carrier",
            "Service",
            "Tracking",
            "Package type",
            "Weight kg",
            "Ship by",
            "ETA",
            "Exception",
            "Status",
          ],
        ),
    );
    showToast("Filtered fulfillment queue exported.");
  };
  const le = (e) => {
    if (y)
      return [
        {
          label: "Restore",
          icon: "check-circle",
          onClick: () => {
            archiveRecords("fulfillment", [e.id], true);
            ae();
            showToast("Fulfillment restored.");
          },
        },
      ];
    const t = getNextFulfillmentAction(e);
    const n = getShipmentOrder(e);
    const r = [
      {
        label: "View order",
        icon: "eye",
        onClick: () =>
          navigate(
            `/commerce/orders?q=${encodeURIComponent(String(n?.number || ""))}`,
          ),
      },
      {
        label: "Edit fulfillment",
        icon: "pencil",
        onClick: () =>
          w({
            mode: "edit",
            id: e.id,
          }),
      },
      {
        label: "Packing slip",
        icon: "clipboard-text",
        onClick: () => E(e.id),
      },
      ...(e.tracking
        ? [
            {
              label: "Copy tracking",
              icon: "copy",
              onClick: () => copyFulfillmentTrackingNumber(e),
            },
          ]
        : []),
    ];
    if (t) {
      r.push({
        label: t[1],
        icon: t[2],
        separatorBefore: true,
        onClick: () => se(e.id, t[0]),
      });
    }
    if (e.status === "Delayed") {
      r.push({
        label: "Clear exception",
        icon: "check-circle",
        onClick: () =>
          se(e.id, "In transit", "Exception cleared. Shipment is in transit."),
      });
    } else if (e.status !== "Delivered") {
      r.push({
        label: "Report delay",
        icon: "info",
        onClick: () =>
          se(e.id, "Delayed", "Shipment moved to the exception queue."),
      });
    }
    r.push({
      label: "Open delivery",
      icon: "truck",
      onClick: () =>
        navigate(
          `/commerce/deliveries?q=${encodeURIComponent(String(n?.number || ""))}`,
        ),
    });
    return r;
  };
  return (
    <Fragment>
      <CommercePageHeading
        title={"Fulfillment & tracking"}
        onExport={ce}
        onCreate={() =>
          w({
            mode: "create",
          })
        }
        createLabel="Add fulfillment"
      />
      <ShippingWorkspaceNav active="fulfillment" />
      <ShippingSummaryGrid items={oe} />
      <FulfillmentStageCard rows={D} />
      <section className="glass-card shipping-filter-card">
        <div className="c-toolbar shipping-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter warehouse</span>
            <select value={o} onChange={(e) => re(s, e.currentTarget.value)}>
              <option value="">All warehouses</option>
              {k.map((e) => (
                <option key={e.id} value={e.id}>
                  {String(e.name || "")}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter carrier</span>
            <select value={c} onChange={(e) => re(u, e.currentTarget.value)}>
              <option value="">All carriers</option>
              {A.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter status</span>
            <select value={i} onChange={(e) => re(a, e.currentTarget.value)}>
              <option value="">All statuses</option>
              {fulfillmentStatusOptions.map((e) => (
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
              onChange={(e) => re(r, e.currentTarget.value)}
              aria-label="Search fulfillment queue"
            />
          </label>
          <label className="c-archive-toggle">
            <input
              type="checkbox"
              checked={y}
              onChange={(e) => {
                b(e.currentTarget.checked);
                g(1);
              }}
            />
            {" Archived"}
          </label>
        </div>
      </section>
      <section className="glass-card c-resource shipping-resource">
        <div className="shipping-section-heading">
          <div>
            <span>WAREHOUSE QUEUE</span>
            <h2>Fulfillment operations</h2>
            <p>
              Keep pick wave, package, carrier, service, ship-by date and
              exceptions visible in one place.
            </p>
          </div>
          <small>
            {formatNumber(j.length)}
            {" matching shipments"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="table-scroll c-table-scroll shipment-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Fulfillment queue"
          >
            {j.length ? (
              <table className="c-table shipment-table fulfillment-table">
                <thead>
                  <tr>
                    <ShippingSortableHeader
                      label="Order"
                      sortKey="order"
                      sort={d}
                      direction={p}
                      onSort={ie}
                    />
                    <ShippingSortableHeader
                      label="Warehouse"
                      sortKey="warehouse"
                      sort={d}
                      direction={p}
                      onSort={ie}
                    />
                    <ShippingSortableHeader
                      label="Items"
                      sortKey="items"
                      sort={d}
                      direction={p}
                      onSort={ie}
                    />
                    <ShippingSortableHeader
                      label="Carrier / service"
                      sortKey="carrier"
                      sort={d}
                      direction={p}
                      onSort={ie}
                    />
                    <th>Package</th>
                    <ShippingSortableHeader
                      label="Priority"
                      sortKey="priority"
                      sort={d}
                      direction={p}
                      onSort={ie}
                    />
                    <ShippingSortableHeader
                      label="Ship by / ETA"
                      sortKey="shipBy"
                      sort={d}
                      direction={p}
                      onSort={ie}
                    />
                    <th>Tracking / exception</th>
                    <ShippingSortableHeader
                      label="Status"
                      sortKey="status"
                      sort={d}
                      direction={p}
                      onSort={ie}
                    />
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ee.map((e) => {
                    const t = getShipmentOrder(e);
                    const n = getShipmentCustomer(t);
                    const r = getOrderUnitCount(t);
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
                          <span className="shipment-warehouse">
                            <strong>
                              {getRecordLabel("warehouses", e.warehouseId)}
                            </strong>
                            <small>
                              {String(e.pickWave || "No pick wave")}
                            </small>
                          </span>
                        </td>
                        <td>
                          <span className="shipment-items">
                            <strong>
                              {formatNumber(r)}
                              {" unit"}
                              {r === 1 ? "" : "s"}
                            </strong>
                            <small>
                              {String(t?.deliveryMethod || "Standard delivery")}
                            </small>
                          </span>
                        </td>
                        <td>
                          <span className="shipment-service">
                            <strong>
                              {String(e.carrier || "Not assigned")}
                            </strong>
                            <small>
                              {String(e.service || "Service pending")}
                            </small>
                          </span>
                        </td>
                        <td>
                          <span className="shipment-package">
                            <strong>
                              {String(e.packageType || "Package pending")}
                            </strong>
                            <small>
                              {e.weight
                                ? `${String(e.weight)} kg`
                                : "Weight pending"}
                            </small>
                          </span>
                        </td>
                        <td>
                          <ShipmentPriorityPill value={e.priority} />
                        </td>
                        <td>
                          <span className="shipment-date">
                            <strong>{formatShippingDate(e.shipBy)}</strong>
                            <small>
                              {"ETA "}
                              {formatShippingDate(e.eta)}
                            </small>
                          </span>
                        </td>
                        <td>
                          <span className="shipment-tracking">
                            <strong>
                              {String(e.tracking || "Not assigned")}
                            </strong>
                            {e.exception ? (
                              <small className="exception">
                                {String(e.exception)}
                              </small>
                            ) : (
                              <small>No exception</small>
                            )}
                          </span>
                        </td>
                        <td>
                          <ShipmentStatusPill value={e.status} />
                        </td>
                        <td className="product-actions-cell shipment-actions-cell">
                          <RowActionsMenu
                            label={`fulfillment ${String(t?.number || e.id)}`}
                            actions={le(e)}
                            triggerClassName="shipment-row-menu"
                            panelClassName="shipment-row-menu-panel"
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
                <Icon name="package" />
                <h3>No fulfillment records match</h3>
                <p>Try another search, warehouse, carrier or status filter.</p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {te}–{ne}
              {" of "}
              {j.length}
              {" fulfillments"}
            </span>
            <label>
              {"Per page "}
              <select
                value={_}
                onChange={(e) => {
                  v(Number(e.currentTarget.value));
                  g(1);
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
                disabled={N === 1}
                onClick={() => g(Math.max(1, N - 1))}
              >
                Previous
              </button>
              <span>
                {N}
                {" / "}
                {M}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={N === M}
                onClick={() => g(Math.min(M, N + 1))}
              >
                Next
              </button>
            </div>
          </footer>
        </div>
      </section>
      {C?.mode === "create" ? (
        <ResourceRecordDialog
          module={t}
          mode="create"
          onClose={() => w(null)}
          onChanged={ae}
        />
      ) : null}
      {C?.mode === "edit" && C.id ? (
        <ResourceRecordDialog
          module={t}
          mode="edit"
          recordId={C.id}
          onClose={() => w(null)}
          onChanged={ae}
        />
      ) : null}
      {T ? <PackingSlipDialog id={T} onClose={() => E(null)} /> : null}
    </Fragment>
  );
}
