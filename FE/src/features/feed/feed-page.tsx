"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BulkSelectionBar, DataTable, type DataColumn } from "@/components/ui/data-table";
import { SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { useDismiss } from "@/components/ui/use-dismiss";
import { copyText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { useSelector } from "@/store";
import { FeedService } from "@/services/feed-service";
import type { IFeed, IFeedToggleId } from "@/types/feed";
import { FeedFormDialog } from "@/features/feed/feed-form-dialog";

async function copy(value: string, message: string) {
  if (await copyText(value)) toast.success(message);
  else toast.error("Could not copy to the clipboard.");
}

function CopyableText({ value, onCopySuccess }: { value?: string; onCopySuccess: string }) {
  if (!value) return <span className="tv-muted">—</span>;
  return (
    <span className="tv-feed-secret">
      <span className="tv-ellipsis">{value}</span>
      <button type="button" className="icon-button compact-button" title="Copy" aria-label={`Copy ${value}`} onClick={() => void copy(value, onCopySuccess)}>
        <Icon name="copy" />
      </button>
    </span>
  );
}

function SecretText({ value, visible, toggle, onCopySuccess, label }: { value?: string; visible: boolean; toggle: () => void; onCopySuccess: string; label: string }) {
  if (!value) return <span className="tv-muted">—</span>;
  return (
    <span className="tv-feed-secret">
      <span className="tv-ellipsis tv-mono">{visible ? value : "••••••••"}</span>
      <button type="button" className="icon-button compact-button" title={visible ? "Hide" : "Show"} aria-label={`${visible ? "Hide" : "Show"} ${label}`} aria-pressed={visible} onClick={toggle}>
        <Icon name={visible ? "eye-slash" : "eye"} />
      </button>
      <button type="button" className="icon-button compact-button" title="Copy" aria-label={`Copy ${label}`} onClick={() => void copy(value, onCopySuccess)}>
        <Icon name="copy" />
      </button>
    </span>
  );
}

type ColumnKey = "feedName" | "cameraType" | "feedUser" | "password" | "rtspURL" | "onvif_ip" | "onvif_username" | "onvif_password" | "createdAt" | "status";

const COLUMN_LABELS: Record<ColumnKey, string> = {
  feedName: "Feed Name",
  cameraType: "Feed Device",
  feedUser: "User",
  password: "Password",
  rtspURL: "RTSP URL",
  onvif_ip: "ONVIF IP",
  onvif_username: "ONVIF Username",
  onvif_password: "ONVIF Password",
  createdAt: "Created At",
  status: "Status",
};

/** TrackVid `columnVisibilityModel` defaults. */
const DEFAULT_VISIBLE: Record<ColumnKey, boolean> = {
  feedName: true,
  cameraType: true,
  feedUser: true,
  password: true,
  rtspURL: true,
  onvif_ip: false,
  onvif_username: false,
  onvif_password: false,
  createdAt: false,
  status: true,
};

function ColumnsMenu({ visible, onChange }: { visible: Record<ColumnKey, boolean>; onChange: (next: Record<ColumnKey, boolean>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  return (
    <div className="tv-popover-wrap" ref={ref}>
      <button type="button" className="secondary-button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Icon name="squares-four" />
        Columns
      </button>
      {open ? (
        <div className="tv-popover tv-feed-columns" role="group" aria-label="Visible columns">
          {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => (
            <label key={key} className="tv-check">
              <input
                type="checkbox"
                checked={visible[key]}
                disabled={key === "feedName"}
                onChange={(e) => onChange({ ...visible, [key]: e.currentTarget.checked })}
              />
              {COLUMN_LABELS[key]}
            </label>
          ))}
          <button type="button" className="text-link" onClick={() => onChange(DEFAULT_VISIBLE)}>
            Reset columns
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Confirm = { kind: "delete"; feeds: IFeed[] } | { kind: "toggle"; feeds: IFeed[]; enable: boolean };

const toggleIds = (feeds: readonly IFeed[]): IFeedToggleId[] => feeds.map((f) => ({ feedId: f._id, feedUserId: f.feedUser?.userId ?? "" }));

/** TrackVid `pages/Feed.tsx`: feeds with their recording-app login, add / edit, enable / disable, delete. */
export function FeedPage() {
  const me = useSelector((s) => s.profile.userProfile);
  const hasEditPermission = canAccess(me, ["admin"], ["feed::edit"]);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showPassword, setShowPassword] = useState<string[]>([]);
  const [showOnvifPassword, setShowOnvifPassword] = useState<string[]>([]);
  const [visible, setVisible] = useState<Record<ColumnKey, boolean>>(DEFAULT_VISIBLE);
  const [dialog, setDialog] = useState<{ feed: IFeed | null } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  // Debounced server search; the timer is cleared on every keystroke and on unmount.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
      setSelected(new Set());
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const list = useAsync(() => FeedService.getFeedDetail({ page, limit, search }), [page, limit, search]);
  const rows = list.data?.data ?? [];
  const total = list.data?.total ?? 0;

  const toggleIn = (setter: (fn: (prev: string[]) => string[]) => void, id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id]));

  /** Row lock button: no confirmation, same as TrackVid. */
  const toggleFeeds = async (feeds: IFeed[], enable: boolean) => {
    try {
      const res = enable ? await FeedService.enableFeed({ id: toggleIds(feeds) }) : await FeedService.disableFeed({ id: toggleIds(feeds) });
      toast.success(res.message);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "delete") {
        const res = await FeedService.deleteFeed({ id: confirm.feeds.map((f) => f._id) });
        toast.success(res.message);
        // Step back a page when the last rows of this page were removed.
        if (rows.length === confirm.feeds.length && page > 1) setPage(page - 1);
      } else {
        const res = confirm.enable ? await FeedService.enableFeed({ id: toggleIds(confirm.feeds) }) : await FeedService.disableFeed({ id: toggleIds(confirm.feeds) });
        toast.success(res.message);
      }
      setSelected(new Set());
      setConfirm(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: DataColumn<IFeed>[] = [
    { key: "feedName", header: "Feed Name", minWidth: 160, render: (f) => <strong>{f.feedName}</strong> },
    { key: "cameraType", header: "Feed Device", width: 120, hidden: !visible.cameraType, render: (f) => (f.cameraType === "web_cam" ? "Web Cam" : "RTSP") },
    {
      key: "feedUser",
      header: "User",
      minWidth: 180,
      hidden: !visible.feedUser,
      render: (f) => <CopyableText value={f.feedUser?.userId} onCopySuccess="User ID copied" />,
    },
    {
      key: "password",
      header: "Password",
      minWidth: 170,
      hidden: !visible.password,
      render: (f) => (
        <SecretText
          label={`password for ${f.feedName}`}
          value={f.feedUser?.password}
          visible={showPassword.includes(f._id)}
          toggle={() => toggleIn(setShowPassword, f._id)}
          onCopySuccess="Password copied"
        />
      ),
    },
    {
      key: "rtspURL",
      header: "RTSP URL",
      minWidth: 220,
      hidden: !visible.rtspURL,
      render: (f) => (f.cameraType === "rtsp" && f.rtspURL ? <span className="tv-ellipsis tv-mono" title={f.rtspURL}>{f.rtspURL}</span> : "—"),
    },
    { key: "onvif_ip", header: "ONVIF IP", width: 130, hidden: !visible.onvif_ip, render: (f) => f.onvif_ip || "—" },
    {
      key: "onvif_username",
      header: "ONVIF Username",
      minWidth: 150,
      hidden: !visible.onvif_username,
      render: (f) => <CopyableText value={f.onvif_username} onCopySuccess="ONVIF username copied" />,
    },
    {
      key: "onvif_password",
      header: "ONVIF Password",
      minWidth: 170,
      hidden: !visible.onvif_password,
      render: (f) => (
        <SecretText
          label={`ONVIF password for ${f.feedName}`}
          value={f.onvif_password}
          visible={showOnvifPassword.includes(f._id)}
          toggle={() => toggleIn(setShowOnvifPassword, f._id)}
          onCopySuccess="ONVIF password copied"
        />
      ),
    },
    { key: "createdAt", header: "Created At", width: 120, hidden: !visible.createdAt, render: (f) => formatDate(f.createdAt, "dd/MM/yyyy") },
    { key: "status", header: "Status", width: 110, hidden: !visible.status, render: (f) => <StatusPill value={f.isDisable ? "Inactive" : "Active"} tone={f.isDisable ? "red" : "green"} /> },
    {
      key: "actions",
      header: "Actions",
      width: 130,
      align: "right",
      hidden: !hasEditPermission,
      render: (f) => (
        <span className="tv-feed-actions">
          <button
            type="button"
            className="icon-button compact-button"
            title={f.isDisable ? "Enable" : "Disable"}
            aria-label={`${f.isDisable ? "Enable" : "Disable"} ${f.feedName}`}
            onClick={() => void toggleFeeds([f], f.isDisable)}
          >
            <Icon name={f.isDisable ? "lock" : "key"} />
          </button>
          <RowActionsMenu
            label={`More actions for ${f.feedName}`}
            actions={[
              { label: "Edit", icon: "pencil", onClick: () => setDialog({ feed: f }) },
              { label: "Delete", icon: "trash", danger: true, separatorBefore: true, onClick: () => setConfirm({ kind: "delete", feeds: [f] }) },
            ]}
          />
        </span>
      ),
    },
  ];

  const selectedFeeds = rows.filter((f) => selected.has(f._id));

  return (
    <div className="tv-page">
      <PageHeading
        title="Feed"
        subtitle={`${total} ${total === 1 ? "feed" : "feeds"} · each feed has its own login for the TrackVid recording app.`}
        actions={
          hasEditPermission ? (
            <button type="button" className="primary-button" onClick={() => setDialog({ feed: null })}>
              <Icon name="plus" />
              Add Feed
            </button>
          ) : null
        }
      />
      <section className="glass-card tv-table-card">
        <div className="c-toolbar">
          <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Search feed or user" label="Search feeds" />
          <span className="tv-feed-toolbar-end">
            <button type="button" className="icon-button" title="Refresh" aria-label="Refresh feeds" onClick={list.reload}>
              <Icon name="refresh" />
            </button>
            <ColumnsMenu visible={visible} onChange={setVisible} />
          </span>
        </div>
        <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={!selectedFeeds.some((f) => f.isDisable)}
            onClick={() => setConfirm({ kind: "toggle", enable: true, feeds: selectedFeeds.filter((f) => f.isDisable) })}
          >
            <Icon name="lock" />
            Enable
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={!selectedFeeds.some((f) => !f.isDisable)}
            onClick={() => setConfirm({ kind: "toggle", enable: false, feeds: selectedFeeds.filter((f) => !f.isDisable) })}
          >
            <Icon name="key" />
            Disable
          </button>
          <button type="button" className="danger-button compact-button" onClick={() => setConfirm({ kind: "delete", feeds: selectedFeeds })}>
            <Icon name="trash" />
            Delete
          </button>
        </BulkSelectionBar>
        <DataTable
          label="Feeds"
          columns={columns}
          rows={rows}
          getRowId={(f) => f._id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          emptyTitle={search ? "No matching feeds" : "No feeds yet"}
          emptyMessage={search ? "Try another feed name or user." : hasEditPermission ? "Add a feed for each camera or packing station." : "Your admin has not added any feeds."}
          rowClassName={(f) => (f.isDisable ? "tv-feed-row-disabled" : "")}
          selected={hasEditPermission ? selected : undefined}
          onSelectedChange={hasEditPermission ? setSelected : undefined}
          pagination="server"
          page={page}
          pageSize={limit}
          total={total}
          onPageChange={(p) => {
            setPage(p);
            setSelected(new Set());
          }}
          onPageSizeChange={(s) => {
            setLimit(s);
            setPage(1);
            setSelected(new Set());
          }}
          storageKey="feed"
        />
      </section>

      {dialog && hasEditPermission ? <FeedFormDialog feed={dialog.feed} onClose={() => setDialog(null)} onSaved={list.reload} /> : null}

      {confirm?.kind === "delete" ? (
        <ConfirmDialog
          title={confirm.feeds.length === 1 ? "Delete Feed" : "Delete Feeds"}
          message={
            confirm.feeds.length === 1
              ? `Delete "${confirm.feeds[0].feedName}"? Its recording-app login stops working. Videos already recorded stay in VMS.`
              : `Delete ${confirm.feeds.length} feeds? Their recording-app logins stop working. Videos already recorded stay in VMS.`
          }
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={runConfirm}
          onClose={() => setConfirm(null)}
        />
      ) : null}

      {confirm?.kind === "toggle" ? (
        <ConfirmDialog
          title={confirm.enable ? "Enable Feeds" : "Disable Feeds"}
          message={`${confirm.enable ? "Enable" : "Disable"} ${confirm.feeds.length} ${confirm.feeds.length === 1 ? "feed" : "feeds"}?${confirm.enable ? "" : " Disabled feeds cannot record until enabled again."}`}
          confirmLabel={confirm.enable ? "Enable" : "Disable"}
          danger={!confirm.enable}
          busy={busy}
          onConfirm={runConfirm}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}
