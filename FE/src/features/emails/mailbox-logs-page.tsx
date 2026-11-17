"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { ToneBadge } from "@/components/ui/card-primitives";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { Spinner } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import ROUTE_URLS from "@/config/route";
import { formatDate } from "@/lib/format";
import { useAsync } from "@/lib/use-async";
import { MailboxService } from "@/services/mailbox-service";
import type { MailboxLogEntry } from "@/types/emails";
import { renderMetaValue } from "./email-helpers";

/** TrackVid `pages/MailboxLogsPage.tsx` (route `/mailboxes/:mailboxId/logs`). */

const LOG_TYPE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Activity", value: "activity" },
  { label: "Error", value: "error" },
] as const;
type TypeFilter = (typeof LOG_TYPE_OPTIONS)[number]["value"];

const stringifyMetadata = (metadata?: Record<string, unknown>): string => {
  if (!metadata || Object.keys(metadata).length === 0) return "No metadata";
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    // Circular metadata cannot be printed as JSON.
    return "Unable to render metadata";
  }
};

const buildMetadataPreview = (metadata?: Record<string, unknown>): string => {
  if (!metadata || Object.keys(metadata).length === 0) return "No metadata";
  return Object.entries(metadata)
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${renderMetaValue(value)}`)
    .join(", ");
};

type LogRow = MailboxLogEntry & { rowId: string };

export function MailboxLogsPage() {
  const params = useParams<{ mailboxId: string }>();
  const mailboxId = typeof params?.mailboxId === "string" ? params.mailboxId : "";
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [eventInput, setEventInput] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [metadataDialog, setMetadataDialog] = useState<{ title: string; metadata: string } | null>(null);

  // Debounce the event search (400 ms) and go back to page 1 when it settles.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = eventInput.trim();
      if (next !== eventFilter) {
        setEventFilter(next);
        setPage(1);
      }
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [eventInput, eventFilter]);

  const logs = useAsync(() => {
    if (!mailboxId) return Promise.reject(new Error("Mailbox identifier is missing."));
    return MailboxService.getMailboxLogs(mailboxId, {
      page,
      pageSize: limit,
      type: typeFilter === "all" ? undefined : typeFilter,
      event: eventFilter || undefined,
    });
  }, [mailboxId, page, limit, typeFilter, eventFilter]);

  const mailboxes = useAsync(() => MailboxService.listMailboxes(), []);
  const mailbox = mailboxes.data?.mailboxes.find((m) => m._id === mailboxId);

  const rows: LogRow[] = (logs.data?.data ?? []).map((log, index) => {
    const id = log.id || log._id;
    return { ...log, rowId: id && String(id).trim() !== "" ? String(id) : `log-${index}-${log.createdAt || index}` };
  });
  const totalItems = logs.data?.pagination.totalItems ?? logs.data?.data.length ?? 0;
  const filtersApplied = typeFilter !== "all" || eventFilter.length > 0;

  const columns: DataColumn<LogRow>[] = [
    {
      key: "createdAt",
      header: "Timestamp",
      width: 210,
      render: (r) => <strong className="tv-small">{formatDate(r.createdAt, "PPpp")}</strong>,
    },
    {
      key: "type",
      header: "Type",
      width: 110,
      render: (r) => <StatusPill value={r.type} tone={r.type === "error" ? "red" : "green"} />,
    },
    {
      key: "event",
      header: "Event",
      width: 200,
      render: (r) => <span className="tv-mono">{r.event || "—"}</span>,
    },
    {
      key: "message",
      header: "Message",
      width: 320,
      wrap: true,
      render: (r) => r.message || "—",
    },
    {
      key: "metadata",
      header: "Metadata",
      width: 300,
      render: (r) => {
        const preview = buildMetadataPreview(r.metadata);
        const full = stringifyMetadata(r.metadata);
        const hasMetadata = full !== "No metadata";
        return (
          <div className="tv-emails-meta-cell">
            <span className={`tv-ellipsis ${hasMetadata ? "tv-mono" : "tv-muted"}`}>{preview}</span>
            {hasMetadata ? (
              <button
                type="button"
                className="icon-button compact-button"
                title="View full metadata"
                aria-label={`View full metadata for ${r.event}`}
                onClick={() => setMetadataDialog({ title: r.event || "Metadata", metadata: full })}
              >
                <Icon name="eye" />
              </button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="tv-page tv-emails">
      <PageHeading
        title="Mailbox Logs"
        crumbs={[{ label: "AJIO Emails", href: `${ROUTE_URLS.EMAILS}?tab=mailboxes` }]}
        subtitle={
          <>
            Activity and error events for this connected mailbox
            {mailbox ? (
              <>
                {" — "}
                <strong>{mailbox.email}</strong>
              </>
            ) : null}
            .
          </>
        }
        actions={
          <>
            <Link className="secondary-button" href={`${ROUTE_URLS.SETTINGS}?tab=integrations`} title="Back to AJIO Email Auto Reply">
              <Icon name="arrow-left" />
              Back
            </Link>
            <button type="button" className="secondary-button" onClick={() => logs.reload()} disabled={logs.loading}>
              <Icon name="refresh" />
              Refresh
            </button>
          </>
        }
      />

      <section className="glass-card tv-table-card" aria-label="Mailbox logs">
        <div className="c-toolbar tv-emails-toolbar">
          <div className="tv-row">
            <div className="tv-emails-segment" role="radiogroup" aria-label="Log type">
              {LOG_TYPE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={typeFilter === value}
                  className={typeFilter === value ? "is-active" : undefined}
                  onClick={() => {
                    if (value === typeFilter) return;
                    setTypeFilter(value);
                    setPage(1);
                  }}
                >
                  <span className={`tv-emails-seg-dot is-${value}`} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {filtersApplied ? <ToneBadge label="Filtered" tone="amber" /> : null}
          </div>
          <SearchInput value={eventInput} onChange={setEventInput} placeholder="Search event…" label="Search event" />
          <span className="tv-muted tv-small tv-emails-count">
            {logs.loading && rows.length === 0 ? <Spinner /> : null}
            Showing <strong>{rows.length}</strong> of <strong>{totalItems}</strong> entries
          </span>
        </div>

        <DataTable<LogRow>
          label="Mailbox log entries"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.rowId}
          loading={logs.loading}
          error={logs.error}
          onRetry={logs.reload}
          emptyTitle="No log entries"
          emptyMessage={filtersApplied ? "No entries match the selected filters." : "This mailbox has no activity yet."}
          pagination="server"
          page={page}
          pageSize={limit}
          total={totalItems}
          pageSizes={[10, 25, 50, 100]}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setLimit(s);
            setPage(1);
          }}
          storageKey="mailbox-logs"
        />
      </section>

      {metadataDialog ? (
        <AppDialog
          title={
            <span className="tv-emails-dialog-title">
              {metadataDialog.title || "Metadata"}
              <small>Full event payload (JSON)</small>
            </span>
          }
          size="wide"
          onClose={() => setMetadataDialog(null)}
          footer={
            <button type="button" className="secondary-button" onClick={() => setMetadataDialog(null)}>
              Close
            </button>
          }
        >
          <pre className="tv-emails-json">{metadataDialog.metadata}</pre>
        </AppDialog>
      ) : null}
    </div>
  );
}
