// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { IconTile, ToneBadge } from "@/components/ui/card-primitives";
import {
  inventorySummary,
  paymentMethodShare,
  recentOrders,
  recentShipmentUpdates,
  salesByRegion,
  salesChannels,
  topProducts,
} from "@/data/dashboard";
import { LowStockAlertsCard } from "@/features/overview/components/low-stock-alerts-card";
import { OrderFulfillmentCard } from "@/features/overview/components/order-fulfillment-card";
import { RecentDeliveriesTable } from "@/features/overview/components/recent-deliveries-card";
import { RecentSalesTable } from "@/features/overview/components/recent-sales-card";
import { showToast } from "@/lib/events";
import { formatCurrency, formatNumber } from "@/lib/format";
import { readStoredValue, saveDraft, writeStoredValue } from "@/lib/storage";
import { findRecord } from "@/lib/store/core";

function DetailList({ rows }) {
  return (
    <dl className="detail-list">
      {rows.map(([e, t]) => (
        <div key={e}>
          <dt>{e}</dt>
          <dd>{t}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailTable({ headings, rows, label = "Detail table" }) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      <table>
        <thead>
          <tr>
            {headings.map((e) => (
              <th key={e} scope="col">
                {e}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e, t) => (
            <tr key={t}>
              {e.map((e, n) => (
                <td key={`${t}-${n}`}>{e}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RestockRequestForm({ productId, onSaved }) {
  const n = findRecord("products", productId);
  if (!n) return null;
  function r(e) {
    e.preventDefault();
    const n = Object.fromEntries(
      Array.from(new FormData(e.currentTarget).entries()).map(([e, t]) => [
        e,
        String(t).trim(),
      ]),
    );
    try {
      saveDraft("restock", n);
      onSaved();
      showToast("Draft saved in this browser. View it from your profile.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <form
      className="form-grid"
      id="draft-form"
      data-type="restock"
      onSubmit={r}
    >
      <label className="field">
        Product
        <input name="product" value={String(n.name || "")} readOnly />
      </label>
      <label className="field">
        Quantity to order
        <input
          name="quantity"
          type="number"
          min="1"
          max="100000"
          step="1"
          defaultValue="50"
          required
        />
      </label>
      <label className="field">
        Supplier note
        <textarea
          name="note"
          maxLength={300}
          placeholder="Delivery requirements or supplier reference"
        />
      </label>
      <button className="primary-button" type="submit">
        Save restock request
      </button>
      <button className="text-link" type="button" data-action="drafts">
        View saved drafts
      </button>
    </form>
  );
}

function SolidGlassToggle() {
  const [e, t] = useState(() => document.body.classList.contains("solid-glass"));
  return (
    <Fragment>
      <p>
        Use an opaque background for a higher-contrast reading experience. Your
        preference is saved in this browser.
      </p>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          id="solid-glass-toggle"
          checked={e}
          onChange={(e) => {
            const n = e.currentTarget.checked;
            t(n);
            document.body.classList.toggle("solid-glass", n);
            writeStoredValue("solid-glass", n);
          }}
        />
        Reduce transparency
      </label>
    </Fragment>
  );
}

function SavedDraftsList() {
  const e = useMemo(() => {
    const e = readStoredValue("drafts", []);
    return Array.isArray(e) ? e : [];
  }, []);
  return e.length ? (
    <Fragment>
      <p>
        Saved only in this browser. These drafts have not been published or
        sent.
      </p>
      <DetailTable
        headings={["Type", "Name / reference", "Saved"]}
        rows={e.map((e) => [
          e.type || "",
          e.name || e.code || e.product || "",
          e.createdAt ? new Date(e.createdAt).toLocaleDateString("en-US") : "",
        ])}
      />
    </Fragment>
  ) : (
    <div className="empty-state">
      <h3>No drafts yet</h3>
      <p>
        Create a product, discount, campaign or restock request from Quick
        Actions.
      </p>
    </div>
  );
}

export function OverlayDialogContent({ state, period, onClose }) {
  if (state.kind === "orders")
    return (
      <Fragment>
        <RecentSalesTable />
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            data-action="export-sales"
          >
            <Icon name="download" />
            {" Export sample sales CSV"}
          </button>
        </div>
      </Fragment>
    );
  if (state.kind === "order") {
    const t = recentOrders.find((t) => t.id === state.id);
    return t ? (
      <Fragment>
        <ToneBadge
          label={t.status}
          tone={t.status === "Paid" ? "success" : "amber"}
        />
        <DetailList
          rows={[
            ["Customer", t.customer],
            ["Items", t.items],
            ["Order total", formatCurrency(t.amount, 2)],
            ["Placed", t.date],
            ["Workspace", "Demo data"],
          ]}
        />
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            data-action="shipment"
            data-id={t.id}
          >
            <Icon name="truck" />
            {" View shipment"}
          </button>
        </div>
      </Fragment>
    ) : null;
  }
  if (state.kind === "shipments")
    return (
      <DetailTable
        headings={["Order", "Status", "Updated"]}
        rows={recentShipmentUpdates.map((e) => [`#${e.id}`, e.status, e.time])}
      />
    );
  if (state.kind === "shipment") {
    const t = recentShipmentUpdates.find((t) => t.id === state.id);
    return t ? (
      <Fragment>
        <ToneBadge label={t.status} tone={t.tone} />
        <DetailList
          rows={[
            ["Order", `#${state.id}`],
            ["Status", t.status],
            ["Last update", t.time],
            ["Data source", "Shipment snapshot"],
          ]}
        />
      </Fragment>
    ) : (
      <p>No shipment has been assigned to this sample order yet.</p>
    );
  }
  if (state.kind === "deliveries") return <RecentDeliveriesTable />;
  if (state.kind === "fulfillment")
    return (
      <Fragment>
        <p>
          {"Cumulative stages for "}
          {period.label.toLowerCase()}. Each stage is a subset of orders
          received.
        </p>
        <OrderFulfillmentCard period={period} />
      </Fragment>
    );
  if (state.kind === "channels")
    return (
      <Fragment>
        <p>
          {period.label}
          {" · "}
          {period.range}
        </p>
        <DetailTable
          headings={["Channel", "Share", "Sales"]}
          rows={salesChannels.map((e) => [
            e.name,
            `${e.percent}%`,
            formatCurrency(Math.round((period.sales * e.percent) / 100)),
          ])}
        />
      </Fragment>
    );
  if (state.kind === "regions") {
    const e = salesByRegion.reduce((e, t) => e + t.percent, 0);
    const t = Math.max(0, 100 - e);
    return (
      <Fragment>
        <p>
          {"Top five regions account for "}
          {e}
          {"% of sales. Other regions account for "}
          {t}%.
        </p>
        <DetailTable
          headings={["Region", "Sales share"]}
          rows={[
            ...salesByRegion.map((e) => [e.name, `${e.percent}%`]),
            ["Other regions", `${t}%`],
          ]}
        />
      </Fragment>
    );
  }
  if (state.kind === "products")
    return (
      <Fragment>
        <DetailTable
          headings={["Product", "Units sold", "Unit price"]}
          rows={topProducts.map((e) => [
            e.name,
            formatNumber(e.sold),
            formatCurrency(e.price, 2),
          ])}
        />
        <div className="button-row">
          <button
            type="button"
            className="primary-button"
            data-action="add-product"
          >
            <Icon name="plus" />
            {" Add product draft"}
          </button>
        </div>
      </Fragment>
    );
  if (state.kind === "product") {
    const t = topProducts.find((t) => t.id === state.id);
    return t ? (
      <Fragment>
        <IconTile name={t.icon} />
        <DetailList
          rows={[
            ["Product", t.name],
            ["Price", formatCurrency(t.price, 2)],
            ["Units sold", formatNumber(t.sold)],
            ["Source", "Catalog snapshot"],
          ]}
        />
      </Fragment>
    ) : null;
  }
  return state.kind === "inventory" ? (
    <Fragment>
      <DetailList
        rows={[
          ["Total products", formatNumber(inventorySummary.total)],
          ["In stock", formatNumber(inventorySummary.inStock)],
          ["Low stock", formatNumber(inventorySummary.lowStock)],
          ["Out of stock", formatNumber(inventorySummary.outOfStock)],
        ]}
      />
      <div className="button-row">
        <button
          type="button"
          className="primary-button"
          data-action="low-stock"
        >
          Review low stock
        </button>
      </div>
    </Fragment>
  ) : state.kind === "low-stock" ? (
    <Fragment>
      <p>
        Selected priority products from inventory. Select a product to prepare a
        restock request.
      </p>
      <LowStockAlertsCard />
    </Fragment>
  ) : state.kind === "restock" && state.id ? (
    <RestockRequestForm productId={state.id} onSaved={onClose} />
  ) : state.kind === "payments" ? (
    <Fragment>
      <p>
        {period.label}
        {" · "}
        {formatCurrency(period.sales)}
        {" in total sales"}
      </p>
      <DetailTable
        headings={["Method", "Share", "Sales"]}
        rows={paymentMethodShare.map((e) => [
          e.name,
          `${e.percent}%`,
          formatCurrency((period.sales * e.percent) / 100, 2),
        ])}
      />
    </Fragment>
  ) : state.kind === "revenue" ? (
    <Fragment>
      <p>
        Illustrative trend samples in thousands of USD. Chart samples show
        direction and are not daily ledger totals.
      </p>
      <DetailTable
        headings={["Sample", "This period ($K)", "Last period ($K)"]}
        rows={period.trend.map((e, n) => [n + 1, e, period.previous[n]])}
      />
    </Fragment>
  ) : state.kind === "reports" ? (
    <Fragment>
      <p>
        {period.label}
        {" · "}
        {period.range}
      </p>
      <DetailList
        rows={[
          ["Gross merchandise value", formatCurrency(period.sales)],
          ["Orders", formatNumber(period.orders)],
          ["Conversion rate", `${period.conversion}%`],
          ["Average order value", formatCurrency(period.aov, 1)],
          ["Sales growth", `+${period.change}%`],
        ]}
      />
      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          data-action="export-sales"
        >
          <Icon name="download" />
          {" Export sample sales CSV"}
        </button>
      </div>
    </Fragment>
  ) : state.kind === "drafts" ? (
    <SavedDraftsList />
  ) : state.kind === "preferences" ? (
    <SolidGlassToggle />
  ) : state.kind === "help" ? (
    <Fragment>
      <DetailList
        rows={[
          ["Search the workspace", "Ctrl / ⌘ + K"],
          ["Close a panel", "Escape"],
          ["Dashboard period", "Header date selector"],
          ["Browse modules", "Expand a sidebar group"],
        ]}
      />
      <p className="mt-4">
        Veylix includes catalog, orders, inventory, marketplace, store content,
        reports and an optional AI workspace. Changes stay in this browser. See
        the included documentation for setup and backend integration.
      </p>
    </Fragment>
  ) : null;
}
