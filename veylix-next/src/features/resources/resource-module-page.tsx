// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar } from "@/components/ui/bulk-selection-bar";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { SummaryList } from "@/components/ui/summary-list";
import { TablePagination } from "@/components/ui/table-pagination";
import { modulesById } from "@/config/modules/registry";
import {
  buildCheckoutSummaryMetrics,
  checkoutResourceIds,
} from "@/features/checkout/lib/checkout-summary";
import { WebhookPayloadDialog } from "@/features/integrations/components/webhook-payload-dialog";
import { InventoryAdjustDialog } from "@/features/inventory/components/inventory-adjust-dialog";
import {
  getInventoryModuleSummary,
  inventoryModuleIds,
} from "@/features/inventory/lib/stock-levels";
import { PageBuilderDialog } from "@/features/online-store/components/page-builder-dialog";
import { ShippingWorkspaceNav } from "@/features/orders/components/shipping-workspace-nav";
import { shippingWorkspaceModuleIds } from "@/features/orders/constants/shipping";
import { getShippingModuleSummary } from "@/features/orders/lib/shipping";
import { CategoryManager } from "@/features/products/components/category-manager";
import { formatResourceCellText } from "@/features/resources/components/resource-cell-value";
import { ResourceRecordDialog } from "@/features/resources/components/resource-record-dialog";
import { ResourceShortcuts } from "@/features/resources/components/resource-shortcuts";
import { ResourceTable } from "@/features/resources/components/resource-table";
import { ResourceToolbar } from "@/features/resources/components/resource-toolbar";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { navigate } from "@/lib/navigation";
import { getRecordLabel, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";
import { archiveRecords } from "@/lib/store/records";

function resolveSourceModuleConfig(e) {
  return e.derived ? modulesById[e.derived] : e;
}

function resourceFieldLabel(e, t) {
  return (
    e.fields.find((e) => e.key === t)?.label ||
    {
      total: "Total",
      net: "Vendor net",
    }[t] ||
    t
  );
}

export function ResourceModulePage({ moduleId, initialQuery = "" }) {
  const n = modulesById[moduleId];
  const r = resolveSourceModuleConfig(n);
  const i = n.categoryManager || null;
  const [a, o] = useState(initialQuery);
  const [s, c] = useState("");
  const [u, d] = useState("");
  const [f, p] = useState(1);
  const [m, h] = useState(1);
  const [g, _] = useState(8);
  const [v, y] = useState(() => new Set());
  const [b, x] = useState(false);
  const [S, C] = useState(0);
  const [w, T] = useState(null);
  const [E, D] = useState(null);
  const [O, k] = useState(null);
  const [A, j] = useState(null);
  const M = useMemo(
    () =>
      listRecords(n.id, {
        archived: b,
      }),
    [n.id, b, S],
  );
  const N = useMemo(() => listRecords(n.id), [n.id, S]);
  const ee = r.fields.find((e) => e.key === "status")?.options || [];
  const te = useMemo(() => {
    let e = [...M];
    if (a) {
      const t = a.toLowerCase();
      e = e.filter((e) =>
        [
          ...Object.values(e),
          ...r.fields
            .filter((e) => e.relation)
            .map((t) => getRecordLabel(t.relation, e[t.key])),
        ]
          .join(" ")
          .toLowerCase()
          .includes(t),
      );
    }
    if (s) {
      e = e.filter(
        (e) =>
          e.status === s ||
          (s === "Low stock" && Number(e.stock) <= Number(e.threshold)),
      );
    }
    if (u) {
      e.sort((e, t) => {
        const n = u === "total" ? calculateOrderTotal(e) : e[u];
        const r = u === "total" ? calculateOrderTotal(t) : t[u];
        return (
          f *
          (typeof n == "number" && typeof r == "number"
            ? n - r
            : String(n || "").localeCompare(String(r || "")))
        );
      });
    }
    return e;
  }, [M, r.fields, a, s, u, f]);
  const ne = Math.max(1, Math.ceil(te.length / g));
  const re = Math.min(m, ne);
  const ie = te.slice((re - 1) * g, re * g);
  const ae = checkoutResourceIds.has(n.id)
    ? buildCheckoutSummaryMetrics(n.id)
    : inventoryModuleIds.has(n.id)
      ? getInventoryModuleSummary(n.id)
      : shippingWorkspaceModuleIds.has(n.id)
        ? getShippingModuleSummary(n.id, N)
        : n.id === "orders"
          ? [
              ["Orders", N.length, "Order book"],
              [
                "Order value",
                formatCurrency(
                  N.filter((e) => e.status !== "Cancelled").reduce(
                    (e, t) => e + calculateOrderTotal(t),
                    0,
                  ),
                  2,
                ),
                "Excludes cancellations",
              ],
              [
                "To fulfill",
                N.filter((e) =>
                  ["Unfulfilled", "Processing", "Packed"].includes(
                    String(e.status || ""),
                  ),
                ).length,
                "Ready for the next step",
              ],
              [
                "Delivered",
                N.filter((e) => e.status === "Delivered").length,
                "Happy arrivals",
              ],
            ]
          : [
              ["Total records", N.length, n.title],
              [
                "Needs attention",
                N.filter((e) =>
                  /pending|requested|draft|new|open/i.test(
                    String(e.status || ""),
                  ),
                ).length,
                "Review when you’re ready",
              ],
              [
                "Active / complete",
                N.filter((e) =>
                  /active|published|delivered|approved|resolved|enabled/i.test(
                    String(e.status || ""),
                  ),
                ).length,
                "Current records",
              ],
            ];
  const oe = () => y(new Set());
  const se = () => {
    oe();
    C((e) => e + 1);
  };
  const ce = (e) => {
    o(e);
    h(1);
    oe();
  };
  const le = (e) => {
    c(e);
    h(1);
    oe();
  };
  const ue = (e) => {
    x(e);
    h(1);
    oe();
  };
  const de = (e) => {
    p((t) => (u === e && t === 1 ? -1 : 1));
    d(e);
  };
  const fe = (e, t) =>
    y((n) => {
      const r = new Set(n);
      if (t) {
        r.add(e);
      } else {
        r.delete(e);
      }
      return r;
    });
  const pe = (e) =>
    y((t) => {
      const n = new Set(t);
      ie.forEach((t) => (e ? n.add(t.id) : n.delete(t.id)));
      return n;
    });
  const me = (e, t) => {
    try {
      archiveRecords(r.id, e, t);
      se();
      showToast(
        t
          ? "Records restored."
          : "Records archived. Switch on Archived to restore them.",
      );
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "This change could not be completed.",
      );
    }
  };
  const he = () => {
    const e = n.columns;
    const t = te.map((t) =>
      Object.fromEntries(
        e.map((e) => [
          e,
          r.fields.find((t) => t.key === e)?.relation
            ? getRecordLabel(r.fields.find((t) => t.key === e).relation, t[e])
            : formatResourceCellText(r, t, e),
        ]),
      ),
    );
    downloadFile(
      `veylix-${n.id}.csv`,
      "﻿" +
        buildCsv(
          t,
          e,
          e.map((e) => resourceFieldLabel(r, e)),
        ),
    );
    showToast("Filtered records exported.");
  };
  const ge = (e) => {
    if (n.id === "variants") {
      const t = M.find((t) => t.id === e);
      if (t?.productId) {
        navigate(
          `/commerce/products/edit?id=${encodeURIComponent(String(t.productId))}`,
        );
      }
    } else {
      if (n.editor === "stock") {
        D(e);
      } else {
        T({
          mode: "edit",
          recordId: e,
        });
      }
    }
  };
  return (
    <Fragment>
      <CommercePageHeading
        title={n.title}
        onExport={he}
        onCreate={
          !n.readonly && !n.derived
            ? () =>
                T({
                  mode: n.id === "variants" ? "variant-picker" : "create",
                })
            : void 0
        }
        createLabel={`Add ${n.addLabel || (n.id === "orders" ? "order" : n.id === "blog" ? "blog post" : n.id === "testimonials" ? "testimonial" : n.id.endsWith("-categories") ? "category" : "record")}`}
      />
      {shippingWorkspaceModuleIds.has(n.id) ? (
        <ShippingWorkspaceNav active={n.id} />
      ) : (
        <ResourceShortcuts moduleId={n.id} title={n.title} />
      )}
      <SummaryList items={ae} />
      {i ? <CategoryManager config={i} onChanged={se} /> : null}
      <section className="glass-card c-resource react-resource-shell">
        <ResourceToolbar
          title={n.title}
          query={a}
          filter={s}
          archived={b}
          statuses={ee}
          includeLowStock={n.id === "stock"}
          onQueryChange={ce}
          onFilterChange={le}
          onArchivedChange={ue}
          extra={
            n.id === "variants" ? (
              <button
                type="button"
                className="secondary-button"
                data-c-action="variant-picker"
                onClick={() =>
                  T({
                    mode: "variant-picker",
                  })
                }
              >
                <Icon name="sparkle" />
                {" Manage product options"}
              </button>
            ) : (
              void 0
            )
          }
        />
        <div id="resource-results">
          <BulkSelectionBar
            count={v.size}
            archived={b}
            onBulkArchive={() => me([...v], b)}
            onClear={oe}
          />
          {te.length ? (
            <ResourceTable
              module={n}
              sourceModule={r}
              rows={ie}
              selected={v}
              sort={u}
              direction={f}
              archived={b}
              onSort={de}
              onToggleRow={fe}
              onToggleAll={pe}
              onDetail={(e) =>
                T({
                  mode: "detail",
                  recordId: e,
                })
              }
              onEdit={ge}
              onRestore={(e) => me([e], true)}
              onWebhookPayload={n.id === "webhooks" ? j : void 0}
            />
          ) : (
            <div
              className="table-scroll c-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={`${n.title} records`}
            >
              <div className="c-empty">
                <Icon name="basket" />
                <h3>
                  {a || s
                    ? "No matches just yet"
                    : b
                      ? "Nothing archived"
                      : "A fresh start"}
                </h3>
                <p>
                  {a || s
                    ? "Try another search or clear your filters."
                    : "Your records will appear here as you add them."}
                </p>
              </div>
            </div>
          )}
          <TablePagination
            total={te.length}
            page={re}
            pages={ne}
            size={g}
            onSizeChange={(e) => {
              _(e);
              h(1);
            }}
            onPrevious={() => h(Math.max(1, re - 1))}
            onNext={() => h(Math.min(ne, re + 1))}
          />
        </div>
      </section>
      {w ? (
        <ResourceRecordDialog
          module={n}
          mode={w.mode}
          recordId={w.recordId}
          onClose={() => T(null)}
          onChanged={se}
          onEdit={ge}
          onPageBuilder={(e) => {
            T(null);
            k(e);
          }}
        />
      ) : null}
      {O ? (
        <PageBuilderDialog pageId={O} onClose={() => k(null)} onChanged={se} />
      ) : null}
      {A ? <WebhookPayloadDialog recordId={A} onClose={() => j(null)} /> : null}
      {E
        ? (() => {
            const e = M.find((e) => e.id === E);
            return e ? (
              <InventoryAdjustDialog
                row={e}
                onClose={() => D(null)}
                onChanged={se}
              />
            ) : null;
          })()
        : null}
    </Fragment>
  );
}
