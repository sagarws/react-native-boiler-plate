// @ts-nocheck
import { useEffect, useState } from "react";
import { OverlayDialogContent } from "@/components/layout/overlay-dialog-content";
import {
  closeMobileSidebar,
  syncSidebarAccessibility,
} from "@/components/layout/sidebar-state";
import { AppDialog } from "@/components/ui/app-dialog";
import { recentOrders, topProducts } from "@/data/dashboard";
import { DIALOG_CLOSE_EVENT, showToast } from "@/lib/events";
import { buildRecentSalesCsv } from "@/lib/export/recent-sales-csv";
import { navigate } from "@/lib/navigation";
import { findPeriodOption } from "@/lib/period";
import { writeStoredValue } from "@/lib/storage";
import { findRecord } from "@/lib/store/core";

function getOverlayDialogTitle(e) {
  return e.kind === "orders"
    ? "Recent sales"
    : e.kind === "order"
      ? `Order #${e.id || ""}`
      : e.kind === "shipments"
        ? "Shipment activity"
        : e.kind === "shipment"
          ? `Shipment · #${e.id || ""}`
          : e.kind === "deliveries"
            ? "Recent deliveries"
            : e.kind === "fulfillment"
              ? "Fulfillment overview"
              : e.kind === "channels"
                ? "Sales by channel"
                : e.kind === "regions"
                  ? "Buying regions"
                  : e.kind === "products"
                    ? "Top selling products"
                    : e.kind === "product"
                      ? topProducts.find((t) => t.id === e.id)?.name ||
                        "Product"
                      : e.kind === "inventory"
                        ? "Inventory snapshot"
                        : e.kind === "low-stock"
                          ? "Products to restock"
                          : e.kind === "restock"
                            ? `Restock ${String(findRecord("products", e.id || "")?.name || "")}`.trim()
                            : e.kind === "payments"
                              ? "Payment methods"
                              : e.kind === "revenue"
                                ? "Revenue trend data"
                                : e.kind === "reports"
                                  ? "Store performance report"
                                  : e.kind === "drafts"
                                    ? "Saved drafts"
                                    : e.kind === "preferences"
                                      ? "Workspace preferences"
                                      : "A little help, right here";
}

function isWideOverlayDialog(e) {
  return (
    e === "orders" || e === "deliveries" || e === "revenue" || e === "drafts"
  );
}

