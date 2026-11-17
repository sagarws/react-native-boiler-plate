// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { modulesById } from "@/config/modules/registry";
import { CustomerNoteDialog } from "@/features/customers/components/customer-note-dialog";
import { CustomerProfileDialog } from "@/features/customers/components/customer-profile-dialog";
import { CustomerActivityDialog } from "@/features/customers/components/customer-timeline";
import {
  customerDateFormatter,
  getCustomerInitials,
  getCustomerOrderStats,
} from "@/features/customers/lib/customer-metrics";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { compactUsdFormatter, integerFormatter } from "@/lib/intl-formatters";
import { buildHref, navigate } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import {
  updateCustomerSegment,
  updateCustomerStatus,
} from "@/lib/store/customers";

function CustomerSegmentBadge({ value = "New" }) {
  const t = String(value || "New")
    .toLowerCase()
    .replace(/\s+/g, "-");
  return <span className={`customer-segment ${t}`}>{value || "New"}</span>;
}

function CustomerMarketingBadge({ value = "Not subscribed" }) {
  const t = value === "Subscribed";
  return (
    <span className={`customer-marketing ${t ? "subscribed" : ""}`}>
      <Icon name={t ? "check-circle" : "pause"} />
      {value || "Not subscribed"}
    </span>
  );
}

