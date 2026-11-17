"use client";

import { useState } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { Combobox } from "@/components/ui/combobox";
import { SearchInput } from "@/components/ui/form-field";
import { formatDateTime } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { getMeeshoMasterList, getMyntraMasterList, getSnapdealMasterList } from "@/services/masterData-service";
import type { MeeshoOrder, MyntraOrder, SnapdealOrder } from "@/types/master-data";

export type PlatformMasterKind = "MEESHO" | "SNAPDEAL" | "MYNTRA";

const toISODate = (d: Date): string => {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fallback = (v: string | number | null | undefined): string => (v || v === 0 ? String(v) : "---");
const dateTime = (v: string | null | undefined): string => (v ? formatDateTime(v) : "---");
const mono = (v: string | null | undefined) => <span className="tv-mono">{fallback(v)}</span>;

const MEESHO_COLUMNS: DataColumn<MeeshoOrder>[] = [
  { key: "subOrderNo", header: "Sub Order No", width: 200, sortable: true, render: (r) => mono(r.subOrderNo) },
  { key: "orderNumber", header: "Order Number", width: 170, sortable: true, render: (r) => fallback(r.orderNumber) },
  { key: "orderDate", header: "Order Date", width: 180, sortable: true, render: (r) => dateTime(r.orderDate) },
  { key: "skuForward", header: "SKU (Forward)", width: 170, render: (r) => fallback(r.skuForward) },
  { key: "quantityForward", header: "Qty (Forward)", width: 120, align: "right", render: (r) => fallback(r.quantityForward) },
  { key: "packetId", header: "Packet ID", width: 150, render: (r) => fallback(r.packetId) },
  { key: "skuReturn", header: "SKU (Return)", width: 170, render: (r) => fallback(r.skuReturn) },
  { key: "qtyReturn", header: "Qty (Return)", width: 120, align: "right", render: (r) => fallback(r.qtyReturn) },
  { key: "returnAwbNo", header: "Return AWB No", width: 180, render: (r) => mono(r.returnAwbNo) },
  { key: "returnCreatedDate", header: "Return Created Date", width: 190, sortable: true, render: (r) => dateTime(r.returnCreatedDate) },
  { key: "typeOfReturn", header: "Type of Return", width: 190, render: (r) => fallback(r.typeOfReturn) },
  { key: "supplierEmailId", header: "Supplier Email", width: 220, render: (r) => fallback(r.supplierEmailId) },
  { key: "createdAt", header: "Created At", width: 180, sortable: true, render: (r) => dateTime(r.createdAt) },
];

const SNAPDEAL_COLUMNS: DataColumn<SnapdealOrder>[] = [
  { key: "subOrderNo", header: "Sub Order No", width: 170, sortable: true, render: (r) => mono(r.subOrderNo) },
  { key: "orderCode", header: "Order Code", width: 160, sortable: true, render: (r) => fallback(r.orderCode) },
  { key: "orderCreatedDate", header: "Order Date", width: 180, sortable: true, render: (r) => dateTime(r.orderCreatedDate) },
  { key: "skuCode", header: "SKU Code", width: 190, render: (r) => fallback(r.skuCode) },
  { key: "packageId", header: "Package ID", width: 150, render: (r) => fallback(r.packageId) },
  { key: "referenceCode", header: "Reference Code", width: 170, render: (r) => fallback(r.referenceCode) },
  { key: "forwardAwbNo", header: "Forward AWB No", width: 180, render: (r) => mono(r.forwardAwbNo) },
  { key: "returnAwbNo", header: "Return AWB No", width: 180, render: (r) => mono(r.returnAwbNo) },
  { key: "returnInitiatedOn", header: "Return Initiated On", width: 190, sortable: true, render: (r) => dateTime(r.returnInitiatedOn) },
  { key: "returnDeliveredOn", header: "Return Delivered On", width: 190, render: (r) => dateTime(r.returnDeliveredOn) },
  { key: "shippingProvider", header: "Shipping Provider", width: 160, render: (r) => fallback(r.shippingProvider) },
  { key: "reverseCourierCode", header: "Reverse Courier", width: 150, render: (r) => fallback(r.reverseCourierCode) },
  { key: "status", header: "Status", width: 170, render: (r) => <span className="tv-master-chip is-blue">{fallback(r.status)}</span> },
  { key: "snapdeal_account_username", header: "Account Username", width: 180, render: (r) => fallback(r.snapdeal_account_username) },
  { key: "createdAt", header: "Created At", width: 180, sortable: true, render: (r) => dateTime(r.createdAt) },
];

const MYNTRA_COLUMNS: DataColumn<MyntraOrder>[] = [
  { key: "returnTrackingNumber", header: "Return Tracking Number", width: 200, sortable: true, render: (r) => mono(r.returnTrackingNumber) },
  { key: "forwardTrackingNumber", header: "Forward Tracking Number", width: 200, render: (r) => mono(r.forwardTrackingNumber) },
  { key: "orderDeliveredDate", header: "Order Delivered Date", width: 190, sortable: true, render: (r) => dateTime(r.orderDeliveredDate) },
  { key: "returnCreatedDate", header: "Return Created Date", width: 190, sortable: true, render: (r) => dateTime(r.returnCreatedDate) },
  { key: "skuId", header: "SKU ID", width: 160, render: (r) => fallback(r.skuId) },
  { key: "model", header: "Model", width: 120, render: (r) => fallback(r.model) },
  { key: "status", header: "Status", width: 170, render: (r) => <span className="tv-master-chip is-blue">{fallback(r.status)}</span> },
  { key: "myntra_account_username", header: "Account Username", width: 180, render: (r) => fallback(r.myntra_account_username) },
  { key: "createdAt", header: "Created At", width: 180, sortable: true, render: (r) => dateTime(r.createdAt) },
];

interface PlatformMasterTableProps {
  kind: PlatformMasterKind;
  search: string;
  debouncedSearch: string;
  onSearch: (value: string) => void;
  range: DateRange;
  onRange: (range: DateRange) => void;
  page: number;
  limit: number;
  onPage: (page: number) => void;
  onLimit: (limit: number) => void;
}

/** Meesho / Snapdeal / Myntra master tabs (TrackVid `useMeeshoMaster`, `useSnapdealMaster`, `useMyntraMaster`). */
export function PlatformMasterTable({ kind, search, debouncedSearch, onSearch, range, onRange, page, limit, onPage, onLimit }: PlatformMasterTableProps) {
  // Meesho filters by "Type of Return", Snapdeal / Myntra by "Status" (the column filter in TrackVid).
  const [filterValue, setFilterValue] = useState("");
  const base = {
    searchInput: debouncedSearch || "",
    limit,
    page,
    // Date filter is bypassed when searching, per API spec
    ...(debouncedSearch ? {} : { startDate: toISODate(range.startDate), endDate: toISODate(range.endDate) }),
  };
  const deps = [kind, debouncedSearch, range.startDate.getTime(), range.endDate.getTime(), page, limit, filterValue];

  const meesho = useAsync(
    () => (kind === "MEESHO" ? getMeeshoMasterList({ ...base, typeOfReturn: filterValue || undefined }) : Promise.resolve(null)),
    deps,
  );
  const snapdeal = useAsync(
    () => (kind === "SNAPDEAL" ? getSnapdealMasterList({ ...base, status: filterValue || undefined }) : Promise.resolve(null)),
    deps,
  );
  const myntra = useAsync(
    () => (kind === "MYNTRA" ? getMyntraMasterList({ ...base, status: filterValue || undefined }) : Promise.resolve(null)),
    deps,
  );

  const filterOptions =
    kind === "MEESHO" ? (meesho.data?.filters.typeOfReturn ?? []) : kind === "SNAPDEAL" ? (snapdeal.data?.filters.status ?? []) : (myntra.data?.filters.status ?? []);
  const state = kind === "MEESHO" ? meesho : kind === "SNAPDEAL" ? snapdeal : myntra;
  const total = state.data?.metadata.total ?? 0;

  const common = {
    loading: state.loading,
    error: state.error,
    onRetry: state.reload,
    emptyTitle: "No master data found",
    emptyMessage: "Upload this platform's report from Imports → Master Data, or widen the date range.",
    pagination: "server" as const,
    page,
    pageSize: limit,
    pageSizes: [25, 50, 100],
    total,
    onPageChange: onPage,
    onPageSizeChange: (s: number) => {
      onLimit(s);
      onPage(1);
    },
  };

  return (
    <>
      <div className="c-toolbar tv-master-toolbar">
        <SearchInput value={search} onChange={onSearch} placeholder="Search..." />
        <div className="tv-master-toolbar-actions">
          <div className="tv-master-inline-filter">
            <Combobox
              label={kind === "MEESHO" ? "Type of Return" : "Status"}
              placeholder={kind === "MEESHO" ? "Select type" : "Select status"}
              value={filterValue}
              options={filterOptions.map((o) => ({ value: o === "" ? "Null" : o, label: o === "" ? "---" : o }))}
              onChange={(v) => {
                setFilterValue(v);
                onPage(1);
              }}
            />
            {filterValue ? (
              <button type="button" className="secondary-button compact-button" onClick={() => setFilterValue("")}>
                Clear
              </button>
            ) : null}
          </div>
          <DateRangePicker value={range} onChange={(r) => r && onRange(r)} />
        </div>
      </div>
      {kind === "MEESHO" ? (
        <DataTable label="Meesho master data" columns={MEESHO_COLUMNS} rows={meesho.data?.order ?? []} getRowId={(r) => r._id} storageKey="master-data-meesho" {...common} />
      ) : kind === "SNAPDEAL" ? (
        <DataTable label="Snapdeal master data" columns={SNAPDEAL_COLUMNS} rows={snapdeal.data?.order ?? []} getRowId={(r) => r._id} storageKey="master-data-snapdeal" {...common} />
      ) : (
        <DataTable label="Myntra master data" columns={MYNTRA_COLUMNS} rows={myntra.data?.order ?? []} getRowId={(r) => r._id} storageKey="master-data-myntra" {...common} />
      )}
    </>
  );
}
