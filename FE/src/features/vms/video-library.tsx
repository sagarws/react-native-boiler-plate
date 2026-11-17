"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { addDays, format, startOfDay } from "date-fns";
import { Icon } from "@/components/icons/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BulkSelectionBar, DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangePicker, defaultDatePresets, type DateRange } from "@/components/ui/date-range-picker";
import { SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { platformLogoUrl } from "@/components/ui/platform-logo";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination } from "@/components/ui/table-pagination";
import { copyText, downloadBlob } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { FeedService } from "@/services/feed-service";
import { FileService } from "@/services/file-service";
import { VmsService } from "@/services/vms-service";
import { useSelector } from "@/store";
import type { OrderType } from "@/types/accounts";
import type { ScreenshotView, VideoPreview, VmsListPayload, VmsOrder } from "@/types/vms";
import { AddCommentDialog, EditTrackingIdDialog } from "./components/order-dialogs";
import { ScreenshotsDialog } from "./components/screenshots-dialog";
import { ConditionChip, ExportMenu, MultiFilter, OrderTypeTrackingId, type ExportScope } from "./components/toolbar-controls";
import { VideoPreviewDialog } from "./components/video-preview-dialog";
import { buildResourcesZip, convertKBtoMB, getPlatformDisplayName, isLockedRow, safeFormat, secondsToTime } from "./vms-utils";

export type VideoLibraryMode = "vms" | "favorite";

const ORDER_TYPE_OPTIONS = [
  { value: "Return", label: "Return" },
  { value: "Forward", label: "Forward" },
];
const POLL_MS = 10000;
/** ~5 min cap (30 × 10s) so nothing can poll forever. */
const POLL_MAX = 30;
const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const dash = (v: string | null | undefined) => (v ? v : "---");

/**
 * TrackVid `pages/VMS.tsx` (mode "vms") and `pages/Favorite.tsx` (mode "favorite"): the recorded-video table with
 * filters, preview player, screenshots, favorites, comments, tracking-ID edit, video delete and cloud retry.
 */
