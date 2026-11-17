"use client";

import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { useDismiss } from "@/components/ui/use-dismiss";
import type { VmsOrder } from "@/types/vms";

export interface FilterOption {
  value: string;
  label: string;
  hint?: string;
  logo?: string;
}

/** Multi-select filter (TrackVid `Autocomplete multiple`) as a template popover with a checkbox list. */
export function MultiFilter({ label, values, options, onChange, loading = false, emptyText = "No options" }: { label: string; values: readonly string[]; options: readonly FilterOption[]; onChange: (values: string[]) => void; loading?: boolean; emptyText?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  useDismiss(open, ref, close);
  const q = query.trim().toLowerCase();
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q));
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);

  return (
    <div className="tv-popover-wrap" ref={ref}>
      <button type="button" className={`secondary-button tv-vms-filter ${values.length ? "is-active" : ""}`.trim()} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="funnel" />
        {label}
        {values.length ? <span className="tv-tab-count">{values.length}</span> : null}
        <Icon name="caret-down" />
      </button>
      {open ? (
        <div className="tv-popover align-left tv-vms-filter-pop" role="dialog" aria-label={`${label} filter`}>
          {options.length > 6 ? (
            <label className="c-search tv-vms-filter-search">
              <Icon name="search" />
              <input type="search" placeholder={`Search ${label.toLowerCase()}…`} value={query} aria-label={`Search ${label}`} onChange={(e) => setQuery(e.currentTarget.value)} />
            </label>
          ) : null}
          <div className="tv-vms-filter-list">
            {loading ? (
              <p className="tv-muted tv-small">Loading…</p>
            ) : shown.length ? (
              shown.map((o) => (
                <label key={o.value} className="tv-check">
                  <input type="checkbox" checked={values.includes(o.value)} onChange={() => toggle(o.value)} />
                  {o.logo ? <img src={o.logo} alt="" className="tv-vms-filter-logo" /> : null}
                  <span>{o.label}</span>
                  {o.hint ? <small className="tv-muted">{o.hint}</small> : null}
                </label>
              ))
            ) : (
              <p className="tv-muted tv-small">{emptyText}</p>
            )}
          </div>
          {values.length ? (
            <button type="button" className="secondary-button compact-button" onClick={() => onChange([])}>
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type ExportScope = "selected" | "page" | "all";

/** TrackVid "Export" menu: Selected / Page Orders / All N Orders. */
export function ExportMenu({ selectedCount, total, busy, onExport }: { selectedCount: number; total: number; busy: boolean; onExport: (scope: ExportScope) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  const choose = (scope: ExportScope) => {
    setOpen(false);
    onExport(scope);
  };
  return (
    <div className="tv-popover-wrap" ref={ref}>
      <button type="button" className="primary-button" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)}>
        {busy ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="upload" />}
        Export
        <Icon name="caret-down" />
      </button>
      {open ? (
        <div className="tv-popover" role="menu" aria-label="Export orders">
          <div className="tv-menu-list">
            <button type="button" role="menuitem" disabled={!selectedCount} onClick={() => choose("selected")}>
              <Icon name="check-circle" /> Selected {selectedCount ? `(${selectedCount})` : ""}
            </button>
            <button type="button" role="menuitem" onClick={() => choose("page")}>
              <Icon name="file-text" /> Page Orders
            </button>
            <button type="button" role="menuitem" onClick={() => choose("all")}>
              <Icon name="database" /> All {total} Orders
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** TrackVid `OrderTypeTrackingId`: arrow (green forward / red return) + scanned number. */
export function OrderTypeTrackingId({ order }: { order: Pick<VmsOrder, "orderType" | "trackingId"> }) {
  const isReturn = order.orderType === "Return";
  return (
    <span className="tv-vms-tracking">
      <span className={`tv-vms-type-arrow ${isReturn ? "is-return" : "is-forward"}`} title={order.orderType} aria-label={order.orderType}>
        <Icon name={isReturn ? "arrow-left" : "arrow-right"} />
      </span>
      <span className="tv-mono">{order.trackingId}</span>
    </span>
  );
}

/** GOOD / BAD parcel condition chip. */
export function ConditionChip({ condition }: { condition: number | null | undefined }) {
  if (condition !== 1 && condition !== 2) return <>-</>;
  return <span className={`c-status ${condition === 1 ? "green" : "red"} tv-vms-chip`}>{condition === 1 ? "GOOD" : "BAD"}</span>;
}
