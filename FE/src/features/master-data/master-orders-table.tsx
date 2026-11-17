"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataColumn, type SortDirection } from "@/components/ui/data-table";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { Combobox } from "@/components/ui/combobox";
import { SearchInput } from "@/components/ui/form-field";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { MASTER_DATA } from "@/config/constant";
import { downloadText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { readStored, writeStored } from "@/lib/storage";
import { useAsync } from "@/lib/use-async";
import { MasterData } from "@/services/masterData-service";
import { whatsappNumberService } from "@/services/whatsappNumber-service";
import type { IFilter, MasterFilterKey, MasterOrder, MasterOrderReportPayload } from "@/types/master-data";
import { MasterHistoryDialog, MasterRejectDialog, MasterTicketDialog, MasterViewReasonDialog } from "./components/master-dialogs";
import { ToolbarPopover } from "./components/toolbar-popover";

// Poll the table after queueing so the ✅/❌ state updates without a manual refresh.
const BULK_RETRY_POLL_DELAYS_MS = [1500, 2000, 2500, 3000];
// Mirrors the BE D2C_RETRY_COOLDOWN_MS — locks the button for 30 min after click.
const RETRY_ALL_COOLDOWN_MS = 30 * 60 * 1000;
const RETRY_ALL_COOLDOWN_KEY_PREFIX = "trackvid_d2c_retry_all_last_click_at";
// Hard upper bound on a single "Export All" click (mirrors the BE cap in fillMasterImportOrderReports).
const D2C_EXPORT_MAX_ROWS = 20000;

// Returns null when companyId is missing so one cooldown is never shared across companies on the same browser.
const buildRetryCooldownKey = (companyId: string | undefined): string | null => (companyId ? `${RETRY_ALL_COOLDOWN_KEY_PREFIX}_${companyId}` : null);

const formatCooldownRemaining = (ms: number): string => {
  if (ms <= 0) return "";
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  if (sec === 0) return `${min}m`;
  return `${min}m ${sec}s`;
};

const dash = (v: string | number | null | undefined): string => (v === null || v === undefined || v === "" ? "---" : String(v));
const dateCell = (v: string | null | undefined): string => (v ? formatDateTime(v) : "---");

type FilterState = Record<MasterFilterKey, string>;
const EMPTY_FILTERS: FilterState = {
  orderStatus: "",
  parcelCondition: "",
  return_order_Carrier: "",
  carrier: "",
  importPlatForm: "",
  returnOrderType: "",
  brand: "",
  sellerName: "",
  claimStatus: "",
};
const FILTER_LABELS: Record<MasterFilterKey, string> = {
  orderStatus: "Order Status",
  parcelCondition: "Parcel Condition",
  claimStatus: "Claim Status",
  carrier: "Carrier",
  return_order_Carrier: "Return Order Carrier",
  brand: "Brand",
  sellerName: "Seller Name",
  returnOrderType: "Return Order Type",
  importPlatForm: "Import Platform",
};

const filterOptionLabel = (key: MasterFilterKey, value: string): string => {
  if (key === "parcelCondition") return Number(value) === 1 ? "GOOD" : Number(value) === 2 ? "BAD" : "---";
  return value === "" ? "---" : value;
};

const CLAIM_TONES: Record<string, string> = {
  [MASTER_DATA.PENDING]: "is-amber",
  [MASTER_DATA.IN_REVIEW]: "is-blue",
  [MASTER_DATA.APPROVED]: "is-green",
  [MASTER_DATA.REJECTED]: "is-red",
};

interface MasterOrdersTableProps {
  platform: "AJIO" | "D2C";
  companyId: string | undefined;
  canEdit: boolean;
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

/** AJIO + D2C tabs of TrackVid `MasterData` (master import report, claim status actions, history, exports, D2C retry). */
export function MasterOrdersTable(props: MasterOrdersTableProps) {
  const { platform, companyId, canEdit, search, debouncedSearch, onSearch, range, onRange, page, limit, onPage, onLimit } = props;
  const isD2c = platform === "D2C";

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columnOverrides, setColumnOverrides] = useState<Record<string, boolean>>({});
  const [exportLoading, setExportLoading] = useState(false);
  const [ticketFor, setTicketFor] = useState<{ _id: string; ticket: string } | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reasonView, setReasonView] = useState<{ returnAWB: string | null; forwardAWB: string | null; reason: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ id: string; returnAWB: string; forwardAWB: string } | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);

  // ----- D2C retry-all (cooldown in localStorage per company) -----
  const [bulkRetryInFlight, setBulkRetryInFlight] = useState(false);
  const [bulkRetryConfirmOpen, setBulkRetryConfirmOpen] = useState(false);
  const [retryCooldownRemainingMs, setRetryCooldownRemainingMs] = useState(0);
  const retryCooldownKey = buildRetryCooldownKey(companyId);
  const pollTimers = useRef<number[]>([]);

  useEffect(() => {
    // Without a company-scoped key the FE cooldown would collide across companies — rely on the BE limit.
    if (!retryCooldownKey || !isD2c) return;
    const tick = () => {
      const parsed = readStored<number>(retryCooldownKey, 0);
      // Reject NaN / non-finite / non-positive values (tampered or corrupted entry).
      const lastAt = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      const remaining = lastAt ? lastAt + RETRY_ALL_COOLDOWN_MS - Date.now() : 0;
      setRetryCooldownRemainingMs(remaining > 0 ? remaining : 0);
    };
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [retryCooldownKey, isD2c]);

  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, []);

  const claimStatus = filters.claimStatus;
  const payload: MasterOrderReportPayload = {
    startDate: range.startDate,
    endDate: range.endDate,
    limit,
    page,
    searchInput: debouncedSearch,
    import_platform: platform,
    order_status: isD2c ? "" : filters.orderStatus,
    orderCondition: isD2c || !filters.parcelCondition ? "" : filters.parcelCondition === "Null" ? "Null" : Number(filters.parcelCondition),
    order_Carrier: isD2c ? "" : filters.carrier,
    return_order_Carrier: isD2c ? "" : filters.return_order_Carrier,
    return_order_type: isD2c ? "" : filters.returnOrderType,
    order_Brand: isD2c ? "" : filters.brand,
    order_Seller_Name: isD2c ? "" : filters.sellerName,
    status: isD2c ? "" : claimStatus,
    sortField: sort?.key,
    sortOrder: sort?.direction,
  };
  const payloadKey = JSON.stringify(payload);
  const { data, loading, error, reload } = useAsync(() => MasterData.getMasterOrderReport(JSON.parse(payloadKey) as MasterOrderReportPayload), [payloadKey]);
  const rows = data?.order ?? [];
  const totalRow = data?.metadata.total ?? 0;
  const filterValues: IFilter | null = data?.filters ?? null;

  const setFilter = (key: MasterFilterKey, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    onPage(1);
  };
  const activeFilters = (Object.keys(filters) as MasterFilterKey[]).filter((k) => filters[k] !== "");

  const handleUpdateStatus = async (id: string, status: string) => {
    if (status === MASTER_DATA.REJECTED) {
      setRejectFor(id);
      return;
    }
    setStatusBusy(id);
    try {
      const res = await MasterData.updateMasterStatus({ _id: id, status });
      toast.success(res.displayMessage);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStatusBusy(null);
    }
  };

  // ----- exports -----
  const downloadExcel = async (exportType: "selected" | "page" | "all") => {
    setExportLoading(true);
    try {
      const res = await MasterData.downloadExternalOrder({
        selectedOrders: exportType === "selected" ? [...selected] : [],
        page: exportType === "page" ? page : 1,
        limit: exportType === "all" ? 0 : limit,
        searchInput: debouncedSearch,
        startDate: range.startDate,
        endDate: range.endDate,
        import_platform: platform,
        order_status: filters.orderStatus,
        status: claimStatus,
      });
      downloadText(res.csv, res.fileName, "text/csv;charset=utf-8");
      toast.success("Excel file download started!");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to download the Excel file"));
    } finally {
      setExportLoading(false);
    }
  };

  // CSV for D2C rows. Numeric-ish fields wrapped in ="..." so Excel keeps long phone numbers / AWBs as text.
  const buildD2cCsvAndDownload = (list: readonly MasterOrder[], scope: "page" | "all") => {
    if (!list.length) {
      toast("Nothing to export");
      return;
    }
    const escapeCsv = (value: unknown): string => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const asExcelText = (value: unknown): string => (value === null || value === undefined || value === "" ? "" : `="${String(value).replace(/"/g, '""')}"`);
    const messageSentLabel = (sent: boolean | undefined) => (sent === true ? "Sent" : sent === false ? "Failed" : "Pending");
    const csvRows = list.map((r) =>
      [asExcelText(r.order_no), asExcelText(r.cust_whatsapp_number), escapeCsv(r.cust_name), asExcelText(r.order_FWD_AWB_no), escapeCsv(messageSentLabel(r.messageSent))].join(","),
    );
    const csv = [["Order ID", "Customer WhatsApp Number", "Customer Name", "AWB Number", "Message Sent"].join(","), ...csvRows].join("\n");
    downloadText(`﻿${csv}`, `D2C_Export_${scope === "all" ? "All" : "Page"}_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    toast.success(`Exported ${list.length} row(s)`);
  };

  const handleExportD2C = async (scope: "page" | "all") => {
    if (scope === "page") {
      buildD2cCsvAndDownload(rows, "page");
      return;
    }
    setExportLoading(true);
    try {
      const requestedAll = totalRow > 0 ? totalRow : D2C_EXPORT_MAX_ROWS;
      const allLimit = Math.min(requestedAll, D2C_EXPORT_MAX_ROWS);
      const willTruncate = totalRow > D2C_EXPORT_MAX_ROWS;
      if (willTruncate) {
        toast(`Exporting the first ${D2C_EXPORT_MAX_ROWS.toLocaleString()} of ${totalRow.toLocaleString()} rows. Narrow the filter (date, status) to export the remainder.`);
      }
      const res = await MasterData.getMasterOrderReport({ ...payload, limit: allLimit, page: 1, sortField: undefined, sortOrder: undefined });
      if (!res.order.length) {
        toast("No D2C records to export");
        return;
      }
      buildD2cCsvAndDownload(res.order, "all");
      if (res.metadata.limitCapped && !willTruncate) {
        toast(`Server capped the export at ${res.order.length.toLocaleString()} rows. Narrow the filter to export the remainder.`);
      }
    } catch (err) {
      toast.error(errorMessage(err, "Export failed"));
    } finally {
      setExportLoading(false);
    }
  };

  const handleBulkRetryD2C = async () => {
    setBulkRetryConfirmOpen(false);
    if (bulkRetryInFlight) return;
    if (retryCooldownRemainingMs > 0) {
      toast(`Retry locked for ${formatCooldownRemaining(retryCooldownRemainingMs)} more.`);
      return;
    }
    setBulkRetryInFlight(true);
    try {
      const res = await whatsappNumberService.retryAllD2CWhatsAppMessages();
      if (res.queued > 0) toast.success(res.message || `${res.queued} retries queued`);
      else toast(res.message || "No rows ready to retry");
      // Only lock when the BE has nothing more eligible; otherwise the seller keeps draining in batches.
      if (retryCooldownKey && res.remainingAfterBatch === 0) {
        writeStored(retryCooldownKey, Date.now());
        setRetryCooldownRemainingMs(RETRY_ALL_COOLDOWN_MS);
      }
      let at = 0;
      for (const d of BULK_RETRY_POLL_DELAYS_MS) {
        at += d;
        pollTimers.current.push(window.setTimeout(reload, at));
      }
    } catch (err) {
      toast.error(errorMessage(err, "Failed to queue retries"));
    } finally {
      setBulkRetryInFlight(false);
    }
  };

  // ----- columns -----
  const allColumns: (DataColumn<MasterOrder> & { d2c?: boolean; ajioDefault?: boolean; only?: "d2c" | "ajio" })[] = [
    { key: "order_no", header: isD2c ? "Order ID" : "Cust. Order No", width: 170, sortable: true, d2c: true, ajioDefault: true, render: (r) => <span className="tv-mono">{dash(r.order_no)}</span> },
    { key: "cust_whatsapp_number", header: "Customer WhatsApp Number", width: 200, d2c: true, ajioDefault: false, render: (r) => dash(r.cust_whatsapp_number) },
    { key: "cust_name", header: "Customer Name", width: 160, d2c: true, ajioDefault: false, render: (r) => dash(r.cust_name) },
    { key: "order_FWD_AWB_no", header: isD2c ? "AWB Number" : "Forward AWB No", width: 170, d2c: true, ajioDefault: true, render: (r) => <span className="tv-mono">{dash(r.order_FWD_AWB_no)}</span> },
    {
      key: "messageSent",
      header: "Message Sent",
      width: 140,
      align: "center",
      d2c: true,
      only: "d2c",
      render: (r) =>
        r.messageSent === true ? (
          <span className="tv-master-sent is-ok" title="Sent">
            <Icon name="check-circle" />
          </span>
        ) : r.messageSent === false ? (
          <span className="tv-master-sent is-fail" title="Failed — retry available">
            <Icon name="x-circle" />
          </span>
        ) : (
          <span title="Not attempted yet">—</span>
        ),
    },
    { key: "return_order_AWB_no", header: "Return Order AWB No", width: 180, ajioDefault: true, render: (r) => <span className="tv-mono">{dash(r.return_order_AWB_no)}</span> },
    { key: "return_order_no", header: "Return Order No", width: 160, ajioDefault: true, render: (r) => dash(r.return_order_no) },
    { key: "order_seller_SKU", header: "Seller SKU", width: 160, ajioDefault: true, render: (r) => dash(r.order_seller_SKU) },
    { key: "order_quantity", header: "Order Quantity", width: 130, align: "right", sortable: true, render: (r) => dash(r.order_quantity) },
    { key: "order_status", header: "Order Status", width: 170, sortable: true, render: (r) => dash(r.order_status) },
    { key: "POB_ID", header: "POB ID", width: 140, render: (r) => dash(r.POB_ID) },
    {
      key: "orderCondition",
      header: "Parcel Condition",
      width: 150,
      render: (r) =>
        r.orderCondition === 1 || r.orderCondition === 2 ? (
          <span className={`tv-master-chip ${r.orderCondition === 1 ? "is-green" : "is-red"}`}>{r.orderCondition === 1 ? "GOOD" : "BAD"}</span>
        ) : (
          "---"
        ),
    },
    {
      key: "status",
      header: "Claim Status",
      width: 150,
      render: (r) =>
        (r.order_status === "Return Delivered" && r.orderCondition === 2) || r.order_status === "Return Dispute" ? (
          <span className={`tv-master-chip ${CLAIM_TONES[r.status] ?? "is-amber"}`}>{r.status || MASTER_DATA.PENDING}</span>
        ) : (
          "—"
        ),
    },
    { key: "ticketNumber", header: "Ticket", width: 150, render: (r) => dash(r.ticketNumber) },
    { key: "return_order_reason", header: "Return Order Reason", width: 200, ajioDefault: false, render: (r) => dash(r.return_order_reason) },
    { key: "forward_video_link", header: "Forward Video Link", width: 200, ajioDefault: false, render: (r) => (r.forward_video_link ? <a className="tv-link" href={r.forward_video_link} target="_blank" rel="noreferrer">Open video</a> : "---") },
    { key: "return_video_link", header: "Return Video Link", width: 200, ajioDefault: false, render: (r) => (r.return_video_link ? <a className="tv-link" href={r.return_video_link} target="_blank" rel="noreferrer">Open video</a> : "---") },
    { key: "order_date", header: "Order Date", width: 180, sortable: true, ajioDefault: true, render: (r) => dateCell(r.order_date) },
    { key: "return_order_date", header: "Return Order Date", width: 180, sortable: true, ajioDefault: true, render: (r) => dateCell(r.return_order_date) },
    { key: "order_jioCode", header: "Jio Code", width: 140, ajioDefault: false, render: (r) => dash(r.order_jioCode) },
    { key: "order_seller_style_code", header: "Seller Style Code", width: 180, ajioDefault: false, render: (r) => dash(r.order_seller_style_code) },
    { key: "order_FWD_Shipment_ID", header: "FWD Shipment ID", width: 170, ajioDefault: false, render: (r) => dash(r.order_FWD_Shipment_ID) },
    { key: "order_Carrier", header: "Carrier", width: 140, ajioDefault: false, render: (r) => dash(r.order_Carrier) },
    { key: "return_order_Carrier", header: "Return Order Carrier", width: 180, ajioDefault: false, render: (r) => dash(r.return_order_Carrier) },
    { key: "order_Brand", header: "Brand", width: 150, ajioDefault: false, render: (r) => dash(r.order_Brand) },
    { key: "order_Seller_Name", header: "Seller Name", width: 180, ajioDefault: false, render: (r) => dash(r.order_Seller_Name) },
    { key: "return_order_type", header: "Return Order Type", width: 170, ajioDefault: false, render: (r) => dash(r.return_order_type) },
    ...(claimStatus === MASTER_DATA.REJECTED
      ? [
          {
            key: "rejectReason",
            header: "Reject Reason",
            width: 130,
            render: (r: MasterOrder) => (
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => setReasonView({ returnAWB: r.return_order_AWB_no || null, forwardAWB: r.order_FWD_AWB_no || null, reason: r.rejectReason })}
              >
                <Icon name="eye" /> View
              </button>
            ),
          },
        ]
      : []),
    { key: "import_platform", header: "Import Platform", width: 150, ajioDefault: false, render: (r) => dash(r.import_platform) },
    { key: "ajio_account_email", header: "AJIO Account Email", width: 210, render: (r) => dash(r.ajio_account_email) },
    { key: "return_jioCode", header: "Return JioCode", width: 140, ajioDefault: false, render: (r) => dash(r.return_jioCode) },
    { key: "return_quantity", header: "Return Quantity", width: 140, ajioDefault: false, render: (r) => dash(r.return_quantity) },
    { key: "return_shipment_id", header: "Return Shipment ID", width: 170, ajioDefault: false, render: (r) => dash(r.return_shipment_id) },
    { key: "tpl_delivery_status", header: "3PL Delivery Status", width: 170, ajioDefault: false, render: (r) => dash(r.tpl_delivery_status) },
    { key: "return_fwd_carrier_name", header: "Return FWD Carrier", width: 170, ajioDefault: false, render: (r) => dash(r.return_fwd_carrier_name) },
    { key: "return_brand", header: "Return Brand", width: 150, ajioDefault: false, render: (r) => dash(r.return_brand) },
    { key: "return_delivered_date", header: "Return Delivered Date", width: 190, ajioDefault: false, render: (r) => dateCell(r.return_delivered_date) },
    { key: "fwd_seller_order_no", header: "FWD Seller Order No", width: 180, ajioDefault: false, render: (r) => dash(r.fwd_seller_order_no) },
    { key: "is_m_not_delivered", header: "Marketplace Not Delivered", width: 200, ajioDefault: false, render: (r) => (r.is_m_not_delivered === true ? "Yes" : r.is_m_not_delivered === false ? "No" : "---") },
    { key: "good_quantity", header: "Good Qty", width: 110, align: "right", ajioDefault: false, render: (r) => String(r.good_quantity ?? 0) },
    { key: "bad_quantity", header: "Bad Qty", width: 110, align: "right", ajioDefault: false, render: (r) => String(r.bad_quantity ?? 0) },
    {
      key: "history",
      header: "History",
      width: 90,
      render: (r) => (
        <button
          type="button"
          className="icon-button"
          aria-label={`History of ${r.order_no}`}
          onClick={() => setHistoryFor({ id: r.history, returnAWB: r.return_order_AWB_no, forwardAWB: r.order_FWD_AWB_no })}
        >
          <Icon name="history" />
        </button>
      ),
    },
    ...(canEdit && claimStatus === MASTER_DATA.IN_REVIEW
      ? [
          {
            key: "actions",
            header: "Actions",
            width: 190,
            render: (r: MasterOrder): ReactNode =>
              r.status === MASTER_DATA.IN_REVIEW && r.order_status === "Return Dispute" ? (
                <div className="tv-row">
                  <button type="button" className="primary-button compact-button" disabled={statusBusy === r._id} onClick={() => void handleUpdateStatus(r._id, MASTER_DATA.APPROVED)}>
                    Approve
                  </button>
                  <button type="button" className="danger-button compact-button" disabled={statusBusy === r._id} onClick={() => setRejectFor(r._id)}>
                    Reject
                  </button>
                </div>
              ) : (
                "---"
              ),
          },
        ]
      : []),
    ...(canEdit && !isD2c
      ? [
          {
            key: "menu",
            header: <span className="sr-only">Row actions</span>,
            label: "Row actions",
            width: 60,
            align: "right" as const,
            render: (r: MasterOrder) => (
              <RowActionsMenu
                label={r.order_no}
                actions={[
                  { label: "Add / Edit Ticket", icon: "tag", onClick: () => setTicketFor({ _id: r._id, ticket: r.ticketNumber }) },
                  { label: "View history", icon: "history", onClick: () => setHistoryFor({ id: r.history, returnAWB: r.return_order_AWB_no, forwardAWB: r.order_FWD_AWB_no }) },
                  {
                    label: "Approve claim",
                    icon: "check-circle",
                    separatorBefore: true,
                    hidden: !(r.status === MASTER_DATA.IN_REVIEW && r.order_status === "Return Dispute"),
                    onClick: () => void handleUpdateStatus(r._id, MASTER_DATA.APPROVED),
                  },
                  {
                    label: "Reject claim",
                    icon: "x-circle",
                    danger: true,
                    hidden: !(r.status === MASTER_DATA.IN_REVIEW && r.order_status === "Return Dispute"),
                    onClick: () => setRejectFor(r._id),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  // Platform default visibility (TrackVid columnVisibilityModel) + the user's overrides.
  const defaultVisible = (c: (typeof allColumns)[number]): boolean => {
    if (isD2c) return Boolean(c.d2c);
    if (c.only === "d2c") return false;
    return c.ajioDefault !== false;
  };
  const isVisible = (c: (typeof allColumns)[number]) => columnOverrides[c.key] ?? defaultVisible(c);
  const columns: DataColumn<MasterOrder>[] = allColumns.filter((c) => !(isD2c && c.only === "ajio")).map((c) => ({ ...c, hidden: !isVisible(c) }));
  const choosable = allColumns.filter((c) => (isD2c ? c.d2c || !c.only : c.only !== "d2c") && c.key !== "menu");

  return (
    <>
      <div className="c-toolbar tv-master-toolbar">
        <SearchInput value={search} onChange={onSearch} placeholder="Search..." />
        <div className="tv-master-toolbar-actions">
          {!isD2c ? (
            <ToolbarPopover label="Filters" icon="list-bullets" badge={activeFilters.length} wide>
              {() => (
                <div className="tv-master-filters">
                  <div className="tv-master-filter-grid">
                    {(Object.keys(FILTER_LABELS) as MasterFilterKey[]).map((key) => (
                      <Combobox
                        key={key}
                        label={FILTER_LABELS[key]}
                        placeholder="Select value"
                        value={filters[key]}
                        options={(filterValues?.[key] ?? []).map((v) => ({ value: v === "" ? "Null" : v, label: filterOptionLabel(key, v) }))}
                        onChange={(v) => setFilter(key, v)}
                      />
                    ))}
                  </div>
                  <div className="tv-row-between">
                    <span className="tv-muted tv-small">&ldquo;---&rdquo; matches empty values.</span>
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      disabled={!activeFilters.length}
                      onClick={() => {
                        setFilters(EMPTY_FILTERS);
                        onPage(1);
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              )}
            </ToolbarPopover>
          ) : null}
          <ToolbarPopover label="Columns" icon="squares-four">
            {() => (
              <div className="tv-master-columns">
                {choosable.map((c) => (
                  <label key={c.key} className="tv-check">
                    <input type="checkbox" checked={isVisible(c)} onChange={(e) => setColumnOverrides((o) => ({ ...o, [c.key]: e.currentTarget.checked }))} />
                    {c.label ?? (typeof c.header === "string" ? c.header : c.key)}
                  </label>
                ))}
                <button type="button" className="secondary-button compact-button" onClick={() => setColumnOverrides({})}>
                  Reset columns
                </button>
              </div>
            )}
          </ToolbarPopover>
          {isD2c ? (
            <>
              <button
                type="button"
                className="primary-button"
                disabled={bulkRetryInFlight || retryCooldownRemainingMs > 0}
                title={retryCooldownRemainingMs > 0 ? `Retry locked for ${formatCooldownRemaining(retryCooldownRemainingMs)} (30-min cooldown)` : undefined}
                onClick={() => setBulkRetryConfirmOpen(true)}
              >
                {bulkRetryInFlight ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="rotate-cw" />}
                {bulkRetryInFlight ? "Retrying..." : retryCooldownRemainingMs > 0 ? `Retry in ${formatCooldownRemaining(retryCooldownRemainingMs)}` : "Retry All Failed"}
              </button>
              <ToolbarPopover label={exportLoading ? "Exporting..." : "Export"} icon="download" busy={exportLoading} primary>
                {(close) => (
                  <div className="tv-menu-list" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        void handleExportD2C("page");
                      }}
                    >
                      Page Orders
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        void handleExportD2C("all");
                      }}
                    >
                      {totalRow > D2C_EXPORT_MAX_ROWS ? `First ${D2C_EXPORT_MAX_ROWS.toLocaleString()} of ${totalRow.toLocaleString()}` : `All ${totalRow} Orders`}
                    </button>
                  </div>
                )}
              </ToolbarPopover>
            </>
          ) : (
            <>
              <DateRangePicker value={range} onChange={(r) => r && onRange(r)} />
              <ToolbarPopover label="Export" icon="download" busy={exportLoading} primary>
                {(close) => (
                  <div className="tv-menu-list" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!selected.size}
                      onClick={() => {
                        close();
                        void downloadExcel("selected");
                      }}
                    >
                      Selected{selected.size ? ` (${selected.size})` : ""}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        void downloadExcel("page");
                      }}
                    >
                      Page Orders
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        void downloadExcel("all");
                      }}
                    >
                      All {totalRow} Orders
                    </button>
                  </div>
                )}
              </ToolbarPopover>
            </>
          )}
        </div>
      </div>

      {activeFilters.length ? (
        <div className="tv-chips tv-master-active-filters">
          {activeFilters.map((k) => (
            <span key={k} className="tv-chip">
              {FILTER_LABELS[k]}: {filters[k] === "Null" ? "---" : filterOptionLabel(k, filters[k])}
              <button type="button" aria-label={`Remove ${FILTER_LABELS[k]} filter`} onClick={() => setFilter(k, "")}>
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {!isD2c && selected.size ? (
        <div className="c-selection">
          <strong>{selected.size} selected</strong>
          <button type="button" className="secondary-button" disabled={exportLoading} onClick={() => void downloadExcel("selected")}>
            <Icon name="download" /> Export selected
          </button>
          <button type="button" className="secondary-button" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}

      <DataTable
        label={`${platform} master data`}
        columns={columns}
        rows={rows}
        getRowId={(r) => r._id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyTitle="No master data found"
        emptyMessage={isD2c ? "Upload Customer WhatsApp Number data from Imports to see D2C orders." : "Try another date range or clear your filters."}
        selected={isD2c ? undefined : selected}
        onSelectedChange={isD2c ? undefined : setSelected}
        sort={sort}
        onSortChange={(s) => {
          setSort(s);
          onPage(1);
        }}
        pagination="server"
        page={page}
        pageSize={limit}
        pageSizes={[25, 50, 100]}
        total={totalRow}
        onPageChange={onPage}
        onPageSizeChange={(s) => {
          onLimit(s);
          onPage(1);
        }}
        storageKey={`master-data-${platform.toLowerCase()}`}
      />

      {ticketFor ? <MasterTicketDialog masterData={ticketFor} onClose={() => setTicketFor(null)} onSaved={reload} /> : null}
      {rejectFor ? <MasterRejectDialog id={rejectFor} onClose={() => setRejectFor(null)} onSaved={reload} /> : null}
      {reasonView ? <MasterViewReasonDialog data={reasonView} onClose={() => setReasonView(null)} /> : null}
      {historyFor ? (
        <MasterHistoryDialog historyId={historyFor.id} returnAWB={historyFor.returnAWB} forwardAWB={historyFor.forwardAWB} onClose={() => setHistoryFor(null)} />
      ) : null}
      {bulkRetryConfirmOpen ? (
        <ConfirmDialog
          title="Retry all failed D2C messages?"
          message="This will re-queue a WhatsApp send for every D2C row currently in the failed state. The actual messages go out to real customers — make sure you intend to do this."
          confirmLabel="Retry All"
          busy={bulkRetryInFlight}
          onConfirm={() => void handleBulkRetryD2C()}
          onClose={() => setBulkRetryConfirmOpen(false)}
        />
      ) : null}
    </>
  );
}
