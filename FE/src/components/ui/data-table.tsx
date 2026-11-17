"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/ui/table-pagination";
import { readStored, writeStored } from "@/lib/storage";

export type SortDirection = "asc" | "desc";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  /** Plain-text header used for aria labels when `header` is not a string. */
  label?: string;
  width?: number;
  minWidth?: number;
  sortable?: boolean;
  /** Value used for client-side sorting (defaults to `row[key]`). */
  sortValue?: (row: T) => string | number | null | undefined;
  render?: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  wrap?: boolean;
  hidden?: boolean;
}

export interface DataTableProps<T> {
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  label: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyMessage?: ReactNode;
  /** Selection (checkbox column) — pass both to enable. */
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  isRowSelectable?: (row: T) => boolean;
  /** Tooltip on a disabled row checkbox explaining why it cannot be selected. */
  selectionDisabledReason?: (row: T) => string | undefined;
  /** Sorting: controlled when `sort` + `onSortChange` are passed (server sort); otherwise sorted in the table. */
  sort?: { key: string; direction: SortDirection } | null;
  onSortChange?: (sort: { key: string; direction: SortDirection }) => void;
  /** Paging: `server` uses `total` + callbacks; `client` slices `rows`; `none` shows all rows. */
  pagination?: "client" | "server" | "none";
  page?: number;
  pageSize?: number;
  total?: number;
  pageSizes?: readonly number[];
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  /** localStorage key for remembered column widths. */
  storageKey?: string;
  minTableWidth?: number;
}

function defaultSortValue<T>(row: T, key: string): string | number {
  const v = (row as Record<string, unknown>)[key];
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return "";
  return String(v).toLowerCase();
}