export function VideoLibrary({ mode }: { mode: VideoLibraryMode }) {
  const isVms = mode === "vms";
  const user = useSelector((s) => s.profile.userProfile);
  // Favorite.tsx gates its selects with favorite::edit; VMS.tsx with vms::edit.
  const hasEditPermission = canAccess(user, ["admin"], [isVms ? "vms::edit" : "favorite::edit"]);
  const hasFavoriteEditPermission = canAccess(user, ["admin"], ["favorite::edit"]);
  const platformOptions = (user?.company?.settings?.eCommercePlatform ?? []).map((p) => p.name);

  const feeds = useAsync(() => FeedService.getCommonFeeds(), []);

  // ----- filters -----
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [feedFilter, setFeedFilter] = useState<string[]>([]);
  const [orderTypeFilter, setOrderTypeFilter] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(() => ({ startDate: startOfDay(addDays(new Date(), isVms ? -6 : -30)), endDate: new Date() }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"table" | "grid">("table");

  // ----- dialogs / busy flags -----
  const [preview, setPreview] = useState<VideoPreview | null>(null);
  const [screenshotView, setScreenshotView] = useState<ScreenshotView | null>(null);
  const [commentFor, setCommentFor] = useState<VmsOrder | null>(null);
  const [trackingFor, setTrackingFor] = useState<VmsOrder | null>(null);
  const [deleteFor, setDeleteFor] = useState<VmsOrder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [retryingKey, setRetryingKey] = useState("");
  const [favBusy, setFavBusy] = useState(false);

  // Search is debounced by 1s (TrackVid lodash debounce) and resets to page 1.
  useEffect(() => {
    if (searchInput === debouncedSearch) return;
    const id = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [searchInput, debouncedSearch]);

  const payload: VmsListPayload = {
    page,
    limit,
    search: debouncedSearch,
    startDate: ymd(range.startDate),
    endDate: ymd(range.endDate),
    orderType: orderTypeFilter,
    feedId: feedFilter,
    ...(isVms ? { eCommercePlatform: platformFilter } : { isFavorite: true }),
  };
  const payloadKey = JSON.stringify(payload);
  const list = useAsync(() => VmsService.getOrderList(JSON.parse(payloadKey) as VmsListPayload), [payloadKey]);
  const rows = list.data?.order ?? [];
  const total = list.data?.metadata.total ?? 0;
  const setRows = (fn: (rows: VmsOrder[]) => VmsOrder[]) => list.setData((prev) => (prev ? { ...prev, order: fn(prev.order) } : prev));

  // TrackVid toasts list errors as well as showing them.
  const lastToastedError = useRef<string | null>(null);
  useEffect(() => {
    if (list.error && list.error !== lastToastedError.current) toast.error(list.error);
    lastToastedError.current = list.error;
  }, [list.error]);

  // ----- auto-refresh while any video is still processing on the cloud (VMS only) -----
  const hasProcessing = isVms && rows.some((r) => r.cloudStatus === "processing");
  const pollAttempts = useRef(0);
  const keyRef = useRef(payloadKey);
  const setDataRef = useRef(list.setData);
  useEffect(() => {
    keyRef.current = payloadKey;
    setDataRef.current = list.setData;
  });
  useEffect(() => {
    if (!hasProcessing) {
      pollAttempts.current = 0;
      return;
    }
    let active = true;
    const id = window.setInterval(() => {
      if (pollAttempts.current >= POLL_MAX) {
        window.clearInterval(id);
        return;
      }
      pollAttempts.current += 1;
      const key = keyRef.current;
      VmsService.getOrderList(JSON.parse(key) as VmsListPayload)
        .then((res) => {
          // Ignore a poll that finished after the filters changed.
          if (active && key === keyRef.current) setDataRef.current(res);
        })
        .catch(() => {
          // A failed background poll is retried on the next tick; the table keeps its rows.
        });
    }, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [hasProcessing, payloadKey]);

  const resetPaging = () => {
    setPage(1);
    setSelected(new Set());
  };

  // ----- actions -----
  const copyVideoLink = async (key: string) => {
    try {
      const res = await FileService.getFileUrl(key);
      if (await copyText(res.url)) toast.success("Link copied to clipboard!");
      else toast.error("Clipboard is blocked in this browser.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleRetryCloud = async (rawVideoKey: string) => {
    setRetryingKey(rawVideoKey);
    try {
      const res = await VmsService.retryCloudProcessing(rawVideoKey);
      toast.success(res.displayMessage || "Retrying cloud processing…");
      pollAttempts.current = 0; // fresh attempt: reset the poll cap
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to retry. Please try again."));
    } finally {
      setRetryingKey("");
    }
  };

  const handleFavoriteOrder = async (ids: string[], isFavorite: boolean) => {
    setFavBusy(true);
    try {
      const res = isFavorite ? await VmsService.removeFavorite({ id: ids }) : await VmsService.addToFavorite({ id: ids });
      toast.success(res.displayMessage);
      setSelected(new Set());
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err, "Something went wrong"));
    } finally {
      setFavBusy(false);
    }
  };

  const handleUpdateOrderType = async (status: OrderType, id: string) => {
    try {
      const res = await VmsService.updateOrderType({ orderId: id, status });
      setRows((rs) => rs.map((r) => (r._id === res.data._id ? { ...r, orderType: res.data.orderType } : r)));
      toast.success(res.displayMessage);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleUpdatePlatformType = async (eCommercePlatform: string, id: string) => {
    try {
      const res = await VmsService.updatePlatformType({ orderId: id, eCommercePlatform });
      setRows((rs) => rs.map((r) => (r._id === res.data._id ? { ...r, eCommercePlatform: res.data.eCommercePlatform } : r)));
      toast.success(res.displayMessage);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleDownloadAllResources = async (order: VmsOrder) => {
    setZipBusy(true);
    try {
      const zip = await buildResourcesZip(order);
      if (!zip) {
        toast.error("No resources to download");
        return;
      }
      downloadBlob(zip, `${order.trackingId}.zip`);
      toast.success("ZIP file downloaded successfully");
    } catch (err) {
      toast.error(errorMessage(err, "Error downloading the ZIP file"));
    } finally {
      setZipBusy(false);
    }
  };

  const handleConfirmDeleteVideo = async () => {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const res = await VmsService.deleteVideo({ orderId: deleteFor._id });
      toast.success(res.displayMessage || "Video deleted successfully");
      setRows((rs) => rs.map((r) => (r._id === deleteFor._id ? { ...r, fileId: "", key: "", screenshots: [] } : r)));
      setDeleteFor(null);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete video"));
    } finally {
      setDeleting(false);
    }
  };

  const downloadExcel = async (scope: ExportScope) => {
    setExportBusy(true);
    try {
      const blob = await VmsService.downloadExcelSheet({
        ...payload,
        search: searchInput,
        selectedOrders: scope === "selected" ? [...selected] : [],
        page: scope === "all" ? 1 : page,
        limit: scope === "all" ? 100000 : limit,
      });
      downloadBlob(blob, `report-${format(new Date(), "dd-MM-yyyy")}.csv`);
    } catch (err) {
      toast.error(errorMessage(err, "Error downloading the Excel file"));
    } finally {
      setExportBusy(false);
    }
  };

  const openPreview = (r: VmsOrder) =>
    setPreview({
      url: r.key,
      title: r.trackingId,
      createdAt: r.createdAt,
      feedName: r.feedName ?? "",
      orderType: r.orderType,
      videoSize: convertKBtoMB(r.size),
      fileKey: r.key,
    });

  const lockedFor = (r: VmsOrder) => (isVms ? isLockedRow(r) : r.isDeleted);

  // ----- columns -----
  const previewCell = (r: VmsOrder): ReactNode => {
    const button = (
      <button type="button" className="secondary-button compact-button" disabled={r.isDeleted || (isVms && !r.key)} onClick={() => openPreview(r)}>
        <Icon name="image" /> Preview
      </button>
    );
    if (!isVms) return button;
    if (r.cloudStatus === "processing") {
      return (
        <span className="tv-vms-processing" title="Video processing in progress">
          {button}
          <span className="tv-spinner small" aria-label="Video processing in progress" />
        </span>
      );
    }
    if (r.cloudStatus === "failed") {
      const retriesLeft = 3 - (r.cloudRetryCount ?? 0);
      const isRetrying = retryingKey === r.key;
      return (
        <span className="tv-row tv-vms-failed">
          <span className="tv-vms-failed-label" title={retriesLeft > 0 ? `Cloud processing failed — click Retry to reprocess (${retriesLeft} of 3 left)` : "Cloud processing failed — maximum retries reached"}>
            <Icon name="warning" /> Failed
          </span>
          {retriesLeft > 0 ? (
            <button type="button" className="danger-button compact-button" disabled={isRetrying} onClick={() => void handleRetryCloud(r.key)}>
              {isRetrying ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="rotate-cw" />}
              {isRetrying ? "Retrying" : `Retry (${retriesLeft})`}
            </button>
          ) : (
            <span className="tv-muted tv-small">(max)</span>
          )}
        </span>
      );
    }
    return button;
  };

  const actionsCell = (r: VmsOrder): ReactNode => {
    const locked = lockedFor(r);
    return (
      <span className="tv-vms-actions">
        <button type="button" className="icon-button" aria-label={`Copy video link of ${r.trackingId}`} title="Copy link" disabled={locked || !r.key} onClick={() => void copyVideoLink(r.key)}>
          <Icon name="link" />
        </button>
        <button type="button" className="icon-button" aria-label={`Download video and screenshots of ${r.trackingId}`} title="Download" disabled={locked || zipBusy} onClick={() => void handleDownloadAllResources(r)}>
          <Icon name="download" />
        </button>
        {isVms && hasEditPermission ? (
          <button type="button" className="icon-button" aria-label={`Edit tracking ID ${r.trackingId}`} title="Edit Tracking ID" disabled={r.isDeleted} onClick={() => setTrackingFor(r)}>
            <Icon name="pencil" />
          </button>
        ) : null}
        {isVms && hasEditPermission && r.fileId && r.key ? (
          <button type="button" className="icon-button tv-vms-danger" aria-label={`Delete video of ${r.trackingId}`} title="Delete Video" disabled={r.isDeleted || deleting} onClick={() => setDeleteFor(r)}>
            <Icon name="trash" />
          </button>
        ) : null}
        {hasFavoriteEditPermission ? (
          <button
            type="button"
            className={`icon-button tv-vms-star ${r.isFavorite ? "is-on" : ""}`.trim()}
            aria-label={r.isFavorite ? `Remove ${r.trackingId} from favorites` : `Add ${r.trackingId} to favorites`}
            aria-pressed={r.isFavorite}
            title="Favorite"
            disabled={locked || favBusy}
            onClick={() => void handleFavoriteOrder([r._id], r.isFavorite)}
          >
            <Icon name="star" />
          </button>
        ) : null}
      </span>
    );
  };

  const columns: DataColumn<VmsOrder>[] = [
    { key: "trackingId", header: "Scanned Number", width: 190, render: (r) => <OrderTypeTrackingId order={r} /> },
    { key: "orderNo", header: "Cust. Order No", width: 150, render: (r) => <span className="tv-mono">{dash(r.orderNo)}</span> },
    { key: "awbNo", header: "Forward AWB No", width: 160, render: (r) => <span className="tv-mono">{dash(r.awbNo)}</span> },
    {
      key: "orderType",
      header: "Order Type",
      width: 130,
      render: (r) => (
        <select className="tv-vms-cell-select" aria-label={`Order type of ${r.trackingId}`} value={r.orderType} disabled={!hasEditPermission || r.isDeleted} onChange={(e) => void handleUpdateOrderType(e.currentTarget.value as OrderType, r._id)}>
          <option value="Forward">Forward</option>
          <option value="Return">Return</option>
        </select>
      ),
    },
    {
      key: "eCommercePlatform",
      header: "Platform",
      width: 180,
      render: (r) => {
        const logo = r.eCommercePlatform ? platformLogoUrl(r.eCommercePlatform) : undefined;
        return (
          <span className="tv-vms-platform-cell">
            {logo ? <img src={logo} alt="" /> : null}
            <select className="tv-vms-cell-select" aria-label={`Platform of ${r.trackingId}`} value={r.eCommercePlatform || "None"} disabled={!hasEditPermission} onChange={(e) => void handleUpdatePlatformType(e.currentTarget.value, r._id)}>
              {!r.eCommercePlatform ? <option value="None">None</option> : null}
              {r.eCommercePlatform && !platformOptions.includes(r.eCommercePlatform) ? <option value={r.eCommercePlatform}>{getPlatformDisplayName(r.eCommercePlatform)}</option> : null}
              {platformOptions.map((p) => (
                <option key={p} value={p}>
                  {getPlatformDisplayName(p)}
                </option>
              ))}
            </select>
          </span>
        );
      },
    },
    { key: "fileUrl", header: "Preview", width: isVms ? 190 : 130, render: previewCell },
    {
      key: "screenshots",
      header: "Screenshots",
      width: 160,
      render: (r) => (
        <button type="button" className="secondary-button compact-button" disabled={r.isDeleted || (isVms && !r.screenshots.length)} onClick={() => setScreenshotView({ trackingId: r.trackingId, screenshots: r.screenshots })}>
          <Icon name="camera" /> Screenshots ({r.screenshots.length})
        </button>
      ),
    },
    { key: "orderCondition", header: "Parcel Condition", width: 150, align: "center", hidden: !isVms, render: (r) => (r.orderType === "Return" && r.orderCondition ? <ConditionChip condition={r.orderCondition} /> : "-") },
    { key: "actions", header: "Actions", width: isVms ? 230 : 150, render: actionsCell },
    {
      key: "ajioReplied",
      header: "Email Auto Replied",
      width: 140,
      align: "center",
      hidden: !isVms,
      render: (r) =>
        r.ajioReplied === true ? (
          <span className="tv-vms-replied" title="Email auto replied">
            <Icon name="check-circle" />
          </span>
        ) : (
          <span className="tv-muted">—</span>
        ),
    },
    {
      key: "comment",
      header: "Add Comment",
      width: 130,
      hidden: !isVms,
      render: (r) => (
        <button type="button" className={`secondary-button compact-button ${r.comment ? "tv-vms-has-comment" : ""}`.trim()} title={r.comment || undefined} onClick={() => setCommentFor(r)}>
          <Icon name="chats-circle" /> Comment
        </button>
      ),
    },
    { key: "size", header: "File Size", width: 110, render: (r) => convertKBtoMB(r.size) },
    { key: "videoLength", header: "Video Length", width: 130, render: (r) => secondsToTime(r.videoLength) },
    { key: "feedName", header: "Feed", width: 150, render: (r) => dash(r.feedName) },
    { key: "startDateTime", header: "Start Date-Time", width: 200, render: (r) => safeFormat(r.start_time, "dd/MM/yyyy hh:mm:ss a") },
    { key: "deleteOn", header: "Expire On", width: 120, render: (r) => safeFormat(r.deleteOn, "dd/MM/yyyy", "-") },
  ];

  const count = selected.size;
  const feedOptions = (feeds.data ?? []).map((f) => ({ value: f._id, label: f.feedName, hint: f.isDisable ? "Disabled" : undefined }));

  return (
    <div className="tv-page tv-vms">
      <PageHeading
        title={isVms ? "VMS" : "Favorites"}
        subtitle={isVms ? "Every packing and return video recorded by your feeds, with screenshots and claim evidence." : "Videos you starred for quick access during claims and disputes."}
      />

      <section className="glass-card tv-table-card">
        <div className="c-toolbar tv-vms-toolbar">
          <SearchInput value={searchInput} onChange={setSearchInput} placeholder={isVms ? "Search orders..." : "Search favorites..."} label={isVms ? "Search orders" : "Search favorites"} />
          <div className="tv-vms-toolbar-actions">
            {isVms ? (
              <MultiFilter
                label="Platform"
                values={platformFilter}
                options={platformOptions.map((p) => ({ value: p, label: getPlatformDisplayName(p), logo: platformLogoUrl(p) }))}
                emptyText="No platforms found"
                onChange={(v) => {
                  setPlatformFilter(v);
                  resetPaging();
                }}
              />
            ) : null}
            <MultiFilter
              label="Feed"
              values={feedFilter}
              options={feedOptions}
              loading={feeds.loading}
              onChange={(v) => {
                setFeedFilter(v);
                resetPaging();
              }}
            />
            <MultiFilter
              label="Order Type"
              values={orderTypeFilter}
              options={isVms ? ORDER_TYPE_OPTIONS : [...ORDER_TYPE_OPTIONS].reverse()}
              onChange={(v) => {
                setOrderTypeFilter(v);
                resetPaging();
              }}
            />
            <DateRangePicker
              value={range}
              onChange={(r) => {
                if (!r) return;
                setRange(r);
                resetPaging();
              }}
              presets={defaultDatePresets}
              label="Recorded date"
            />
            <div className="tv-vms-segment" role="radiogroup" aria-label="View">
              <button type="button" role="radio" aria-checked={view === "table"} aria-label="Table view" title="Table view" onClick={() => setView("table")}>
                <Icon name="list" />
              </button>
              <button type="button" role="radio" aria-checked={view === "grid"} aria-label="Grid view" title="Grid view" onClick={() => setView("grid")}>
                <Icon name="squares-four" />
              </button>
            </div>
            <ExportMenu selectedCount={count} total={total} busy={exportBusy} onExport={(s) => void downloadExcel(s)} />
          </div>
        </div>

        <BulkSelectionBar count={hasFavoriteEditPermission ? count : 0} onClear={() => setSelected(new Set())}>
          {isVms ? (
            <button type="button" className="secondary-button" disabled={favBusy} onClick={() => void handleFavoriteOrder([...selected], false)}>
              <Icon name="star" /> Add to Favorite
            </button>
          ) : null}
          <button type="button" className="secondary-button" disabled={favBusy} onClick={() => void handleFavoriteOrder([...selected], true)}>
            <Icon name="x-circle" /> Remove Favorite
          </button>
        </BulkSelectionBar>

        {hasProcessing ? (
          <p className="tv-vms-note tv-small">
            <span className="tv-spinner small" aria-hidden="true" /> Some videos are still processing on the cloud — the list refreshes every 10 seconds.
          </p>
        ) : null}

        {view === "table" ? (
          <DataTable<VmsOrder>
            columns={columns}
            rows={rows}
            getRowId={(r) => r._id}
            label={isVms ? "Recorded videos" : "Favorite videos"}
            loading={list.loading || zipBusy}
            error={list.error}
            onRetry={list.reload}
            emptyTitle={isVms ? "No videos found" : "No favorites yet"}
            emptyMessage={isVms ? "No recorded videos match these filters and dates." : "Star a video on the VMS page to see it here."}
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
              resetPaging();
            }}
            selected={selected}
            onSelectedChange={setSelected}
            storageKey={isVms ? "vms-videos" : "favorite-videos"}
          />
        ) : (
          <VideoGrid
            rows={rows}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            isVms={isVms}
            canFavorite={hasFavoriteEditPermission}
            favBusy={favBusy}
            selected={selected}
            onToggleSelect={(id) =>
              setSelected((s) => {
                const next = new Set(s);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onPreview={openPreview}
            onScreenshots={(r) => setScreenshotView({ trackingId: r.trackingId, screenshots: r.screenshots })}
            onFavorite={(r) => void handleFavoriteOrder([r._id], r.isFavorite)}
            footer={
              <TablePagination
                total={total}
                page={page}
                size={limit}
                sizes={[10, 25, 50, 100]}
                onPageChange={(p) => {
                  setPage(p);
                  setSelected(new Set());
                }}
                onSizeChange={(s) => {
                  setLimit(s);
                  resetPaging();
                }}
              />
            }
          />
        )}
      </section>

      {preview ? <VideoPreviewDialog key={preview.fileKey} preview={preview} onClose={() => setPreview(null)} /> : null}
      {screenshotView ? <ScreenshotsDialog view={screenshotView} onClose={() => setScreenshotView(null)} /> : null}
      {commentFor ? (
        <AddCommentDialog
          key={commentFor._id}
          order={commentFor}
          onClose={() => setCommentFor(null)}
          onSaved={(comment) => setRows((rs) => rs.map((r) => (r._id === commentFor._id ? { ...r, comment } : r)))}
        />
      ) : null}
      {trackingFor ? (
        <EditTrackingIdDialog
          key={trackingFor._id}
          order={trackingFor}
          onClose={() => setTrackingFor(null)}
          onSaved={(updated) => {
            setRows((rs) => rs.map((r) => (r._id === updated._id ? { ...r, trackingId: updated.trackingId } : r)));
            list.reload();
          }}
        />
      ) : null}
      {deleteFor ? (
        <ConfirmDialog
          title="Delete Video"
          message="Are you sure you want to delete this video? This will permanently delete the video and all screenshots. This action cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          busy={deleting}
          onConfirm={() => void handleConfirmDeleteVideo()}
          onClose={() => setDeleteFor(null)}
        />
      ) : null}
    </div>
  );
}

/** Media-library grid view (template `c-media-grid`) of the same page of videos. */
function VideoGrid({
  rows,
  loading,
  error,
  onRetry,
  isVms,
  canFavorite,
  favBusy,
  selected,
  onToggleSelect,
  onPreview,
  onScreenshots,
  onFavorite,
  footer,
}: {
  rows: readonly VmsOrder[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  isVms: boolean;
  canFavorite: boolean;
  favBusy: boolean;
  selected: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  onPreview: (r: VmsOrder) => void;
  onScreenshots: (r: VmsOrder) => void;
  onFavorite: (r: VmsOrder) => void;
  footer: ReactNode;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  return (
    <div className="tv-stack">
      {loading ? (
        <div className="c-media-grid" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} height={230} />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState icon="film" title={isVms ? "No videos found" : "No favorites yet"} message={isVms ? "No recorded videos match these filters and dates." : "Star a video on the VMS page to see it here."} />
      ) : (
        <div className="c-media-grid tv-vms-grid">
          {rows.map((r) => {
            const processing = isVms && r.cloudStatus === "processing";
            const failed = isVms && r.cloudStatus === "failed";
            return (
              <article key={r._id} className={`c-media-file ${selected.has(r._id) ? "is-selected" : ""}`.trim()}>
                <button type="button" className="c-media-thumb tv-vms-thumb" aria-label={`Preview ${r.trackingId}`} disabled={r.isDeleted || !r.key} onClick={() => onPreview(r)}>
                  {r.screenshots[0] ? <img src={r.screenshots[0].url} alt="" /> : <Icon name="film" />}
                  <span className="tv-vms-thumb-play" aria-hidden="true">
                    <Icon name="play" />
                  </span>
                  <span className="tv-vms-thumb-length">{secondsToTime(r.videoLength)}</span>
                  {processing ? <span className="c-status amber tv-vms-thumb-badge">Processing</span> : failed ? <span className="c-status red tv-vms-thumb-badge">Failed</span> : null}
                </button>
                <div>
                  <strong>
                    <OrderTypeTrackingId order={r} />
                  </strong>
                  <small>
                    {r.feedName ?? "-"} · {convertKBtoMB(r.size)} · {safeFormat(r.start_time, "dd MMM, hh:mm a")}
                  </small>
                </div>
                <div className="c-media-actions">
                  {canFavorite ? (
                    <label className="tv-check tv-vms-grid-check" title="Select">
                      <input type="checkbox" checked={selected.has(r._id)} aria-label={`Select ${r.trackingId}`} onChange={() => onToggleSelect(r._id)} />
                    </label>
                  ) : null}
                  <button type="button" className="secondary-button" disabled={r.isDeleted || !r.screenshots.length} onClick={() => onScreenshots(r)}>
                    <Icon name="camera" /> {r.screenshots.length}
                  </button>
                  {canFavorite ? (
                    <button
                      type="button"
                      className={`secondary-button tv-vms-star ${r.isFavorite ? "is-on" : ""}`.trim()}
                      aria-pressed={r.isFavorite}
                      disabled={favBusy || (isVms ? isLockedRow(r) : r.isDeleted)}
                      onClick={() => onFavorite(r)}
                    >
                      <Icon name="star" /> {r.isFavorite ? "Unstar" : "Star"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {footer}
    </div>
  );
}
