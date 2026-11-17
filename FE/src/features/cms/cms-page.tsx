"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { addDays, format, startOfDay } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { BulkSelectionBar, DataTable, type SortDirection } from "@/components/ui/data-table";
import { DateRangePicker, defaultDatePresets, type DateRange } from "@/components/ui/date-range-picker";
import { FilterSelect, SearchInput } from "@/components/ui/form-field";
import { MultiCombobox } from "@/components/ui/combobox";
import { PageHeading } from "@/components/ui/page-heading";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { getStatusTone } from "@/components/ui/status-pill";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { CMS_STATUS, TEMP_PERMIT } from "@/config/constant";
import { buildCmsColumns } from "@/features/cms/cms-columns";
import { buildZip, fetchForZip } from "@/features/cms/cms-files";
import {
  AJIO_ONLY_STATUSES,
  AUTO_CLAIM_HIDDEN_PLATFORMS,
  BULK_STATUS_UPDATE_PLATFORMS,
  NAMED_PLATFORM_SET,
  OTHER_TAB,
  PLATFORM_TABS,
  collectAllResources,
  collectBundleImages,
  hasReachedRetryLimit,
  isMissingRequiredPobId,
  isMissingRequiredSubOrder,
  isRowSelectable,
  selectionDisabledReason,
  isScriptStatusBlocked,
  statusTabsFor,
  usernameOf,
} from "@/features/cms/cms-rules";
import { AjioSyncDialog } from "@/features/cms/dialogs/ajio-sync-dialog";
import { BulkResultDialog } from "@/features/cms/dialogs/bulk-result-dialog";
import { EditFieldsDialog } from "@/features/cms/dialogs/edit-fields-dialog";
import { EmailEditorDialog } from "@/features/cms/dialogs/email-editor-dialog";
import { HistoryDialog } from "@/features/cms/dialogs/history-dialog";
import { ImagesDialog, type LabelledImage } from "@/features/cms/dialogs/images-dialog";
import { MasterSyncDialog } from "@/features/cms/dialogs/master-sync-dialog";
import { DeleteClaimDialog, EditUsernameDialog, RejectReasonDialog, TicketDialog } from "@/features/cms/dialogs/simple-dialogs";
import { ViewClaimDialog } from "@/features/cms/dialogs/view-claim-dialog";
import { ExportMenu, type ExportScope } from "@/features/cms/export-menu";
import { useAutoClaimSimulation, type AutoClaimSummary } from "@/features/cms/use-auto-claim";
import { downloadBlob } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { claimHistoryService } from "@/services/claimHistory-service";
import { CmsService } from "@/services/cms-service";
import { FeedService } from "@/services/feed-service";
import { useDispatch, useSelector } from "@/store";
import { closeScriptProgress, setActiveScriptJob, startScriptProgress, updateScriptProgress } from "@/store/script-progress-slice";
import type { BulkStatusResult, CmsListPayload, ICms, IHistoryData } from "@/types/cms";

const EMPTY_SET: ReadonlySet<string> = new Set();
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

type ImagesView = { title: string; fileName: string; images: LabelledImage[] };