/** Typed table on template markup (`c-table`), replacing MUI DataGrid. */
export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    rows,
    getRowId,
    label,
    loading = false,
    error,
    onRetry,
    emptyTitle = "No records found",
    emptyMessage = "Try another search or clear your filters.",
    selected,
    onSelectedChange,
    isRowSelectable,
    selectionDisabledReason,
    sort: controlledSort,
    onSortChange,
    pagination = "client",
    page: controlledPage,
    pageSize: controlledSize,
    total,
    pageSizes,
    onPageChange,
    onPageSizeChange,
    onRowClick,
    rowClassName,
    storageKey,
    minTableWidth,
  } = props;

  const visibleColumns = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const selectable = Boolean(selected && onSelectedChange);

  // ----- column widths (resizable) -----
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    storageKey ? readStored<Record<string, number>>(`table-widths:${storageKey}`, {}) : {},
  );
  const dragRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);

  useEffect(() => {
    if (!resizing) return;
    const controller = new AbortController();
    const { signal } = controller;
    window.addEventListener(
      "pointermove",
      (e) => {
        const d = dragRef.current;
        if (!d) return;
        const col = visibleColumns.find((c) => c.key === d.key);
        const min = col?.minWidth ?? 70;
        setWidths((w) => ({ ...w, [d.key]: Math.max(min, Math.round(d.startW + e.clientX - d.startX)) }));
      },
      { signal },
    );
    window.addEventListener(
      "pointerup",
      () => {
        dragRef.current = null;
        setResizing(null);
      },
      { signal },
    );
    return () => controller.abort();
  }, [resizing, visibleColumns]);

  useEffect(() => {
    if (storageKey && !resizing) writeStored(`table-widths:${storageKey}`, widths);
  }, [widths, resizing, storageKey]);

  // ----- sorting -----
  const [localSort, setLocalSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const sort = onSortChange ? (controlledSort ?? null) : localSort;
  const toggleSort = (key: string) => {
    const next = { key, direction: sort?.key === key && sort.direction === "asc" ? ("desc" as const) : ("asc" as const) };
    if (onSortChange) onSortChange(next);
    else setLocalSort(next);
  };

  const sortedRows = useMemo(() => {
    if (onSortChange || !sort) return rows;
    const col = visibleColumns.find((c) => c.key === sort.key);
    const get = (r: T) => (col?.sortValue ? (col.sortValue(r) ?? "") : defaultSortValue(r, sort.key));
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [rows, sort, onSortChange, visibleColumns]);

  // ----- paging -----
  const [localPage, setLocalPage] = useState(1);
  const [localSize, setLocalSize] = useState(pageSizes?.[0] ?? 10);
  const page = controlledPage ?? localPage;
  const size = controlledSize ?? localSize;
  const setPage = (p: number) => (onPageChange ? onPageChange(p) : setLocalPage(p));
  const setSize = (s: number) => {
    if (onPageSizeChange) onPageSizeChange(s);
    else setLocalSize(s);
    setPage(1);
  };
  const totalRows = pagination === "server" ? (total ?? rows.length) : sortedRows.length;
  const maxPage = Math.max(1, Math.ceil(totalRows / size));
  const safePage = Math.min(page, maxPage);
  const pageRows =
    pagination === "client" ? sortedRows.slice((safePage - 1) * size, safePage * size) : sortedRows;

  // ----- selection -----
  const selectableRows = pageRows.filter((r) => !isRowSelectable || isRowSelectable(r));
  const allChecked = selectable && selectableRows.length > 0 && selectableRows.every((r) => selected?.has(getRowId(r)));
  const someChecked = selectable && selectableRows.some((r) => selected?.has(getRowId(r)));
  const headCheckRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headCheckRef.current) headCheckRef.current.indeterminate = Boolean(someChecked && !allChecked);
  }, [someChecked, allChecked]);

  const toggleAll = (checked: boolean) => {
    if (!selected || !onSelectedChange) return;
    const next = new Set(selected);
    for (const r of selectableRows) {
      if (checked) next.add(getRowId(r));
      else next.delete(getRowId(r));
    }
    onSelectedChange(next);
  };
  const toggleRow = (id: string, checked: boolean) => {
    if (!selected || !onSelectedChange) return;
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  const colStyle = (c: DataColumn<T>): CSSProperties => {
    const w = widths[c.key] ?? c.width;
    return w ? { width: w } : {};
  };
  const tableMin =
    minTableWidth ?? Math.max(640, visibleColumns.reduce((sum, c) => sum + (widths[c.key] ?? c.width ?? 150), selectable ? 44 : 0));
  const colCount = visibleColumns.length + (selectable ? 1 : 0);

  let body: ReactNode;
  if (loading) {
    body = Array.from({ length: Math.min(size, 6) }, (_, i) => (
      <tr key={`sk-${i}`} className="tv-table-loading">
        {selectable ? <td className="c-check" /> : null}
        {visibleColumns.map((c) => (
          <td key={c.key}>
            <Skeleton width={`${55 + ((i * 17 + c.key.length * 7) % 40)}%`} />
          </td>
        ))}
      </tr>
    ));
  } else if (error) {
    body = (
      <tr>
        <td colSpan={colCount}>
          <ErrorState message={error} onRetry={onRetry} />
        </td>
      </tr>
    );
  } else if (!pageRows.length) {
    body = (
      <tr>
        <td colSpan={colCount}>
          <EmptyState title={emptyTitle} message={emptyMessage} />
        </td>
      </tr>
    );
  } else {
    body = pageRows.map((row, index) => {
      const id = getRowId(row);
      const isSel = Boolean(selected?.has(id));
      const canSelect = !isRowSelectable || isRowSelectable(row);
      return (
        <tr
          key={id}
          className={`${isSel ? "is-selected" : ""} ${onRowClick ? "is-clickable" : ""} ${rowClassName?.(row) ?? ""}`.replace(/\s+/g, " ").trim() || undefined}
          onClick={
            onRowClick
              ? (e) => {
                  const t = e.target;
                  if (t instanceof Element && t.closest("button, a, input, select, label, textarea")) return;
                  onRowClick(row);
                }
              : undefined
          }
        >
          {selectable ? (
            <td className="c-check">
              <input
                type="checkbox"
                checked={isSel}
                disabled={!canSelect}
                title={!canSelect ? selectionDisabledReason?.(row) : undefined}
                onChange={(e) => toggleRow(id, e.currentTarget.checked)}
                aria-label={`Select row ${index + 1}`}
              />
            </td>
          ) : null}
          {visibleColumns.map((c) => (
            <td key={c.key} style={{ textAlign: c.align }} className={c.wrap ? "tv-cell-wrap" : undefined}>
              {c.render ? c.render(row, index) : String((row as Record<string, unknown>)[c.key] ?? "—")}
            </td>
          ))}
        </tr>
      );
    });
  }

  return (
    <>
      <div className="table-scroll c-table-scroll" tabIndex={0} role="region" aria-label={label} aria-busy={loading}>
        <table className="c-table tv-data-table" style={{ minWidth: tableMin }}>
          <colgroup>
            {selectable ? <col style={{ width: 44 }} /> : null}
            {visibleColumns.map((c) => (
              <col key={c.key} style={colStyle(c)} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="c-check">
                  <input
                    ref={headCheckRef}
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => toggleAll(e.currentTarget.checked)}
                    aria-label="Select all visible rows"
                    disabled={loading || !selectableRows.length}
                  />
                </th>
              ) : null}
              {visibleColumns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={{ textAlign: c.align }}
                    aria-sort={c.sortable ? (active ? (sort?.direction === "asc" ? "ascending" : "descending") : "none") : undefined}
                  >
                    {c.sortable ? (
                      <button type="button" onClick={() => toggleSort(c.key)}>
                        {c.header}
                        <Icon name={active && sort?.direction === "desc" ? "arrow-down" : "arrow-up"} />
                      </button>
                    ) : (
                      c.header
                    )}
                    <span
                      className={`tv-col-resizer ${resizing === c.key ? "is-active" : ""}`.trim()}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${c.label ?? (typeof c.header === "string" ? c.header : c.key)} column`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        const th = e.currentTarget.parentElement;
                        dragRef.current = { key: c.key, startX: e.clientX, startW: th?.getBoundingClientRect().width ?? 150 };
                        setResizing(c.key);
                      }}
                      onDoubleClick={() =>
                        setWidths((w) => {
                          const next = { ...w };
                          delete next[c.key];
                          return next;
                        })
                      }
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      {pagination !== "none" && !error ? (
        <TablePagination total={totalRows} page={safePage} size={size} sizes={pageSizes} onPageChange={setPage} onSizeChange={setSize} />
      ) : null}
    </>
  );
}

/** Template bulk bar (`c-selection`) with custom actions. */
export function BulkSelectionBar({ count, children, onClear }: { count: number; children?: ReactNode; onClear: () => void }) {
  if (!count) return null;
  return (
    <div className="c-selection">
      <strong>{count} selected</strong>
      {children}
      <button type="button" className="secondary-button" onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}