function CustomerSummaryCard({ icon, label, value, detail, tone = "" }) {
  return (
    <div className={`customer-summary-card ${tone}`.trim()}>
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

function CustomerSortableHeader({ label, sortKey, sort, direction, onSort }) {
  const a = sort === sortKey;
  return (
    <th
      scope="col"
      aria-sort={a ? (direction === 1 ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
        <Icon name={a && direction < 0 ? "arrow-down" : "arrow-up"} />
      </button>
    </th>
  );
}

export function CustomersPage({ initialQuery = "" }) {
  const t = modulesById.customers;
  const [n, r] = useState(initialQuery);
  const [i, a] = useState("");
  const [o, s] = useState("");
  const [c, u] = useState("");
  const [d, f] = useState(1);
  const [p, m] = useState(1);
  const [h, g] = useState(8);
  const [_, v] = useState(0);
  const [y, b] = useState(null);
  const x = useMemo(() => listRecords("customers"), [_]);
  const S = t.fields.find((e) => e.key === "segment")?.options || [];
  const C = useMemo(() => {
    let e = [...x];
    if (n) {
      const t = n.toLowerCase();
      e = e.filter((e) => Object.values(e).join(" ").toLowerCase().includes(t));
    }
    if (i) {
      e = e.filter((e) => String(e.status || "Active") === i);
    }
    if (o) {
      e = e.filter((e) => String(e.segment || "New") === o);
    }
    if (c) {
      e.sort((e, t) => {
        const n = (e) => {
          const t = getCustomerOrderStats(e);
          if (c === "orders") return t.orders;
          if (c === "spend") return t.spend;
          if (c === "aov") return t.aov;
          if (c === "lastOrder")
            return (t.latest?.date && Date.parse(String(t.latest.date))) || 0;
          const n = e[c];
          return typeof n == "number" ? n : String(n || "");
        };
        const r = n(e);
        const i = n(t);
        return (
          d *
          (typeof r == "number" && typeof i == "number"
            ? r - i
            : String(r).localeCompare(String(i)))
        );
      });
    }
    return e;
  }, [x, n, i, o, c, d]);
  const w = x.map((e) => getCustomerOrderStats(e));
  const T = x.filter((e) => e.status !== "Inactive").length;
  const E = w.filter((e) => e.orders >= 2).length;
  const D = w.reduce((e, t) => e + t.spend, 0);
  const O = x.length ? D / x.length : 0;
  const k = Math.max(1, Math.ceil(C.length / h));
  const A = Math.min(p, k);
  const j = C.slice((A - 1) * h, A * h);
  const M = C.length ? (A - 1) * h + 1 : 0;
  const N = Math.min(A * h, C.length);
  const ee = () => v((e) => e + 1);
  const te = (e, t) => {
    e(t);
    m(1);
  };
  const ne = (e) => {
    if (c === e) {
      f((e) => (e === 1 ? -1 : 1));
    } else {
      u(e);
      f(1);
    }
  };
  const re = (e) => {
    try {
      e();
      ee();
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This customer could not be updated.",
      );
    }
  };
  const ie = async (e) => {
    const t = x.find((t) => t.id === e);
    const n = String(t?.email || "");
    if (!n) showToast("This customer does not have an email address.");
    else
      try {
        if (navigator.clipboard?.writeText)
          await navigator.clipboard.writeText(n);
        else {
          const e = document.createElement("textarea");
          e.value = n;
          e.style.position = "fixed";
          e.style.opacity = "0";
          document.body.append(e);
          e.select();
          document.execCommand("copy");
          e.remove();
        }
        showToast("Customer email copied.");
      } catch {
        showToast("Customer email could not be copied.");
      }
  };
  const ae = () => {
    downloadFile(
      "veylix-customers.csv",
      "﻿" +
        buildCsv(
          C.map((e) => {
            const t = getCustomerOrderStats(e);
            return {
              name: e.name,
              email: e.email,
              phone: e.phone,
              company: e.company || "",
              segment: e.segment || "New",
              orders: t.orders,
              totalSpent: t.spend,
              aov: t.aov,
              lastOrder: t.latest?.date || "",
              city: e.city || "",
              country: e.country || "",
              marketing: e.marketing || "Not subscribed",
              status: e.status || "Active",
            };
          }),
          [
            "name",
            "email",
            "phone",
            "company",
            "segment",
            "orders",
            "totalSpent",
            "aov",
            "lastOrder",
            "city",
            "country",
            "marketing",
            "status",
          ],
          [
            "Customer",
            "Email",
            "Phone",
            "Company",
            "Segment",
            "Orders",
            "Total spent",
            "Average order",
            "Last order",
            "City",
            "Country",
            "Marketing",
            "Status",
          ],
        ),
    );
    showToast("Filtered customers exported.");
  };
  const oe = (e) => {
    const t = e.status === "Inactive";
    return [
      {
        label: "View profile",
        icon: "eye",
        onClick: () =>
          b({
            mode: "detail",
            id: e.id,
          }),
      },
      {
        label: "Edit customer",
        icon: "pencil",
        onClick: () =>
          b({
            mode: "edit",
            id: e.id,
          }),
      },
      {
        label: "View orders",
        icon: "cart",
        onClick: () =>
          navigate(
            `/commerce/orders?q=${encodeURIComponent(String(e.name || ""))}`,
          ),
      },
      {
        label: "Add note",
        icon: "notebook",
        onClick: () =>
          b({
            mode: "note",
            id: e.id,
          }),
      },
      {
        label: "Activity",
        icon: "history",
        onClick: () =>
          b({
            mode: "activity",
            id: e.id,
          }),
      },
      {
        label: "Open inbox",
        icon: "chats-circle",
        onClick: () =>
          navigate(`/commerce/chat?customer=${encodeURIComponent(e.id)}`),
      },
      {
        label: "Copy email",
        icon: "copy",
        onClick: () => {
          ie(e.id);
        },
      },
      {
        label: e.segment === "VIP" ? "Move to Returning" : "Mark as VIP",
        icon: "star",
        separatorBefore: true,
        onClick: () =>
          re(() => {
            const t = updateCustomerSegment(
              e.id,
              e.segment === "VIP" ? "Returning" : "VIP",
            );
            showToast(`${t.name} moved to ${t.segment}.`);
          }),
      },
      {
        label: t ? "Activate customer" : "Deactivate customer",
        icon: t ? "check-circle" : "pause",
        danger: !t,
        onClick: () =>
          re(() => {
            const n = updateCustomerStatus(e.id, t ? "Active" : "Inactive");
            showToast(`${n.name} is now ${String(n.status).toLowerCase()}.`);
          }),
      },
    ];
  };
  return (
    <Fragment>
      <CommercePageHeading
        title="Customers"
        onExport={ae}
        onCreate={() =>
          b({
            mode: "create",
          })
        }
        createLabel="Add customer"
        afterExportActions={
          <Link
            className="secondary-button"
            href={buildHref("/commerce/segments")}
          >
            Segments
          </Link>
        }
      />
      <section className="customer-summary-grid" aria-label="Customer overview">
        <CustomerSummaryCard
          icon="users"
          label="Total customers"
          value={integerFormatter.format(x.length)}
          detail={`${integerFormatter.format(T)} active now`}
          tone="green"
        />
        <CustomerSummaryCard
          icon="history"
          label="Repeat customers"
          value={integerFormatter.format(E)}
          detail={
            x.length
              ? `${Math.round((E / x.length) * 100)}% of customers`
              : "No customer data"
          }
          tone="blue"
        />
        <CustomerSummaryCard
          icon="wallet"
          label="Lifetime order value"
          value={compactUsdFormatter.format(D)}
          detail="Non-cancelled orders"
          tone="amber"
        />
        <CustomerSummaryCard
          icon="chart-line-up"
          label="Average customer value"
          value={compactUsdFormatter.format(O)}
          detail="Across the customer base"
          tone="lilac"
        />
      </section>
      <section className="glass-card customer-filter-card">
        <div className="c-toolbar customer-toolbar">
          <label className="c-filter">
            <span className="sr-only">Filter by segment</span>
            <select value={o} onChange={(e) => te(s, e.currentTarget.value)}>
              <option value="">All segments</option>
              {S.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-filter">
            <span className="sr-only">Filter by status</span>
            <select value={i} onChange={(e) => te(a, e.currentTarget.value)}>
              <option value="">All statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
          <label className="c-search customer-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search customers, email, city..."
              value={n}
              onChange={(e) => te(r, e.currentTarget.value)}
              aria-label="Search customers"
            />
          </label>
        </div>
      </section>
      <section className="glass-card c-resource customer-resource">
        <div className="customer-list-heading">
          <div>
            <span>RELATIONSHIPS</span>
            <h2>Customer list</h2>
            <p>Orders, value, location and engagement in one view.</p>
          </div>
          <small>
            {integerFormatter.format(C.length)}
            {" matching customers"}
          </small>
        </div>
        <div id="resource-results">
          <div
            className="table-scroll c-table-scroll customer-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Customer records"
          >
            {C.length ? (
              <table className="c-table customer-table">
                <thead>
                  <tr>
                    <CustomerSortableHeader
                      label="Customer"
                      sortKey="name"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <CustomerSortableHeader
                      label="Segment"
                      sortKey="segment"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <CustomerSortableHeader
                      label="Orders"
                      sortKey="orders"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <CustomerSortableHeader
                      label="Total spent"
                      sortKey="spend"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <CustomerSortableHeader
                      label="AOV"
                      sortKey="aov"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <CustomerSortableHeader
                      label="Last order"
                      sortKey="lastOrder"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <th scope="col">Location</th>
                    <th scope="col">Marketing</th>
                    <CustomerSortableHeader
                      label="Status"
                      sortKey="status"
                      sort={c}
                      direction={d}
                      onSort={ne}
                    />
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {j.map((e) => {
                    const t = getCustomerOrderStats(e);
                    const n = t.latest?.date
                      ? customerDateFormatter.format(
                          new Date(`${String(t.latest.date)}T00:00:00`),
                        )
                      : "No orders yet";
                    const r =
                      [e.city, e.country]
                        .filter(Boolean)
                        .map(String)
                        .join(", ") || "Not set";
                    return (
                      <tr key={e.id} data-row-id={e.id}>
                        <td>
                          <button
                            type="button"
                            className="customer-record"
                            onClick={() =>
                              b({
                                mode: "detail",
                                id: e.id,
                              })
                            }
                          >
                            <span className="customer-avatar">
                              {getCustomerInitials(e.name)}
                            </span>
                            <span>
                              <strong>{String(e.name || "")}</strong>
                              <small>{String(e.email || "No email")}</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <CustomerSegmentBadge
                            value={String(e.segment || "New")}
                          />
                        </td>
                        <td>
                          <strong>{integerFormatter.format(t.orders)}</strong>
                        </td>
                        <td>
                          <strong>{compactUsdFormatter.format(t.spend)}</strong>
                        </td>
                        <td>{compactUsdFormatter.format(t.aov)}</td>
                        <td>
                          <span className="customer-last-order">{n}</span>
                          {t.latest ? (
                            <small>
                              {String(t.latest.number || "")}
                              {" · "}
                              {String(t.latest.status || "")}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <span className="customer-location">{r}</span>
                        </td>
                        <td>
                          <CustomerMarketingBadge
                            value={String(e.marketing || "Not subscribed")}
                          />
                        </td>
                        <td>
                          <StatusPill value={String(e.status || "Active")} />
                        </td>
                        <td className="product-actions-cell customer-actions-cell">
                          <RowActionsMenu
                            label={String(e.name || "customer")}
                            actions={oe(e)}
                            triggerClassName="customer-row-menu"
                            panelClassName="customer-row-menu-panel"
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
                <Icon name="users" />
                <h3>
                  {n || i || o
                    ? "No customers match these filters"
                    : "Your customer list is ready"}
                </h3>
                <p>
                  {n || i || o
                    ? "Try another search or clear a filter."
                    : "Customers you add will appear here."}
                </p>
              </div>
            )}
          </div>
          <footer className="c-pagination">
            <span>
              {M}–{N}
              {" of "}
              {C.length}
              {" customers"}
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
      {y?.mode === "create" ? (
        <ResourceRecordDialog
          module={t}
          mode="create"
          onClose={() => b(null)}
          onChanged={ee}
        />
      ) : null}
      {y?.mode === "edit" ? (
        <ResourceRecordDialog
          module={t}
          mode="edit"
          recordId={y.id}
          onClose={() => b(null)}
          onChanged={ee}
        />
      ) : null}
      {y?.mode === "detail" ? (
        <CustomerProfileDialog
          customerId={y.id}
          onClose={() => b(null)}
          onEdit={(e) =>
            b({
              mode: "edit",
              id: e,
            })
          }
          onAddNote={(e) =>
            b({
              mode: "note",
              id: e,
            })
          }
          onActivity={(e) =>
            b({
              mode: "activity",
              id: e,
            })
          }
          onCopyEmail={(e) => {
            ie(e);
          }}
        />
      ) : null}
      {y?.mode === "note" ? (
        <CustomerNoteDialog
          customerId={y.id}
          onClose={() => b(null)}
          onSaved={() => {
            b(null);
            ee();
          }}
        />
      ) : null}
      {y?.mode === "activity" ? (
        <CustomerActivityDialog customerId={y.id} onClose={() => b(null)} />
      ) : null}
    </Fragment>
  );
}