/** TrackVid `pages/CMS.tsx` — "Manage SPF Claims". */
export function CmsPage() {
  const dispatch = useDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useSelector((s) => s.profile.userProfile);
  const scriptProgress = useSelector((s) => s.scriptProgress);

  const canEdit = canAccess(user, ["admin"], ["cms::edit"]);
  const isAdmin = user?.role?.name === "admin";
  const platforms = user?.company?.settings?.eCommercePlatform ?? [];
  const isGlobalScriptRunning = scriptProgress.progress.running > 0 && !scriptProgress.isCompleted;

  // ----- filters -----
  const urlStatus = searchParams.get("status");
  const [seenUrlStatus, setSeenUrlStatus] = useState(urlStatus);
  const [status, setStatus] = useState<string>(urlStatus || CMS_STATUS.PENDING);
  if (urlStatus !== seenUrlStatus) {
    setSeenUrlStatus(urlStatus);
    setStatus(urlStatus || CMS_STATUS.PENDING);
  }
  const [platformTab, setPlatformTab] = useState<string>(PLATFORM_TABS[0].value);
  const [otherFilter, setOtherFilter] = useState<string[]>([]);
  const [usernameFilter, setUsernameFilter] = useState("");
  const [feedFilter, setFeedFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [range, setRange] = useState<DateRange>(() => ({ startDate: startOfDay(addDays(new Date(), -6)), endDate: new Date() }));
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [now] = useState(() => Date.now());

  // Search is debounced by 1s and, like TrackVid, jumps to the "All" status tab.
  useEffect(() => {
    if (searchInput === debouncedSearch) return;
    const id = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
      setStatus("All");
      setPage(1);
      setSelected(new Set());
    }, 1000);
    return () => window.clearTimeout(id);
  }, [searchInput, debouncedSearch]);

  const otherPlatformOptions = platforms.filter((p) => !NAMED_PLATFORM_SET.has(p.name.toLowerCase()));
  const effectivePlatformFilter: string[] =
    platformTab === OTHER_TAB
      ? otherFilter.length
        ? otherFilter
        : otherPlatformOptions.length
          ? otherPlatformOptions.map((p) => p.name)
          : [OTHER_TAB]
      : [platforms.find((p) => p.name.toLowerCase() === platformTab.toLowerCase())?.name ?? platformTab];
  const platformKey = effectivePlatformFilter.join("|");
  const startKey = ymd(range.startDate);
  const endKey = ymd(range.endDate);

  const basePayload = (): CmsListPayload => ({
    page,
    limit,
    search: debouncedSearch,
    startDate: startKey,
    endDate: endKey,
    feedId: feedFilter ? [feedFilter] : [],
    brand: [],
    eCommercePlatform: effectivePlatformFilter,
    username: usernameFilter,
    status: status === "All" ? "" : status,
  });

  const list = useAsync(
    () => CmsService.getCmsList({ ...basePayload(), sortBy: sort?.key, sortOrder: sort?.direction }),
    [page, limit, debouncedSearch, startKey, endKey, feedFilter, platformKey, usernameFilter, status, sort?.key, sort?.direction],
  );
  const counts = useAsync(
    () => CmsService.getCmsCounts({ ...basePayload(), otherPlatforms: otherPlatformOptions.map((p) => p.name) }),
    [debouncedSearch, startKey, endKey, feedFilter, platformKey, usernameFilter, status],
  );
  const feeds = useAsync(() => FeedService.getCommonFeeds(), []);

  const rows = list.data?.data.cms ?? [];
  const total = list.data?.data.metadata.total ?? 0;
  const usernameOptions = list.data?.filters.usernames ?? [];
  const statusCounts = counts.data?.data.statusCounts ?? {};
  const platformCounts = counts.data?.data.platformCounts ?? {};
  const refresh = () => {
    list.reload();
    counts.reload();
  };

  // ----- dialogs / busy state -----
  const [ticketFor, setTicketFor] = useState<{ _id: string; ticket: string } | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [usernameFor, setUsernameFor] = useState<ICms | null>(null);
  const [editRow, setEditRow] = useState<ICms | null>(null);
  const [viewRow, setViewRow] = useState<ICms | null>(null);
  const [emailRow, setEmailRow] = useState<ICms | null>(null);
  const [imagesView, setImagesView] = useState<ImagesView | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<IHistoryData | null>(null);
  const [masterSyncIds, setMasterSyncIds] = useState<string[] | null>(null);
  const [ajioSyncIds, setAjioSyncIds] = useState<string[] | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkStatusResult | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [zipBusyId, setZipBusyId] = useState("");
  const [retryingDriveIds, setRetryingDriveIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const [drivePoll, setDrivePoll] = useState(0);
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  });

  // Stand-in for the `cms:drive:status` socket: re-read once a re-queued Drive conversion has had time to finish.
  const reloadList = list.reload;
  const reloadCounts = counts.reload;
  useEffect(() => {
    if (!drivePoll) return;
    const id = window.setTimeout(() => {
      reloadList();
      reloadCounts();
    }, 6500);
    return () => window.clearTimeout(id);
  }, [drivePoll, reloadList, reloadCounts]);

  // The desktop app files claims with no script job behind them; it tells the page through this window event.
  useEffect(() => {
    const onDesktopClaim = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { cmsId?: string; status?: string; ticketNumber?: string; error?: string } | null;
      if (!detail?.cmsId) return;
      const current = listRef.current;
      const matched = current.data?.data.cms.some((r) => r._id === detail.cmsId) ?? false;
      current.setData((prev) =>
        prev
          ? {
              ...prev,
              data: {
                ...prev.data,
                cms: prev.data.cms.map((r) =>
                  r._id === detail.cmsId
                    ? { ...r, scriptProcessingStatus: (detail.status as ICms["scriptProcessingStatus"]) ?? r.scriptProcessingStatus, scriptProcessingError: detail.error ?? null, ticketNumber: detail.ticketNumber ?? r.ticketNumber }
                    : r,
                ),
              },
            }
          : prev,
      );
      if (!matched || detail.status === "Success") current.reload();
    };
    window.addEventListener("cms:desktop-claim:status", onDesktopClaim);
    return () => window.removeEventListener("cms:desktop-claim:status", onDesktopClaim);
  }, []);

  // ----- auto claim (socket simulation) -----
  const autoClaim = useAutoClaimSimulation({
    onProgress: refresh,
    onCompleted: (s: AutoClaimSummary) => {
      const capIds = new Set(s.failedToProceedIds);
      const allCapped = s.dispatchedIds.length > 0 && capIds.size > 0 && s.dispatchedIds.every((id) => capIds.has(id));
      setSelected(new Set());
      if (allCapped && status !== CMS_STATUS.FAILED_TO_PROCEED) setStatus(CMS_STATUS.FAILED_TO_PROCEED);
      refresh();
      if (s.failed === 0) toast.success(`All ${s.total} claims processed successfully!`);
      else if (allCapped) toast.error(`All ${s.total} claims hit the retry limit and were moved to Failed to Proceed.`);
      else toast.error(`${s.success} claims succeeded, ${s.failed} claims failed.`);
    },
  });

  const runAutoClaim = async () => {
    if (!selected.size) {
      toast.error("Please select at least one claim to process");
      return;
    }
    const chosen = rows.filter((r) => selected.has(r._id));
    const processable = chosen.filter((r) => !hasReachedRetryLimit(r) && !isMissingRequiredPobId(r) && !isMissingRequiredSubOrder(r) && !isScriptStatusBlocked(r));
    const pobBlocked = chosen.filter(isMissingRequiredPobId).length;
    const subOrderBlocked = chosen.filter(isMissingRequiredSubOrder).length;
    if (!processable.length) {
      toast.error(
        pobBlocked === selected.size
          ? `POB ID missing on ${pobBlocked === 1 ? "this AJIO claim" : `all ${pobBlocked} selected AJIO claims`}. AJIO rejects a claim without it — import the master data carrying the POB ID, then retry.`
          : subOrderBlocked === selected.size
            ? `Sub-order number missing on ${subOrderBlocked === 1 ? "this Meesho claim" : `all ${subOrderBlocked} selected Meesho claims`}. The Meesho claim form is filled by it — import the master data carrying the sub-order number, then retry.`
            : "All selected items are already processing, completed, or have reached the retry limit. Please select different items.",
      );
      return;
    }
    const ids = processable.map((r) => r._id);
    if (processable.length < selected.size) {
      const skipped = selected.size - processable.length;
      toast.warning(
        `${skipped} item(s) are already processing, completed, or reached the retry limit.${pobBlocked ? ` ${pobBlocked} of them missing a POB ID.` : ""}${subOrderBlocked ? ` ${subOrderBlocked} of them missing a sub-order number.` : ""} Processing ${processable.length} item(s).`,
      );
      setSelected(new Set(ids));
    }
    dispatch(startScriptProgress({ total: ids.length, running: ids.length, jobId: null }));
    try {
      const res = await CmsService.setReturnClaim({ ids, accountType: processable[0]?.accountType, overrideRetryLimit: TEMP_PERMIT });
      if (res.isSuccess && res.data.jobId) {
        const queued = res.data.status === "queued";
        if (res.data.existing) toast.info(res.displayMessage || "Job already exists, tracking existing job");
        else if (queued) toast.success(`Job queued successfully! Position: ${res.data.queuePosition ?? "N/A"} of ${res.data.totalInQueue ?? "N/A"}`);
        else toast.success("Script started successfully!");
        dispatch(setActiveScriptJob(res.data.jobId));
        dispatch(
          updateScriptProgress({
            jobId: res.data.jobId,
            status: queued ? "QUEUED" : "RUNNING",
            queuePosition: res.data.queuePosition,
            totalInQueue: res.data.totalInQueue,
            queued: queued ? ids.length : 0,
            running: ids.length,
          }),
        );
        autoClaim.start({
          jobId: res.data.jobId,
          queued,
          rows: processable.map((r) => ({ id: r._id, awb: r.AWBNumber, platform: r.eCommercePlatform, username: usernameOf(r) })),
        });
        refresh();
      } else if (res.data.drivePending) {
        dispatch(closeScriptProgress());
        toast.info(res.displayMessage || "AJIO Drive links are still being prepared. Please retry in a few moments.");
        refresh();
      } else {
        dispatch(closeScriptProgress());
        toast.error(res.displayMessage || "Failed to start script");
      }
    } catch (err) {
      dispatch(closeScriptProgress());
      toast.error(errorMessage(err, "Failed to start script"));
    }
  };

  // ----- row handlers -----
  const approve = async (row: ICms) => {
    setStatusBusyId(row._id);
    try {
      const res = await CmsService.updateCmsStatus({ _id: row._id, status: CMS_STATUS.APPROVED });
      toast.success(res.displayMessage);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStatusBusyId("");
    }
  };

  const openHistory = async (row: ICms) => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryData(null);
    try {
      const data = await claimHistoryService.getClaimHistoryById(row.history);
      setHistoryData({ ...data, returnAWB: row.AWBNumber, forwardAWB: row.forwardAWB ?? "" });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setHistoryLoading(false);
    }
  };

  const retryDrive = async (id: string) => {
    setRetryingDriveIds((prev) => new Set(prev).add(id));
    try {
      const res = await CmsService.retryDriveConversion(id);
      toast.success(res.displayMessage || "Drive conversion re-queued.");
      refresh();
      setDrivePoll((n) => n + 1);
    } catch (err) {
      toast.error(errorMessage(err, "Retry failed."));
    } finally {
      setRetryingDriveIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const downloadAll = async (row: ICms) => {
    const resources = collectAllResources(row);
    if (!resources.length) {
      toast.error("No resources to download");
      return;
    }
    setZipBusyId(row._id);
    try {
      const files: { name: string; data: Blob }[] = [];
      for (const r of resources) {
        const f = await fetchForZip(r.name, r.key);
        files.push({ name: `awb_${row.AWBNumber}/${f.name}`, data: f.data });
      }
      downloadBlob(await buildZip(files), `awb_${row.AWBNumber}.zip`);
      toast.success("ZIP file downloaded successfully");
    } catch (err) {
      toast.error(errorMessage(err, "Could not build the ZIP file"));
    } finally {
      setZipBusyId("");
    }
  };

  const openSixSide = (row: ICms) => {
    const a = row.returnProductImage?.fileKey ?? "/assets/images/products.webp";
    const b = row.forwardSentProductImage?.fileKey ?? "/assets/images/warehouse.webp";
    setImagesView({
      title: `Six Side Images — ${row.AWBNumber}`,
      fileName: `${row.AWBNumber} - Side Images`,
      images: ["Front", "Back", "Left", "Right", "Top", "Bottom"].map((label, i) => ({ label, key: i % 2 ? b : a })),
    });
  };

  const openBundleImages = (row: ICms) => {
    const entries = collectBundleImages(row);
    if (!entries.length) {
      toast.error("No images attached to this claim");
      return;
    }
    setImagesView({ title: `Images — ${row.AWBNumber}`, fileName: `${row.AWBNumber || "claim"} - Images`, images: entries.map((e) => ({ label: e.label, key: e.s3Key })) });
  };

  const onBulkFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setBulkUploading(true);
    try {
      const res = await CmsService.bulkStatusUpdate(file, platformTab);
      setBulkResult(res.data);
      toast.success(`${res.data.updatedCount} record(s) updated`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Bulk update failed"));
    } finally {
      setBulkUploading(false);
    }
  };

  const exportClaims = async (scope: ExportScope) => {
    setExporting(true);
    try {
      const blob = await CmsService.downloadExcelSheet({
        selectedClaims: scope === "selected" ? [...selected] : [],
        page,
        limit: scope === "all" ? 100000 : limit,
        search: searchInput,
        eCommercePlatform: effectivePlatformFilter,
        startDate: startKey,
        endDate: endKey,
        feedId: feedFilter ? [feedFilter] : [],
        username: usernameFilter,
        status: status === "All" ? "" : status,
      });
      downloadBlob(blob, `report-${format(new Date(), "dd-MM-yyyy")}.csv`);
    } catch (err) {
      toast.error(errorMessage(err, "Error downloading the Excel file"));
    } finally {
      setExporting(false);
    }
  };

  // ----- tabs -----
  const changeStatus = (next: string) => {
    setSelected(new Set());
    setStatus(next);
    setUsernameFilter("");
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.set("status", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const changePlatform = (next: string) => {
    setSelected(new Set());
    setOtherFilter([]);
    setUsernameFilter("");
    setPage(1);
    setSort(null);
    setPlatformTab(next);
    if (next.toLowerCase() !== "ajio" && AJIO_ONLY_STATUSES.has(status)) setStatus("All");
  };

  const statusTabs = statusTabsFor(platformTab);
  const statusItems: TabItem<string>[] = statusTabs.map((t) => ({
    key: t.value,
    label: (
      <span className="tv-cms-tab-label">
        <span className={`tv-cms-dot-sm tone-${t.value === "All" ? "blue" : getStatusTone(t.value)}`} aria-hidden="true" />
        {t.label}
      </span>
    ),
    count: statusCounts[t.value] ?? 0,
  }));
  const platformItems: TabItem<string>[] = PLATFORM_TABS.map((t) => ({
    key: t.value,
    label: (
      <span className="tv-cms-tab-label">
        <PlatformLogo name={t.value} showName={false} />
        {t.label}
      </span>
    ),
    count: platformCounts[t.value] ?? 0,
  }));
  // A status that is not on this platform's strip (e.g. arrived via ?status=) still needs a selected tab.
  const statusValue = statusTabs.some((t) => t.value === status) ? status : "All";

  const selectionEnabled = (status === CMS_STATUS.PENDING || (status === CMS_STATUS.FAILED_TO_PROCEED && TEMP_PERMIT)) && !isGlobalScriptRunning;
  const showAutoClaim = Boolean(user?.companyId) && (TEMP_PERMIT || (!AUTO_CLAIM_HIDDEN_PLATFORMS.has(platformTab.toLowerCase()) && status !== CMS_STATUS.FAILED_TO_PROCEED));
  const showBulkStatus = isAdmin && BULK_STATUS_UPDATE_PLATFORMS.includes(platformTab.toLowerCase()) && (platformTab.toLowerCase() === "ajio" || status === CMS_STATUS.IN_REVIEW);
  const count = selected.size;

  const columns = buildCmsColumns({
    status,
    platformTab,
    canEdit,
    isAdmin,
    user,
    now,
    retryingDriveIds,
    zipBusyId,
    statusBusyId,
    onEditFields: setEditRow,
    onEditTicket: (row) => setTicketFor({ _id: row._id, ticket: row.ticketNumber ?? "" }),
    onEditUsername: setUsernameFor,
    onEmail: setEmailRow,
    onSixSide: openSixSide,
    onImages: openBundleImages,
    onRetryDrive: (id) => void retryDrive(id),
    onDownloadAll: (row) => void downloadAll(row),
    onHistory: (row) => void openHistory(row),
    onView: setViewRow,
    onDelete: (row) => setDeleteId(row._id),
    onApprove: (row) => void approve(row),
    onReject: (row) => {
      setStatusBusyId(row._id);
      setRejectFor(row._id);
    },
  });

  return (
    <div className="tv-page tv-cms">
      <PageHeading title="Manage SPF Claims" subtitle="Track, auto-claim and review Seller Protection Fund claims across every marketplace." />

      <section className="glass-card tv-cms-tabs-card" aria-label="Claim filters">
        <Tabs items={platformItems} value={platformTab} onChange={changePlatform} label="CMS platform tabs" />
        <Tabs items={statusItems} value={statusValue} onChange={changeStatus} label="CMS status tabs" />
      </section>

      <section className="glass-card tv-table-card">
        <div className="c-toolbar tv-cms-toolbar">
          <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search orders..." label="Search claims" />
          {platformTab === OTHER_TAB ? (
            <div className="tv-cms-other-filter">
              <MultiCombobox label="E-commerce Platform" values={otherFilter} onChange={setOtherFilter} options={otherPlatformOptions.map((p) => ({ value: p.name, label: p.name }))} placeholder="All other platforms" />
            </div>
          ) : null}
          <FilterSelect
            label="Username"
            value={usernameFilter}
            allLabel={usernameOptions.length ? "All usernames" : "No usernames"}
            options={usernameOptions.map((u) => ({ value: u, label: u }))}
            onChange={(v) => {
              setUsernameFilter(v);
              setPage(1);
            }}
          />
          <FilterSelect
            label="Feed"
            value={feedFilter}
            allLabel="All feeds"
            options={(feeds.data ?? []).map((f) => ({ value: f._id, label: f.isDisable ? `${f.feedName} (Disabled)` : f.feedName }))}
            onChange={(v) => {
              setFeedFilter(v);
              setPage(1);
            }}
          />
          <DateRangePicker
            value={range}
            onChange={(r) => {
              if (!r) return;
              setRange(r);
              setPage(1);
            }}
            presets={defaultDatePresets}
            allowClear={false}
            label="Created date"
          />
          <div className="tv-cms-toolbar-actions">
            {TEMP_PERMIT && canEdit ? (
              <button type="button" className="secondary-button" disabled={!count} onClick={() => setMasterSyncIds([...selected])}>
                <Icon name="refresh" /> Master Sync {count ? `(${count})` : ""}
              </button>
            ) : null}
            {platformTab.toLowerCase() === "ajio" && canEdit ? (
              <button type="button" className="secondary-button" disabled={!count} onClick={() => setAjioSyncIds([...selected])}>
                <Icon name="arrows-down-up" /> AJIO Sync {count ? `(${count})` : ""}
              </button>
            ) : null}
            {showAutoClaim ? (
              <button type="button" className="primary-button" disabled={!count || isGlobalScriptRunning} onClick={() => void runAutoClaim()}>
                <Icon name="lightning" /> Auto Claim {count ? `(${count})` : ""}
              </button>
            ) : null}
            {showBulkStatus ? (
              <button type="button" className="secondary-button" disabled={bulkUploading} onClick={() => bulkInputRef.current?.click()}>
                {bulkUploading ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="upload" />}
                {bulkUploading ? "Uploading..." : "Bulk Status Update"}
              </button>
            ) : null}
            <input
              ref={bulkInputRef}
              type="file"
              hidden
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(e) => void onBulkFile(e)}
            />
            <ExportMenu selectedCount={count} total={total} busy={exporting} onExport={(s) => void exportClaims(s)} />
          </div>
        </div>

        {selectionEnabled ? (
          <BulkSelectionBar count={count} onClear={() => setSelected(new Set())}>
            {showAutoClaim ? (
              <button type="button" className="primary-button compact-button" disabled={isGlobalScriptRunning} onClick={() => void runAutoClaim()}>
                <Icon name="lightning" /> Auto Claim
              </button>
            ) : null}
            <button type="button" className="secondary-button compact-button" disabled={exporting} onClick={() => void exportClaims("selected")}>
              <Icon name="upload" /> Export selected
            </button>
          </BulkSelectionBar>
        ) : null}

        {isGlobalScriptRunning && (status === CMS_STATUS.PENDING || status === CMS_STATUS.FAILED_TO_PROCEED) ? (
          <p className="tv-cms-running-note tv-small">
            <span className="tv-spinner small" aria-hidden="true" /> Auto claim is running — selection is paused until it finishes.
          </p>
        ) : null}

        <DataTable<ICms>
          columns={columns}
          rows={rows}
          getRowId={(r) => r._id}
          label="SPF claims"
          loading={list.loading}
          error={list.error}
          onRetry={refresh}
          emptyTitle="No claims found"
          emptyMessage="No SPF claims match this platform, status and date range."
          pagination="server"
          page={page}
          pageSize={limit}
          total={total}
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
          sort={sort}
          onSortChange={(s) => {
            setSort(s);
            setPage(1);
          }}
          selected={selectionEnabled ? selected : undefined}
          onSelectedChange={selectionEnabled ? setSelected : undefined}
          isRowSelectable={(r) => !isGlobalScriptRunning && isRowSelectable(r)}
          selectionDisabledReason={(r) => (isGlobalScriptRunning ? "A claim script is running" : selectionDisabledReason(r))}
          storageKey="cms-claims"
        />
      </section>

      {emailRow?.emailTemplate ? (
        <EmailEditorDialog
          key={emailRow._id}
          awb={emailRow.AWBNumber}
          template={{ ...emailRow.emailTemplate, _id: emailRow._id }}
          canEdit={canEdit}
          onClose={() => setEmailRow(null)}
          onSaved={refresh}
        />
      ) : null}
      {viewRow ? <ViewClaimDialog row={viewRow} onClose={() => setViewRow(null)} /> : null}
      {canEdit && ticketFor ? <TicketDialog cms={ticketFor} onClose={() => setTicketFor(null)} onSaved={refresh} /> : null}
      {canEdit && rejectFor ? (
        <RejectReasonDialog
          id={rejectFor}
          onClose={() => {
            setRejectFor(null);
            setStatusBusyId("");
          }}
          onSaved={refresh}
        />
      ) : null}
      {historyOpen ? (
        <HistoryDialog
          loading={historyLoading}
          data={historyData}
          onClose={() => {
            setHistoryOpen(false);
            setHistoryData(null);
          }}
        />
      ) : null}
      {usernameFor ? <EditUsernameDialog cms={usernameFor} onClose={() => setUsernameFor(null)} onSaved={refresh} /> : null}
      {masterSyncIds ? (
        <MasterSyncDialog
          selectedIds={masterSyncIds}
          onClose={() => setMasterSyncIds(null)}
          onSynced={() => {
            setSelected(new Set());
            refresh();
          }}
        />
      ) : null}
      {ajioSyncIds ? (
        <AjioSyncDialog
          selectedIds={ajioSyncIds}
          onClose={() => setAjioSyncIds(null)}
          onSynced={() => {
            setSelected(new Set());
            refresh();
          }}
        />
      ) : null}
      {editRow ? <EditFieldsDialog key={editRow._id} row={editRow} platforms={platforms} onClose={() => setEditRow(null)} onSaved={refresh} /> : null}
      {deleteId ? <DeleteClaimDialog cmsId={deleteId} onClose={() => setDeleteId(null)} onDeleted={refresh} /> : null}
      {bulkResult ? <BulkResultDialog result={bulkResult} onClose={() => setBulkResult(null)} /> : null}
      {imagesView ? <ImagesDialog title={imagesView.title} fileName={imagesView.fileName} images={imagesView.images} onClose={() => setImagesView(null)} /> : null}
    </div>
  );
}
