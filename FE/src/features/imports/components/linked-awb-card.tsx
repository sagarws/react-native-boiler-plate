"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { CardHeading, ToneBadge } from "@/components/ui/card-primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BulkSelectionBar, DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect, SearchInput } from "@/components/ui/form-field";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { VideoPlayer } from "@/components/ui/video-player";
import { eCommercePlatformOptions } from "@/config/constant";
import { useDebouncedValue } from "@/features/master-data/use-debounced-value";
import { downloadText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { ExternalOrdersService } from "@/services/externalOrder-service";
import type { ExternalOrder } from "@/types/imports";

/**
 * Records created by "Forward and Return AWB linking" imports (TrackVid `getExternalOrders` / `deleteExternalOrder` /
 * `downloadExternalOrder`), with search, platform filter, selection, delete and export.
 */
export function LinkedAwbCard({ refreshKey, canEdit }: { refreshKey: number; canEdit: boolean }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [video, setVideo] = useState<{ title: string; src: string } | null>(null);
  const debounced = useDebouncedValue(search, 500);

  const { data, loading, error, reload } = useAsync(
    () => ExternalOrdersService.getExternalOrdersData({ page: String(page), limit: String(limit), searchInput: debounced, import_platform: platform }),
    [page, limit, debounced, platform, refreshKey],
  );

  const exportRows = async (ids: string[]) => {
    setExporting(true);
    try {
      const res = await ExternalOrdersService.downloadExternalOrder({ ids });
      downloadText(res.csv, res.fileName, "text/csv;charset=utf-8");
      toast.success(`Exported ${res.count} record(s)`);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to download the Excel file"));
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteIds) return;
    setDeleting(true);
    try {
      const res = await ExternalOrdersService.deleteExternalOrder({ ids: deleteIds });
      toast.success(res.message);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of deleteIds) next.delete(id);
        return next;
      });
      setDeleteIds(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const videoCell = (row: ExternalOrder, which: "forward" | "return") => {
    const src = which === "forward" ? row.forward_video_link : row.return_video_link;
    if (!src) return <span className="tv-muted">—</span>;
    return (
      <button
        type="button"
        className="secondary-button compact-button"
        onClick={() => setVideo({ title: `${which === "forward" ? "Forward" : "Return"} video · ${which === "forward" ? row.forward_awb : row.return_awb}`, src })}
      >
        <Icon name="play" /> Play
      </button>
    );
  };

  const columns: DataColumn<ExternalOrder>[] = [
    { key: "forward_awb", header: "Forward AWB", width: 170, render: (r) => <span className="tv-mono">{r.forward_awb || "—"}</span> },
    { key: "return_awb", header: "Return AWB", width: 160, render: (r) => <span className="tv-mono">{r.return_awb || "—"}</span> },
    { key: "import_platform", header: "Platform", width: 140, render: (r) => <PlatformLogo name={r.import_platform} /> },
    { key: "import_type", header: "Type", width: 110, render: (r) => <ToneBadge label={r.import_type === "forward" ? "Forward" : "Return"} tone={r.import_type === "forward" ? "blue" : "amber"} /> },
    { key: "forward_video_link", header: "Forward Video", width: 130, render: (r) => videoCell(r, "forward") },
    { key: "return_video_link", header: "Return Video", width: 130, render: (r) => videoCell(r, "return") },
    { key: "createdAt", header: "Imported At", width: 180, render: (r) => formatDateTime(r.createdAt) },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      label: "Actions",
      width: 64,
      align: "right",
      render: (r) => (
        <RowActionsMenu
          label={r.forward_awb}
          actions={[
            { label: "Download row", icon: "download", onClick: () => void exportRows([r._id]) },
            { label: "Delete", icon: "trash", danger: true, separatorBefore: true, hidden: !canEdit, onClick: () => setDeleteIds([r._id]) },
          ]}
        />
      ),
    },
  ];

  return (
    <section className="glass-card tv-table-card">
      <CardHeading
        title="Linked AWB records"
        extra={
          <button type="button" className="secondary-button compact-button" disabled={exporting || !data?.metadata.total} onClick={() => void exportRows([])}>
            {exporting ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="download" />} Export all
          </button>
        }
      />
      <div className="c-toolbar">
        <SearchInput
          value={search}
          placeholder="Search forward / return AWB..."
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Platform"
          value={platform}
          allLabel="All platforms"
          options={eCommercePlatformOptions}
          onChange={(v) => {
            setPlatform(v);
            setPage(1);
          }}
        />
      </div>
      <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <button type="button" className="secondary-button" disabled={exporting} onClick={() => void exportRows([...selected])}>
          <Icon name="download" /> Export selected
        </button>
        {canEdit ? (
          <button type="button" className="danger-button" onClick={() => setDeleteIds([...selected])}>
            <Icon name="trash" /> Delete
          </button>
        ) : null}
      </BulkSelectionBar>
      <DataTable
        label="Linked AWB records"
        columns={columns}
        rows={data?.orders ?? []}
        getRowId={(r) => r._id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyTitle="No linked AWBs yet"
        emptyMessage="Import a Forward and Return AWB linking sheet to see records here."
        selected={selected}
        onSelectedChange={setSelected}
        pagination="server"
        page={page}
        pageSize={limit}
        pageSizes={[10, 25, 50]}
        total={data?.metadata.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setLimit(s);
          setPage(1);
        }}
        storageKey="imports-linked-awb"
      />

      {deleteIds ? (
        <ConfirmDialog
          title="Delete linked records?"
          message={`This removes ${deleteIds.length} forward/return AWB link(s). Videos stay in VMS.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleteIds(null)}
        />
      ) : null}

      {video ? (
        <AppDialog title={video.title} onClose={() => setVideo(null)} size="wide">
          <VideoPlayer src={video.src} title={video.title} autoPlay />
        </AppDialog>
      ) : null}
    </section>
  );
}
