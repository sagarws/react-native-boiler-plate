// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons/icon";
import { IconTile } from "@/components/ui/card-primitives";
import { navigationRoutes } from "@/config/navigation";
import { lowStockProducts, recentOrders, topProducts } from "@/data/dashboard";
import { getRecordLabel, listRecords } from "@/lib/store/core";

function buildGlobalSearchResults(e) {
  const t = e.trim().toLowerCase();
  return [
    ...recentOrders.map((e) => ({
      label: `#${e.id} · ${e.customer}`,
      description: `Order · ${e.items} items · $${e.amount.toFixed(2)}`,
      action: "order",
      id: e.id,
      icon: "clipboard-text",
    })),
    ...topProducts.map((e) => ({
      label: e.name,
      description: `Product · $${e.price.toFixed(2)}`,
      action: "product",
      id: e.id,
      icon: e.icon,
    })),
    ...lowStockProducts.map((e) => ({
      label: e.name,
      description: `Low stock · ${e.count} units remaining`,
      action: "restock",
      id: e.id,
      icon: e.icon,
    })),
    ...navigationRoutes.map((e) => ({
      label: e.label,
      description: `Page · ${e.group || "Workspace"}`,
      action: "route",
      id: e.path,
      icon: e.icon,
    })),
    ...listRecords("products").map((e) => ({
      label: `${e.name} · ${e.sku}`,
      description: "Catalog product",
      action: "route",
      id: `/commerce/products?q=${encodeURIComponent(e.sku)}`,
      icon: "shopping-bag",
    })),
    ...listRecords("customers").map((e) => ({
      label: e.name,
      description: e.email,
      action: "route",
      id: `/commerce/customers?q=${encodeURIComponent(e.email)}`,
      icon: "users",
    })),
    ...listRecords("orders").map((e) => ({
      label: `${e.number} · ${getRecordLabel("customers", e.customerId)}`,
      description: `Order · ${e.status}`,
      action: "route",
      id: `/commerce/orders?q=${encodeURIComponent(e.number)}`,
      icon: "clipboard-text",
    })),
  ]
    .filter(
      (e) => !t || `${e.label} ${e.description}`.toLowerCase().includes(t),
    )
    .slice(0, 12);
}

export function GlobalSearchDialog({ open: e, onClose }) {
  const n = useRef(null);
  const r = useRef(null);
  const [i, a] = useState("");
  const o = useMemo(() => buildGlobalSearchResults(i), [i]);
  if (
    (useEffect(() => {
      const t = n.current;
      if (t && e) {
        if (!t.open) {
          t.showModal();
        }
        requestAnimationFrame(() => r.current?.focus());
        return () => {
          if (t.open) {
            t.close();
          }
        };
      }
    }, [e]),
    !e)
  )
    return null;
  const s = document.querySelector("#overlay-root");
  return s
    ? createPortal(
        <dialog
          ref={n}
          className="app-dialog"
          aria-labelledby="dialog-title"
          onCancel={(e) => {
            e.preventDefault();
            onClose(true);
          }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const n = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < n.left ||
              e.clientX > n.right ||
              e.clientY < n.top ||
              e.clientY > n.bottom
            ) {
              onClose(true);
            }
          }}
        >
          <header className="dialog-heading">
            <h2 id="dialog-title">Find something in your store</h2>
            <button
              type="button"
              className="icon-button"
              data-action="close-dialog"
              aria-label="Close dialog"
              onClick={() => onClose(true)}
            >
              <Icon name="x" />
            </button>
          </header>
          <div className="dialog-body">
            <label className="sr-only" htmlFor="workspace-search">
              Search workspace
            </label>
            <input
              ref={r}
              id="workspace-search"
              className="search-input"
              autoComplete="off"
              placeholder="Search orders, products, customers..."
              value={i}
              onChange={(e) => a(e.currentTarget.value)}
            />
            <div
              className="search-results"
              id="search-results"
              aria-live="polite"
            >
              {o.length ? (
                o.map((e) => (
                  <button
                    key={`${e.action}-${e.id}`}
                    type="button"
                    className="search-result"
                    data-action={e.action}
                    data-id={e.id}
                    onClick={() => onClose(true)}
                  >
                    <IconTile name={e.icon} tone="neutral" />
                    <span>
                      <strong>{e.label}</strong>
                      <small>{e.description}</small>
                    </span>
                    <Icon name="arrow-right" />
                  </button>
                ))
              ) : (
                <p className="search-empty">
                  No results for “{i}”. Try an order number, customer, or
                  product name.
                </p>
              )}
            </div>
          </div>
        </dialog>,
        s,
      )
    : null;
}
