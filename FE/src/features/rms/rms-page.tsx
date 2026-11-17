"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { addDays, startOfDay } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { Combobox } from "@/components/ui/combobox";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangePicker, defaultDatePresets, type DateRange } from "@/components/ui/date-range-picker";
import { SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { platformLogoUrl } from "@/components/ui/platform-logo";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { MASTER_DATA, ORDER_STATUS } from "@/config/constant";
import { MasterHistoryDialog, MasterRejectDialog, MasterTicketDialog, MasterViewReasonDialog } from "@/features/master-data/components/master-dialogs";
import { ToolbarPopover } from "@/features/master-data/components/toolbar-popover";
import { RmsBulkResultDialog } from "@/features/rms/bulk-result-dialog";
import { useRmsClaimSimulation } from "@/features/rms/use-rms-claim";
import { downloadText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { MasterData } from "@/services/masterData-service";
import { RmsService } from "@/services/rms-service";
import { useDispatch, useSelector } from "@/store";
import { closeScriptProgress, setActiveScriptJob, startScriptProgress, updateScriptProgress } from "@/store/script-progress-slice";
import type { MasterOrder, MasterOrderReportPayload } from "@/types/master-data";
import type { RmsBulkResult, RmsFilterOptions } from "@/types/rms";

type Tone = "blue" | "red" | "green" | "amber" | "lilac" | "muted";

const ORDER_TABS: readonly { value: string; label: string; tone: Tone }[] = [
  { value: ORDER_STATUS.RETURN_CREATED, label: "Return Created", tone: "blue" },
  { value: ORDER_STATUS.RETURN_CANCELLED, label: "Return Cancelled", tone: "red" },
  { value: ORDER_STATUS.PHYSICALLY_RETURN_RECEIVED, label: "Physically Return Received", tone: "green" },
  { value: ORDER_STATUS.RETURN_NOT_DELIVERED, label: "Return Not Delivered", tone: "amber" },
  { value: ORDER_STATUS.MARKETPLACE_DELIVERED, label: "Marketplace Delivered", tone: "green" },
  { value: ORDER_STATUS.RETURN_DISPUTE, label: "Return Dispute", tone: "lilac" },
];

const ALL_SUB = "all";
const SUB_TABS: readonly { value: string; label: string; tone: Tone }[] = [
  { value: ALL_SUB, label: "All", tone: "muted" },
  { value: MASTER_DATA.PENDING, label: "Pending", tone: "amber" },
  { value: MASTER_DATA.IN_REVIEW, label: "In Review", tone: "blue" },
  { value: MASTER_DATA.UN_ATTENDED, label: "Un Attended", tone: "lilac" },
  { value: MASTER_DATA.IN_PROGRESS, label: "In Progress", tone: "blue" },
  { value: MASTER_DATA.CUSTOMER_REPLIED, label: "Customer Replied", tone: "blue" },
  { value: MASTER_DATA.APPROVED, label: "Approved", tone: "green" },
  { value: MASTER_DATA.REJECTED, label: "Rejected", tone: "red" },
  { value: MASTER_DATA.RESOLVED, label: "Resolved", tone: "green" },
];

/** Claim status chip tones (kept in step with the sub-tab dots, like TrackVid's STATUS_TONES). */
const CLAIM_TONE: Record<string, "green" | "amber" | "red" | "blue"> = {
  [MASTER_DATA.PENDING]: "amber",
  [MASTER_DATA.IN_REVIEW]: "blue",
  [MASTER_DATA.UN_ATTENDED]: "amber",
  [MASTER_DATA.IN_PROGRESS]: "blue",
  [MASTER_DATA.CUSTOMER_REPLIED]: "blue",
  [MASTER_DATA.APPROVED]: "green",
  [MASTER_DATA.REJECTED]: "red",
  [MASTER_DATA.RESOLVED]: "green",
};

const EMPTY_FILTERS: RmsFilterOptions = {
  parcelCondition: "",
  return_order_Carrier: "",
  carrier: "",
  importPlatForm: "",
  returnOrderType: "",
  brand: "",
  sellerName: "",
  claimStatus: "",
};

/** Filter → key in the list response `filters`. */
const FILTER_FIELDS: readonly { key: keyof RmsFilterOptions; source: "carrier" | "return_order_Carrier" | "brand" | "sellerName" | "returnOrderType" | "claimStatus" | "parcelCondition" | "importPlatForm"; label: string }[] = [
  { key: "carrier", source: "carrier", label: "Carrier" },
  { key: "return_order_Carrier", source: "return_order_Carrier", label: "Return Order Carrier" },
  { key: "brand", source: "brand", label: "Brand" },
  { key: "sellerName", source: "sellerName", label: "Seller Name" },
  { key: "returnOrderType", source: "returnOrderType", label: "Return Order Type" },
  { key: "claimStatus", source: "claimStatus", label: "Claim Status" },
  { key: "parcelCondition", source: "parcelCondition", label: "Parcel Condition" },
  { key: "importPlatForm", source: "importPlatForm", label: "Import Platform" },
];

/** TrackVid `columnVisibilityModel` (false = hidden until turned on in Columns). */
const HIDDEN_BY_DEFAULT = new Set([
  "order_jioCode",
  "order_seller_style_code",
  "order_FWD_Shipment_ID",
  "order_Carrier",
  "return_order_Carrier",
  "order_Brand",
  "order_Seller_Name",
  "return_order_type",
  "import_platform",
  "return_video_link",
  "forward_video_link",
  "return_order_reason",
  "order_quantity",
  "return_jioCode",
  "return_quantity",
  "return_shipment_id",
  "tpl_delivery_status",
  "return_fwd_carrier_name",
  "return_brand",
  "return_delivered_date",
  "fwd_seller_order_no",
  "orderCondition_display",
  "is_m_not_delivered",
  "good_quantity",
  "bad_quantity",
]);

const MAX_CLAIM_ROWS = 10;
const dash = (v: string | number | null | undefined): string => (v === null || v === undefined || v === "" ? "---" : String(v));
const dateCell = (v: string | null | undefined): string => (v ? formatDateTime(v) : "---");
const conditionLabel = (v: string): string => (Number(v) === 1 ? "GOOD" : Number(v) === 2 ? "BAD" : "---");
const isOrderTab = (v: string | null): v is string => Boolean(v) && ORDER_TABS.some((t) => t.value === v);
const isSubTab = (v: string | null): v is string => Boolean(v) && SUB_TABS.some((t) => t.value === v);

function TabLabel({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className="tv-rms-tab">
      <span className={`tv-rms-dot tone-${tone}`} aria-hidden="true" />
      {label}
    </span>
  );
}

/** TrackVid `pages/RMS.tsx` — return management: order-status tabs, Return Dispute claim tabs, claim script, bulk update. */
export function RmsPage() {
  const dispatch = useDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useSelector((s) => s.profile.userProfile);
  const scriptProgress = useSelector((s) => s.scriptProgress);
  const hasMasterImportPermission = canAccess(user, ["admin"], ["master_data::edit"]);
  const isGlobalScriptRunning = scriptProgress.progress.running > 0 && !scriptProgress.isCompleted;

  // ----- tabs (TrackVid keeps them in router state; here in ?orderStatus=&status=) -----
  const urlOrder = searchParams.get("orderStatus");
  const urlStatus = searchParams.get("status");
  const [seenUrl, setSeenUrl] = useState(`${urlOrder}|${urlStatus}`);
  const [orderStatus, setOrderStatus] = useState<string>(isOrderTab(urlOrder) ? urlOrder : ORDER_STATUS.RETURN_CREATED);
  const [status, setStatus] = useState<string>(isSubTab(urlStatus) && urlStatus !== ALL_SUB ? urlStatus : "");
  if (`${urlOrder}|${urlStatus}` !== seenUrl) {
    setSeenUrl(`${urlOrder}|${urlStatus}`);
    if (isOrderTab(urlOrder)) setOrderStatus(urlOrder);
    setStatus(isSubTab(urlStatus) && urlStatus !== ALL_SUB ? urlStatus : "");
  }

  // ----- filters -----
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [range, setRange] = useState<DateRange>(() => ({ startDate: startOfDay(addDays(new Date(), -6)), endDate: new Date() }));
  const [filterOptions, setFilterOptions] = useState<RmsFilterOptions>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columnOverrides, setColumnOverrides] = useState<Record<string, boolean>>({});

  // ----- dialogs / busy -----
  const [ticketFor, setTicketFor] = useState<{ _id: string; ticket: string } | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reasonView, setReasonView] = useState<{ returnAWB: string | null; forwardAWB: string | null; reason: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ id: string; returnAWB: string; forwardAWB: string } | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<RmsBulkResult | null>(null);
  const [starting, setStarting] = useState(false);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const platform = "AJIO";

  // Search debounce 500 ms (TrackVid useDebounce).
  useEffect(() => {
    if (searchInput === debouncedSearch) return;
    const id = window.setTimeout(() => setDebouncedSearch(searchInput), 500);
    return () => window.clearTimeout(id);
  }, [searchInput, debouncedSearch]);
  const onSearch = (value: string) => {
    setSearchInput(value);
    setPage(1);
  };

  // ----- list payload (same mapping as the RMS.tsx fetch effect) -----
  const fromFilter = (v: string): string => (v === "all" ? "" : v);
  const payload: MasterOrderReportPayload = {
    startDate: range.startDate,
    endDate: range.endDate,
    limit,
    page,
    searchInput: debouncedSearch,
    order_status: orderStatus,
    status: orderStatus === ORDER_STATUS.RETURN_DISPUTE ? status : "",
    orderCondition: filterOptions.parcelCondition === "" ? "" : filterOptions.parcelCondition === "Null" ? "Null" : Number(filterOptions.parcelCondition),
    import_platform: fromFilter(filterOptions.importPlatForm),
    order_Carrier: fromFilter(filterOptions.carrier),
    return_order_Carrier: fromFilter(filterOptions.return_order_Carrier),
    return_order_type: fromFilter(filterOptions.returnOrderType),
    order_Brand: fromFilter(filterOptions.brand),
    order_Seller_Name: fromFilter(filterOptions.sellerName),
  };
  if (filterOptions.claimStatus) payload.status = filterOptions.claimStatus;
  const payloadKey = JSON.stringify(payload);
  const list = useAsync(() => MasterData.getMasterOrderReport(JSON.parse(payloadKey) as MasterOrderReportPayload), [payloadKey]);
  const rows = list.data?.order ?? [];
  const totalRow = list.data?.metadata.total ?? 0;
  const filterValues = list.data?.filters ?? null;
  const reloadRef = useRef(list.reload);
  useEffect(() => {
    reloadRef.current = list.reload;
  });

  const claim = useRmsClaimSimulation({
    onRefresh: () => reloadRef.current(),
    onCompleted: ({ total, success, failed }) => {
      if (failed === 0) toast.success(`All ${total} claims processed successfully!`);
      else toast.error(`${success} claims succeeded, ${failed} claims failed.`);
    },
  });

  const syncUrl = (nextOrder: string, nextStatus: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("orderStatus", nextOrder);
    if (nextStatus) params.set("status", nextStatus);
    else params.delete("status");
    const qs = params.toString();
    setSeenUrl(`${nextOrder}|${nextStatus || null}`);
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  const handleTabChange = (value: string) => {
    setStatus("");
    setOrderStatus(value);
    setSelected(new Set());
    setPage(1);
    syncUrl(value, "");
  };

  const handleSubTabChange = (value: string) => {
    const next = value === ALL_SUB ? "" : value;
    setStatus(next);
    setSelected(new Set());
    setPage(1);
    syncUrl(orderStatus, next);
  };

  const setFilter = (key: keyof RmsFilterOptions, value: string) => {
    setFilterOptions((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const activeFilters = FILTER_FIELDS.filter((f) => filterOptions[f.key] !== "");

  // ----- actions -----
  const handleUpdateStatus = async (id: string, next: string) => {
    if (next === MASTER_DATA.REJECTED) {
      setRejectFor(id);
      return;
    }
    setStatusBusy(id);
    try {
      const res = await MasterData.updateMasterStatus({ _id: id, status: next });
      toast.success(res.displayMessage);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStatusBusy(null);
    }
  };

  const handleRunClaim = async () => {
    if (selected.size === 0) {
      toast.error("Please select at least one record to process");
      return;
    }
    if (selected.size > MAX_CLAIM_ROWS) {
      toast.error("Maximum 10 records can be processed at a time. Please select up to 10 records.");
      return;
    }
    const ids = [...selected];
    setStarting(true);
    dispatch(startScriptProgress({ total: 0, running: 0, jobId: null }));
    try {
      const res = await RmsService.triggerReturnNotDeliveredClaim({
        ids,
        order_status: orderStatus === ORDER_STATUS.MARKETPLACE_DELIVERED ? ORDER_STATUS.MARKETPLACE_DELIVERED : ORDER_STATUS.RETURN_NOT_DELIVERED,
        startDate: range.startDate.toISOString(),
        endDate: range.endDate.toISOString(),
        searchInput: searchInput || undefined,
        import_platform: platform,
      });
      dispatch(setActiveScriptJob(res.jobId));
      dispatch(updateScriptProgress({ total: res.totalRecords, running: res.totalRecords, jobId: res.jobId }));
      toast.success(`Script queued successfully for ${res.totalRecords} record(s)`);
      const byId = new Map(rows.map((r) => [r._id, r]));
      claim.start(
        res.jobId,
        ids.map((id) => ({ id, awb: byId.get(id)?.return_order_AWB_no || byId.get(id)?.order_FWD_AWB_no || id })),
      );
      setSelected(new Set());
    } catch (err) {
      const message = errorMessage(err, "Failed to trigger script");
      if (message.includes("No login information")) toast.error("Please configure AJIO login credentials in company settings");
      else if (message.includes("No MasterImport records found") || message.includes("No Return Not Delivered")) toast.error("No records available for processing");
      else toast.error(message);
      dispatch(closeScriptProgress());
    } finally {
      setStarting(false);
    }
  };

  const handleBulkUploadClick = () => {
    if (!platform) {
      toast.error("Select a platform (marketplace) first, then upload.");
      return;
    }
    bulkFileInputRef.current?.click();
  };

  const handleBulkFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setBulkUploading(true);
    try {
      const res = await RmsService.bulkStatusUpdateReturnDispute(file, platform);
      setBulkResult(res);
      toast.success(`${res.updatedCount} record(s) updated`);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err, "Bulk update failed"));
    } finally {
      setBulkUploading(false);
    }
  };

  const downloadExcel = async (exportType: "selected" | "page" | "all") => {
    setExportLoading(true);
    try {
      const res = await MasterData.downloadExternalOrder({
        selectedOrders: exportType === "selected" ? [...selected] : [],
        page: exportType === "page" ? page : 1,
        limit: exportType === "all" ? 0 : limit,
        searchInput,
        startDate: range.startDate,
        endDate: range.endDate,
        import_platform: platform,
        order_status: orderStatus,
        status,
      });
      downloadText(res.csv, res.fileName, "text/csv;charset=utf-8");
      toast.success("Excel file download started!");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to download the Excel file"));
    } finally {
      setExportLoading(false);
    }
  };

  // ----- columns -----
  const claimCell = (r: MasterOrder): ReactNode =>
    (r.order_status === ORDER_STATUS.RETURN_DELIVERED && r.orderCondition === 2) || r.order_status === ORDER_STATUS.RETURN_DISPUTE ? (
      r.status ? <span className={`c-status ${CLAIM_TONE[r.status] ?? "red"} tv-rms-chip`}>{r.status}</span> : "---"
    ) : (
      "---"
    );

  const allColumns: DataColumn<MasterOrder>[] = [
    ...(hasMasterImportPermission && status === MASTER_DATA.IN_REVIEW
      ? [
          {
            key: "actions",
            header: "Actions",
            width: 190,
            render: (r: MasterOrder): ReactNode =>
              r.status === MASTER_DATA.IN_REVIEW && r.order_status === ORDER_STATUS.RETURN_DISPUTE ? (
                <span className="tv-row">
                  <button type="button" className="primary-button compact-button" disabled={statusBusy === r._id} onClick={() => void handleUpdateStatus(r._id, MASTER_DATA.APPROVED)}>
                    Approve
                  </button>
                  <button type="button" className="danger-button compact-button" disabled={statusBusy === r._id} onClick={() => setRejectFor(r._id)}>
                    Reject
                  </button>
                </span>
              ) : (
                "---"
              ),
          },
        ]
      : []),
    {
      key: "ticketNumber",
      header: "Ticket",
      width: 170,
      sortable: true,
      render: (r) => (
        <span className="tv-rms-ticket">
          {r.order_status === ORDER_STATUS.RETURN_NOT_DELIVERED && hasMasterImportPermission ? (
            <button type="button" className="icon-button compact-button" aria-label={`Edit ticket of ${r.order_no}`} title="Edit Ticket" onClick={() => setTicketFor({ _id: r._id, ticket: r.ticketNumber })}>
              <Icon name="pencil" />
            </button>
          ) : null}
          <span className="tv-mono">{dash(r.ticketNumber)}</span>
        </span>
      ),
    },
    { key: "order_no", header: "Cust. Order No", width: 170, sortable: true, render: (r) => <span className="tv-mono">{dash(r.order_no)}</span> },
    { key: "return_order_no", header: "Return Order No", width: 170, sortable: true, render: (r) => dash(r.return_order_no) },
    { key: "order_status", header: "Order Status", width: 170, render: (r) => dash(r.order_status) },
    { key: "POB_ID", header: "POB ID", width: 140, render: (r) => dash(r.POB_ID) },
    { key: "order_FWD_AWB_no", header: "Forward AWB No", width: 170, sortable: true, render: (r) => <span className="tv-mono">{dash(r.order_FWD_AWB_no)}</span> },
    { key: "return_order_AWB_no", header: "Return Order AWB No", width: 190, sortable: true, render: (r) => <span className="tv-mono">{dash(r.return_order_AWB_no)}</span> },
    { key: "order_seller_SKU", header: "Seller SKU", width: 170, render: (r) => dash(r.order_seller_SKU) },
    { key: "return_order_reason", header: "Return Order Reason", width: 200, render: (r) => dash(r.return_order_reason) },
    { key: "forward_video_link", header: "Forward Video Link", width: 200, render: (r) => (r.forward_video_link ? <a className="tv-link" href={r.forward_video_link} target="_blank" rel="noreferrer">Open video</a> : "---") },
    { key: "return_video_link", header: "Return Video Link", width: 200, render: (r) => (r.return_video_link ? <a className="tv-link" href={r.return_video_link} target="_blank" rel="noreferrer">Open video</a> : "---") },
    { key: "order_date", header: "Order Date", width: 190, sortable: true, sortValue: (r) => r.order_date, render: (r) => dateCell(r.order_date) },
    { key: "return_order_date", header: "Return Order Date", width: 190, sortable: true, sortValue: (r) => r.return_order_date, render: (r) => dateCell(r.return_order_date) },
    { key: "order_jioCode", header: "Jio Code", width: 140, render: (r) => dash(r.order_jioCode) },
    { key: "order_seller_style_code", header: "Seller Style Code", width: 180, render: (r) => dash(r.order_seller_style_code) },
    { key: "order_FWD_Shipment_ID", header: "FWD Shipment ID", width: 170, render: (r) => dash(r.order_FWD_Shipment_ID) },
    { key: "order_Carrier", header: "Carrier", width: 140, render: (r) => dash(r.order_Carrier) },
    { key: "return_order_Carrier", header: "Return Order Carrier", width: 180, render: (r) => dash(r.return_order_Carrier) },
    { key: "order_Brand", header: "Brand", width: 150, render: (r) => dash(r.order_Brand) },
    { key: "order_Seller_Name", header: "Seller Name", width: 180, render: (r) => dash(r.order_Seller_Name) },
    { key: "return_order_type", header: "Return Order Type", width: 170, render: (r) => dash(r.return_order_type) },
    { key: "status", header: "Claim Status", width: 150, render: claimCell },
    ...(orderStatus === ORDER_STATUS.PHYSICALLY_RETURN_RECEIVED
      ? [
          {
            key: "orderCondition",
            header: "Parcel Condition",
            width: 155,
            render: (r: MasterOrder): ReactNode =>
              r.orderCondition === 1 || r.orderCondition === 2 ? <span className={`c-status ${r.orderCondition === 1 ? "green" : "red"} tv-rms-chip`}>{r.orderCondition === 1 ? "GOOD" : "BAD"}</span> : "---",
          },
        ]
      : []),
    ...(status === MASTER_DATA.REJECTED
      ? [
          {
            key: "rejectReason",
            header: "Reject Reason",
            width: 130,
            render: (r: MasterOrder): ReactNode => (
              <button
                type="button"
                className="secondary-button compact-button"
                disabled={!hasMasterImportPermission}
                onClick={() => setReasonView({ returnAWB: r.return_order_AWB_no || null, forwardAWB: r.order_FWD_AWB_no || null, reason: r.rejectReason })}
              >
                <Icon name="eye" /> View
              </button>
            ),
          },
        ]
      : []),
    { key: "import_platform", header: "Import Platform", width: 160, render: (r) => dash(r.import_platform) },
    { key: "ajio_account_email", header: "AJIO Account Email", width: 210, render: (r) => dash(r.ajio_account_email) },
    { key: "order_quantity", header: "Order Quantity", width: 140, align: "right", render: (r) => dash(r.order_quantity) },
    { key: "return_jioCode", header: "Return JioCode", width: 140, render: (r) => dash(r.return_jioCode) },
    { key: "return_quantity", header: "Return Quantity", width: 140, align: "right", render: (r) => dash(r.return_quantity) },
    { key: "return_shipment_id", header: "Return Shipment ID", width: 180, render: (r) => dash(r.return_shipment_id) },
    { key: "tpl_delivery_status", header: "3PL Delivery Status", width: 180, render: (r) => dash(r.tpl_delivery_status) },
    { key: "return_fwd_carrier_name", header: "Return FWD Carrier", width: 180, render: (r) => dash(r.return_fwd_carrier_name) },
    { key: "return_brand", header: "Return Brand", width: 150, render: (r) => dash(r.return_brand) },
    { key: "return_delivered_date", header: "Return Delivered Date", width: 200, render: (r) => dateCell(r.return_delivered_date) },
    { key: "fwd_seller_order_no", header: "FWD Seller Order No", width: 190, render: (r) => dash(r.fwd_seller_order_no) },
    { key: "orderCondition_display", header: "Order Condition", width: 150, render: (r) => (r.orderCondition === 1 ? "Good" : r.orderCondition === 2 ? "Bad" : "---") },
    { key: "is_m_not_delivered", header: "Marketplace Not Delivered", width: 200, render: (r) => (r.is_m_not_delivered === true ? "Yes" : r.is_m_not_delivered === false ? "No" : "---") },
    { key: "good_quantity", header: "Good Qty", width: 110, align: "right", render: (r) => String(r.good_quantity ?? 0) },
    { key: "bad_quantity", header: "Bad Qty", width: 110, align: "right", render: (r) => String(r.bad_quantity ?? 0) },
    {
      key: "history",
      header: "History",
      width: 90,
      render: (r) => (
        <button type="button" className="icon-button" aria-label={`History of ${r.order_no}`} title="History" onClick={() => setHistoryFor({ id: r.history, returnAWB: r.return_order_AWB_no, forwardAWB: r.order_FWD_AWB_no })}>
          <Icon name="history" />
        </button>
      ),
    },
  ];
  const isVisible = (key: string) => columnOverrides[key] ?? !HIDDEN_BY_DEFAULT.has(key);
  const columns = allColumns.map((c) => ({ ...c, hidden: !isVisible(c.key) }));

  const canRunClaim = orderStatus === ORDER_STATUS.RETURN_NOT_DELIVERED || orderStatus === ORDER_STATUS.MARKETPLACE_DELIVERED;
  const selectionEnabled = canRunClaim && !isGlobalScriptRunning;
  const count = selected.size;
  const runLabel = isGlobalScriptRunning
    ? `Running... (${scriptProgress.progress.running})`
    : count > MAX_CLAIM_ROWS
      ? `Too many selected (${count}/${MAX_CLAIM_ROWS})`
      : count > 0
        ? `Run Claim (${count})`
        : "Run Claim";

  const orderItems: TabItem<string>[] = ORDER_TABS.map((t) => ({ key: t.value, label: <TabLabel label={t.label} tone={t.tone} /> }));
  const subItems: TabItem<string>[] = SUB_TABS.map((t) => ({ key: t.value, label: <TabLabel label={t.label} tone={t.tone} /> }));

  return (
    <div className="tv-page tv-rms">
      <PageHeading title="RMS" subtitle="Return management: follow every AJIO return from creation to delivery, raise not-delivered claims and settle disputes." />

      <section className="glass-card tv-rms-tabs-card" aria-label="Return status">
        <Tabs items={orderItems} value={orderStatus} onChange={handleTabChange} label="RMS order status tabs" />
        {orderStatus === ORDER_STATUS.RETURN_DISPUTE ? <Tabs items={subItems} value={status || ALL_SUB} onChange={handleSubTabChange} label="Return Dispute sub status tabs" /> : null}
      </section>

      <section className="glass-card tv-table-card">
        <div className="c-toolbar tv-rms-toolbar">
          <SearchInput value={searchInput} onChange={onSearch} placeholder="Search orders..." label="Search orders" />
          <div className="tv-rms-toolbar-actions">
            <label className="c-filter tv-rms-platform" title="Only AJIO returns are managed in RMS">
              <span className="sr-only">Platform</span>
              {platformLogoUrl(platform) ? <img src={platformLogoUrl(platform)} alt="" /> : null}
              <select value={platform} disabled aria-label="Platform">
                <option value="AJIO">AJIO</option>
              </select>
            </label>
            <DateRangePicker
              value={range}
              onChange={(r) => {
                if (!r) return;
                setRange(r);
                setPage(1);
                setSelected(new Set());
              }}
              presets={defaultDatePresets}
              label="Order date"
            />
            <ToolbarPopover label="Filters" icon="funnel" badge={activeFilters.length} wide>
              {() => (
                <div className="tv-rms-filters">
                  <div className="tv-rms-filter-grid">
                    {FILTER_FIELDS.filter((f) => f.key !== "parcelCondition" || orderStatus === ORDER_STATUS.PHYSICALLY_RETURN_RECEIVED).map((f) => (
                      <Combobox
                        key={f.key}
                        label={f.label}
                        placeholder="Select value"
                        value={filterOptions[f.key]}
                        options={(filterValues?.[f.source] ?? []).map((v) => ({ value: v === "" ? "Null" : v, label: f.key === "parcelCondition" ? conditionLabel(v) : v === "" ? "---" : v }))}
                        onChange={(v) => setFilter(f.key, v)}
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
                        setFilterOptions(EMPTY_FILTERS);
                        setPage(1);
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              )}
            </ToolbarPopover>
            <ToolbarPopover label="Columns" icon="squares-four">
              {() => (
                <div className="tv-rms-columns">
                  {allColumns.map((c) => (
                    <label key={c.key} className="tv-check">
                      <input type="checkbox" checked={isVisible(c.key)} onChange={(e) => setColumnOverrides((o) => ({ ...o, [c.key]: e.currentTarget.checked }))} />
                      {typeof c.header === "string" ? c.header : c.key}
                    </label>
                  ))}
                  <button type="button" className="secondary-button compact-button" onClick={() => setColumnOverrides({})}>
                    Reset columns
                  </button>
                </div>
              )}
            </ToolbarPopover>
            {exportLoading ? (
              <span className="tv-rms-exporting" role="status" aria-label="Exporting">
                <span className="tv-spinner small" aria-hidden="true" />
              </span>
            ) : (
              <>
                {canRunClaim ? (
                  <button type="button" className="primary-button" disabled={isGlobalScriptRunning || starting || count === 0 || count > MAX_CLAIM_ROWS} onClick={() => void handleRunClaim()}>
                    {starting || isGlobalScriptRunning ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="lightning" />}
                    {runLabel}
                  </button>
                ) : null}
                {orderStatus === ORDER_STATUS.RETURN_DISPUTE ? (
                  <button type="button" className="primary-button" disabled={bulkUploading} onClick={handleBulkUploadClick}>
                    {bulkUploading ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="upload" />}
                    {bulkUploading ? "Uploading..." : "Bulk Status Update"}
                  </button>
                ) : null}
                <input
                  ref={bulkFileInputRef}
                  type="file"
                  hidden
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={(e) => void handleBulkFileSelected(e)}
                />
                <ToolbarPopover label="Export" icon="upload" primary disabled={exportLoading}>
                  {(close) => (
                    <div className="tv-menu-list" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!count}
                        onClick={() => {
                          close();
                          void downloadExcel("selected");
                        }}
                      >
                        <Icon name="check-circle" /> Selected {count ? `(${count})` : ""}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          void downloadExcel("page");
                        }}
                      >
                        <Icon name="file-text" /> Page Orders
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          void downloadExcel("all");
                        }}
                      >
                        <Icon name="database" /> All {totalRow} Orders
                      </button>
                    </div>
                  )}
                </ToolbarPopover>
              </>
            )}
          </div>
        </div>

        {canRunClaim && isGlobalScriptRunning ? (
          <p className="tv-rms-note tv-small">
            <span className="tv-spinner small" aria-hidden="true" /> A claim script is running — selection is paused until it finishes.
          </p>
        ) : canRunClaim ? (
          <p className="tv-rms-note is-muted tv-small">
            <Icon name="info" /> Select up to {MAX_CLAIM_ROWS} orders and use Run Claim to raise not-delivered claims on the AJIO portal.
          </p>
        ) : null}

        <DataTable<MasterOrder>
          columns={columns}
          rows={rows}
          getRowId={(r) => r._id}
          label="Return orders"
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          emptyTitle="No orders found"
          emptyMessage="No returns match this status, date range and filters."
          pagination="server"
          page={page}
          pageSize={limit}
          total={totalRow}
          pageSizes={[10, 25, 50, 100]}
          onPageChange={(p) => {
            setPage(p);
            setSelected(new Set());
          }}
          onPageSizeChange={(s) => {
            setLimit(s);
            setPage(1);
            setSelected(new Set());
          }}
          selected={selectionEnabled ? selected : undefined}
          onSelectedChange={selectionEnabled ? setSelected : undefined}
          isRowSelectable={(r) => !isGlobalScriptRunning && (selected.size < MAX_CLAIM_ROWS || selected.has(r._id))}
          selectionDisabledReason={() => (isGlobalScriptRunning ? "A claim script is running" : `Up to ${MAX_CLAIM_ROWS} orders at a time`)}
          storageKey="rms-orders"
        />
      </section>

      {bulkResult ? <RmsBulkResultDialog result={bulkResult} onClose={() => setBulkResult(null)} /> : null}
      {hasMasterImportPermission && ticketFor ? <MasterTicketDialog masterData={ticketFor} onClose={() => setTicketFor(null)} onSaved={list.reload} /> : null}
      {hasMasterImportPermission && rejectFor ? <MasterRejectDialog id={rejectFor} onClose={() => setRejectFor(null)} onSaved={list.reload} /> : null}
      {hasMasterImportPermission && reasonView ? <MasterViewReasonDialog data={reasonView} onClose={() => setReasonView(null)} /> : null}
      {historyFor ? <MasterHistoryDialog historyId={historyFor.id} returnAWB={historyFor.returnAWB} forwardAWB={historyFor.forwardAWB} onClose={() => setHistoryFor(null)} /> : null}
    </div>
  );
}