export function OverlayHost({ period }) {
  const [t, n] = useState(null);
  useEffect(() => {
    const e = new AbortController();
    const { signal } = e;
    function r(e, t) {
      n({
        kind: e,
        id: t,
      });
    }
    function i() {
      const e = URL.createObjectURL(
        new Blob(["﻿" + buildRecentSalesCsv(recentOrders)], {
          type: "text/csv;charset=utf-8;",
        }),
      );
      const t = document.createElement("a");
      t.href = e;
      t.download = "veylix-sample-sales.csv";
      t.click();
      window.setTimeout(() => URL.revokeObjectURL(e), 1e3);
      showToast("Sample sales CSV exported.");
    }
    function a(e, t) {
      if (e) {
        if (e === "close-dialog") n(null);
        else if (e === "back-overview") {
          n(null);
          navigate("/overview");
          document.querySelector("#main-content")?.focus();
        } else if (e === "toggle-sidebar") {
          const e = document.querySelector(".app-shell");
          if (!e) return;
          if (window.innerWidth < 768) {
            e.classList.toggle("mobile-nav-open");
            syncSidebarAccessibility();
            if (e.classList.contains("mobile-nav-open")) {
              document.querySelector(".brand")?.focus();
            }
          } else {
            e.classList.toggle("collapsed");
            writeStoredValue(
              "sidebar-collapsed",
              e.classList.contains("collapsed"),
            );
            syncSidebarAccessibility();
          }
        } else {
          if (e === "close-sidebar") {
            closeMobileSidebar();
          } else if (e === "search") {
            n(null);
            window.dispatchEvent(new Event("veylix:search"));
          } else if (e === "route" && t) {
            n(null);
            if (`${location.pathname}${location.search}` === t) {
              document.querySelector("#main-content")?.focus();
            } else {
              navigate(t);
            }
          } else if (e === "export-sales") {
            i();
          } else if (e === "add-product") {
            n(null);
            navigate("/commerce/products/new");
          } else if (e === "create-discount") {
            n(null);
            navigate("/commerce/discounts");
          } else if (e === "campaign") {
            n(null);
            navigate("/commerce/campaigns");
          } else if (e === "assistant") {
            n(null);
            closeMobileSidebar();
            navigate("/commerce/ai-studio");
          } else if (
            [
              "orders",
              "shipments",
              "deliveries",
              "fulfillment",
              "channels",
              "regions",
              "products",
              "inventory",
              "low-stock",
              "payments",
              "revenue",
              "reports",
              "drafts",
              "preferences",
              "help",
            ].includes(e) ||
            ["order", "shipment", "product", "restock"].includes(e)
          ) {
            r(e, t);
          }
        }
      }
    }
    document.addEventListener(
      "click",
      (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (!t) return;
        const n = t.closest("[data-nav-toggle]");
        if (n) {
          const e = document.querySelector(".app-shell");
          const t = e?.classList.contains("collapsed") || false;
          if (t) {
            e?.classList.remove("collapsed");
            writeStoredValue("sidebar-collapsed", false);
            syncSidebarAccessibility();
          }
          const r = !t && n.getAttribute("aria-expanded") === "true";
          if (
            (document.querySelectorAll("[data-nav-toggle]").forEach((e) => {
              const t = e === n && !r;
              e.setAttribute("aria-expanded", String(t));
              const i = e.getAttribute("aria-controls");
              const a = i ? document.getElementById(i) : null;
              if (a) {
                a.hidden = !t;
              }
            }),
            !r)
          ) {
            const e = n.getAttribute("aria-controls");
            const t = e
              ? document.getElementById(e)?.querySelector("a[href]")
              : null;
            if (t) {
              const e = new URL(t.href, location.href);
              const n = `${e.pathname}${e.search}`;
              if (`${location.pathname}${location.search}` !== n) {
                navigate(n);
              }
            }
          }
          return;
        }
        if (t.closest(".skip-link")) {
          e.preventDefault();
          document.querySelector("#main-content")?.focus();
          return;
        }
        const r = t.closest("[data-action]");
        if (r) {
          a(r.dataset.action, r.dataset.id);
        }
        if (t.closest(".nav-link, .brand")) {
          closeMobileSidebar();
        }
      },
      {
        signal: signal,
      },
    );
    window.addEventListener(
      "veylix:period",
      (e) => {
        const t = e.detail;
        const n = findPeriodOption(t);
        writeStoredValue("period", n.id);
        showToast(`Showing ${n.label.toLowerCase()}: ${n.range}`);
      },
      {
        signal: signal,
      },
    );
    window.addEventListener(DIALOG_CLOSE_EVENT, () => n(null), {
      signal: signal,
    });
    window.addEventListener("veylix:navigate", () => n(null), {
      signal: signal,
    });
    window.addEventListener("popstate", () => n(null), {
      signal: signal,
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (
          ((e.metaKey || e.ctrlKey) &&
            e.key.toLowerCase() === "k" &&
            (e.preventDefault(),
            n(null),
            window.dispatchEvent(new Event("veylix:search"))),
          e.key === "Escape")
        ) {
          const e = document
            .querySelector(".app-shell")
            ?.classList.contains("mobile-nav-open");
          closeMobileSidebar();
          if (e) {
            document.querySelector(".mobile-menu")?.focus();
          }
        }
        if (
          e.key === "Tab" &&
          window.innerWidth < 768 &&
          document
            .querySelector(".app-shell")
            ?.classList.contains("mobile-nav-open")
        ) {
          const t = Array.from(
            document.querySelectorAll(".sidebar a, .sidebar button"),
          ).filter((e) => e.getClientRects().length > 0);
          if (!t.length) return;
          if (e.shiftKey && document.activeElement === t[0]) {
            e.preventDefault();
            t.at(-1)?.focus();
          } else if (!e.shiftKey && document.activeElement === t.at(-1)) {
            e.preventDefault();
            t[0]?.focus();
          }
        }
      },
      {
        signal: signal,
      },
    );
    window.addEventListener(
      "resize",
      () => {
        if (window.innerWidth < 768) {
          document.querySelector(".app-shell")?.classList.remove("collapsed");
        } else {
          closeMobileSidebar();
        }
        syncSidebarAccessibility();
      },
      {
        signal: signal,
      },
    );
    syncSidebarAccessibility();
    return () => e.abort();
  }, []);
  return t ? (
    <AppDialog
      title={getOverlayDialogTitle(t)}
      wide={isWideOverlayDialog(t.kind)}
      onClose={() => n(null)}
    >
      <OverlayDialogContent state={t} period={period} onClose={() => n(null)} />
    </AppDialog>
  ) : null;
}
