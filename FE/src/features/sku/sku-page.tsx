"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Combobox } from "@/components/ui/combobox";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { VideoPlayer } from "@/components/ui/video-player";
import { SkuImportDialog } from "@/features/imports/components/import-dialogs";
import { useDebouncedValue } from "@/features/master-data/use-debounced-value";
import { copyText } from "@/lib/download";
import { toast } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { skuDataService } from "@/services/skuData-service";
import { useSelector } from "@/store";
import type { ProductSku } from "@/types/sku";

const isVideoLink = (url: string): boolean => /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url);

/** TrackVid `pages/SkuData.tsx`: seller SKU → colour / size / image map with preview. */
export function SkuPage() {
  const user = useSelector((s) => s.profile.userProfile);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [preview, setPreview] = useState<ProductSku | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const searchInput = useDebouncedValue(search, 600);
  const canImport = canAccess(user, ["admin"], ["external_imports::edit"]) || canAccess(user, ["admin"], ["master_data::edit"]);

  const { data, loading, error, reload } = useAsync(
    () => skuDataService.getProductSkuData({ page, limit, searchInput, color, size }),
    [page, limit, searchInput, color, size],
  );

  const copyImageLink = async (imageLink: string) => {
    if (await copyText(imageLink)) toast.success("Image link copied to clipboard");
    else toast.error("Could not copy the link");
  };

  const emDash = (v: string) => (v ? v : <span className="tv-muted">—</span>);

  const columns: DataColumn<ProductSku>[] = [
    {
      key: "sellerSkuCode",
      header: "Seller SKU Code",
      width: 240,
      sortable: true,
      render: (r) => (r.sellerSkuCode ? <strong className="tv-mono">{r.sellerSkuCode}</strong> : <span className="tv-muted">—</span>),
    },
    { key: "color", header: "Color", width: 160, sortable: true, render: (r) => emDash(r.color) },
    { key: "size", header: "Size", width: 110, sortable: true, render: (r) => emDash(r.size) },
    {
      key: "imageLink",
      header: "Preview",
      width: 140,
      render: (r) => (
        <button type="button" className="secondary-button compact-button" disabled={r.isDeleted || !r.imageLink} onClick={() => setPreview(r)}>
          <Icon name={r.imageLink && isVideoLink(r.imageLink) ? "video-camera" : "image"} /> Preview
        </button>
      ),
    },
    { key: "createdAt", header: "Uploaded", width: 180, sortable: true, render: (r) => formatDateTime(r.createdAt) },
    {
      key: "actions",
      header: "Actions",
      width: 100,
      align: "center",
      render: (r) => (
        <button type="button" className="icon-button" title="Copy Image Link" aria-label={`Copy image link of ${r.sellerSkuCode}`} disabled={!r.imageLink} onClick={() => void copyImageLink(r.imageLink)}>
          <Icon name="copy" />
        </button>
      ),
    },
  ];

  return (
    <div className="tv-page">
      <PageHeading
        title="SKU Data"
        subtitle="Seller SKU codes with colour, size and product image used across claims."
        actions={
          canImport ? (
            <button type="button" className="primary-button" onClick={() => setImportOpen(true)}>
              <Icon name="upload" /> Upload SKU Data
            </button>
          ) : undefined
        }
      />
      <section className="glass-card tv-table-card">
        <div className="c-toolbar tv-master-toolbar">
          <SearchInput
            value={search}
            placeholder="Search SKU code..."
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
          <div className="tv-master-toolbar-actions">
            <div className="tv-master-inline-filter">
              <Combobox
                label="Color"
                placeholder="All colours"
                value={color}
                options={(data?.colors ?? []).map((c) => ({ value: c, label: c }))}
                onChange={(v) => {
                  setColor(v);
                  setPage(1);
                }}
              />
            </div>
            <div className="tv-master-inline-filter">
              <Combobox
                label="Size"
                placeholder="All sizes"
                value={size}
                options={(data?.sizes ?? []).map((s) => ({ value: s, label: s }))}
                onChange={(v) => {
                  setSize(v);
                  setPage(1);
                }}
              />
            </div>
            {color || size ? (
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => {
                  setColor("");
                  setSize("");
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
        <DataTable
          label="SKU data"
          columns={columns}
          rows={data?.order ?? []}
          getRowId={(r) => r._id}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyTitle="No SKU data found"
          emptyMessage={searchInput || color || size ? "Try another SKU code or clear the filters." : "Upload your SKU Data sheet to map seller SKUs to images."}
          pagination="server"
          page={page}
          pageSize={limit}
          pageSizes={[10, 25, 50, 100]}
          total={data?.metadata.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setLimit(s);
            setPage(1);
          }}
          storageKey="sku-data"
        />
      </section>

      {preview ? <SkuPreviewDialog row={preview} onClose={() => setPreview(null)} /> : null}
      {importOpen ? <SkuImportDialog onClose={() => setImportOpen(false)} onImported={reload} /> : null}
    </div>
  );
}

/** TrackVid `PhotoModal`: image (or product video) with its details and a copy-link action. */
function SkuPreviewDialog({ row, onClose }: { row: ProductSku; onClose: () => void }) {
  const [broken, setBroken] = useState(false);
  const video = isVideoLink(row.imageLink);
  return (
    <AppDialog
      title={row.sellerSkuCode || "Preview"}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <a className="secondary-button" href={row.imageLink} target="_blank" rel="noreferrer">
            <Icon name="external-link" /> Open original
          </a>
          <button type="button" className="primary-button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="tv-stack">
        {video ? (
          <VideoPlayer src={row.imageLink} title={`${row.sellerSkuCode} video`} />
        ) : broken ? (
          <div className="tv-sku-preview-empty">
            <Icon name="image" />
            <p>This image could not be loaded.</p>
          </div>
        ) : (
          <div className="tv-sku-preview">
            <img src={row.imageLink} alt={`Product image for ${row.sellerSkuCode}`} onError={() => setBroken(true)} />
          </div>
        )}
        <dl className="tv-kv">
          <dt>Uploaded</dt>
          <dd>{formatDateTime(row.createdAt)}</dd>
          <dt>{video ? "Video size" : "Image size"}</dt>
          <dd>{row.imageSize ?? "Unknown"}</dd>
          <dt>Colour / Size</dt>
          <dd>
            {row.color || "—"} / {row.size || "—"}
          </dd>
          <dt>File</dt>
          <dd className="tv-mono">{row.fileKey}</dd>
        </dl>
      </div>
    </AppDialog>
  );
}
