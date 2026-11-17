"use client";

import { endOfDay, format, startOfDay } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BulkSelectionBar } from "@/components/ui/data-table";
import { DateRangePicker, type DateRange } from "@/components/ui/date-range-picker";
import { FilterSelect, SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { TablePagination } from "@/components/ui/table-pagination";
import { Tabs } from "@/components/ui/tabs";
import { useDismiss } from "@/components/ui/use-dismiss";
import ROUTE_URLS from "@/config/route";
import { downloadBlob } from "@/lib/download";
import { toast } from "@/lib/events";
import { formatDate, formatRelative } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { EmailAutomationService } from "@/services/email-automation-service";
import { MailboxService } from "@/services/mailbox-service";
import { useSelector } from "@/store";
import type { EmailDetailsResponse, EmailListByStatusParams, EmailRow, EmailStatusFilter, Mailbox } from "@/types/emails";
import { EmailHtml } from "./email-html";
import {
  PAGE_SIZE,
  PAGE_SIZES,
  RETRY_BULK_MAX,
  formatDateWithTimezone,
  getUserTimezone,
  initialPendingRange,
  initialRepliedRange,
  isFixableFailure,
  renderMetaValue,
  retriesExhausted,
  statusLabels,
  statusTones,
} from "./email-helpers";
import { MailboxManager } from "./mailbox-manager";
import { AddAwbDialog, AddVideoLinkDialog } from "./manual-fix-dialogs";

/**
 * TrackVid `components/email/EmailInbox.tsx` (route `/emails`, page title "AJIO Emails"): Pending /
 * Replied tabs with counts, date + mailbox filters, search, expandable conversation rows, reply /
 * retry / force reply / mark manual reply, bulk retry of failed rows, export and the manual fixes.
 * `?tab=mailboxes` opens the connected-mailbox manager (target of the shell's "Reconnect email").
 */

type View = EmailStatusFilter | "mailboxes";

const parseView = (value: string | null): View => (value === "replied" || value === "mailboxes" ? value : "pending");

type Details = Pick<EmailDetailsResponse, "body" | "bodyRaw" | "meta" | "replyDetail">;

export function EmailInbox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const user = useSelector((s) => s.profile.userProfile);
  const hasEditPermission = canAccess(user, ["admin"], ["email::edit"]);

  const [view, setView] = useState<View>(() => parseView(tabParam));
  const [prevTabParam, setPrevTabParam] = useState(tabParam);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [manualReplyingId, setManualReplyingId] = useState<string | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState("all");
  const [pendingRange, setPendingRange] = useState<DateRange>(initialPendingRange);
  const [repliedRange, setRepliedRange] = useState<DateRange>(initialRepliedRange);
  const [pendingPage, setPendingPage] = useState(1);
  const [repliedPage, setRepliedPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [fixDialog, setFixDialog] = useState<{ type: "awb" | "video"; emailId: string } | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, Details>>({});
  const [detailsLoading, setDetailsLoading] = useState<Record<string, boolean>>({});

  const resetForView = (next: View) => {
    setView(next);
    setSelectedIds(new Set());
    setExpandedIds([]);
    if (next === "pending") setPendingRange(initialPendingRange());
    if (next === "replied") setRepliedRange(initialRepliedRange());
    setPendingPage(1);
    setRepliedPage(1);
  };

  // The URL can change from outside (e.g. the shell's "Reconnect email" → ?tab=mailboxes).
  if (tabParam !== prevTabParam) {
    setPrevTabParam(tabParam);
    if (parseView(tabParam) !== view) resetForView(parseView(tabParam));
  }

  const switchTab = (next: View) => {
    if (next === view) return;
    // The URL catches up on the next render; `prevTabParam` then sees a tab that already matches `view`.
    resetForView(next);
    router.push(`${ROUTE_URLS.EMAILS}?${new URLSearchParams({ tab: next }).toString()}`);
  };

  const status: EmailStatusFilter = view === "replied" ? "replied" : "pending";
  const range = status === "pending" ? pendingRange : repliedRange;
  const currentPage = status === "pending" ? pendingPage : repliedPage;
  const setCurrentPage = status === "pending" ? setPendingPage : setRepliedPage;
  const mailboxParam = selectedMailboxId === "all" ? undefined : selectedMailboxId;
  const startDate = formatDateWithTimezone(range.startDate);
  const endDate = formatDateWithTimezone(range.endDate);
  const pStart = formatDateWithTimezone(pendingRange.startDate);
  const pEnd = formatDateWithTimezone(pendingRange.endDate);
  const rStart = formatDateWithTimezone(repliedRange.startDate);
  const rEnd = formatDateWithTimezone(repliedRange.endDate);

  const listParams: EmailListByStatusParams = { status, page: currentPage, pageSize: limit, mailboxId: mailboxParam, startDate, endDate, timezone: getUserTimezone() };
  const list = useAsync(() => EmailAutomationService.listEmailsByStatus(listParams), [status, currentPage, limit, mailboxParam, startDate, endDate]);
  const counts = useAsync(
    () =>
      EmailAutomationService.getEmailCounts({
        mailboxId: mailboxParam,
        pendingStartDate: pStart,
        pendingEndDate: pEnd,
        repliedStartDate: rStart,
        repliedEndDate: rEnd,
        timezone: getUserTimezone(),
      }),
    [mailboxParam, pStart, pEnd, rStart, rEnd],
  );
  const mailboxesRes = useAsync(() => MailboxService.listMailboxes(), []);
  const mailboxes: Mailbox[] = mailboxesRes.data?.mailboxes ?? [];
  const mailboxMap = new Map(mailboxes.map((m) => [m._id, m]));

  // A page that became empty (rows replied / removed) moves back one page, like TrackVid.
  const section = list.data;
  if (!list.loading && section && section.page === currentPage && section.items.length === 0 && currentPage > 1) {
    setCurrentPage(currentPage - 1);
  }

  const reloadAll = () => {
    list.reload();
    counts.reload();
  };

  // Live updates (TrackVid listens to socket.io `emails:*:update`): refetch quietly, keep the page.
  const silentRefreshRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    silentRefreshRef.current = () => {
      const params = listParams;
      EmailAutomationService.listEmailsByStatus(params)
        .then((res) => list.setData(res))
        .catch(() => {
          // A failed background refresh keeps the rows on screen; the next update retries.
        });
      counts.reload();
    };
  });
  useEffect(() => EmailAutomationService.subscribeEmailUpdates(() => silentRefreshRef.current()), []);

  const exportRef = useRef<HTMLDivElement>(null);
  const closeExport = useCallback(() => setExportOpen(false), []);
  useDismiss(exportOpen, exportRef, closeExport);

  const rows = section?.items ?? [];
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredRows = normalizedSearch
    ? rows.filter((r) => [r.subject, r.sender?.email ?? "", r.sender?.name ?? "", r.snippet ?? ""].join(" ").toLowerCase().includes(normalizedSearch))
    : rows;
  const totalRow = section?.total ?? 0;
  const totalPages = totalRow > 0 ? Math.ceil(totalRow / limit) : 1;
  const hasSearchTerm = normalizedSearch.length > 0;
  const loading = list.loading;

  // ─── Row details (lazy) ──────────────────────────────────────────────────
  const fetchDetails = (emailId: string) => {
    if (detailsCache[emailId] || detailsLoading[emailId]) return;
    setDetailsLoading((p) => ({ ...p, [emailId]: true }));
    EmailAutomationService.getEmailDetails(emailId)
      .then((d) => setDetailsCache((p) => ({ ...p, [emailId]: { body: d.body, bodyRaw: d.bodyRaw, meta: d.meta, replyDetail: d.replyDetail } })))
      .catch(() => toast.error("Failed to load email body"))
      .finally(() => setDetailsLoading((p) => ({ ...p, [emailId]: false })));
  };

  const toggleExpanded = (emailId: string) => {
    const expanding = !expandedIds.includes(emailId);
    if (expanding) fetchDetails(emailId);
    setExpandedIds((prev) => (expanding ? [...prev, emailId] : prev.filter((id) => id !== emailId)));
  };

  // ─── Actions ─────────────────────────────────────────────────────────────
  const afterReplied = () => {
    if (view === "replied") {
      setRepliedPage(1);
      reloadAll();
    } else switchTab("replied");
  };

  const handleReply = async (emailId: string) => {
    if (replyingId) return;
    setReplyingId(emailId);
    try {
      await EmailAutomationService.replyToEmail(emailId);
      toast.success("Reply sent");
      afterReplied();
    } catch {
      // The service already stored the failure on the row; refresh so it shows the new reason.
      toast.error("Failed to send reply");
      reloadAll();
    } finally {
      setReplyingId(null);
    }
  };

  const handleForceReply = async (emailId: string) => {
    if (replyingId) return;
    setReplyingId(emailId);
    try {
      await EmailAutomationService.forceReplyToEmail(emailId);
      toast.success("Reply sent");
      afterReplied();
    } catch {
      // Message is generic in TrackVid too; details live in the mailbox logs.
      toast.error("Failed to send reply");
    } finally {
      setReplyingId(null);
    }
  };

  const handleManualReply = async (emailId: string) => {
    if (manualReplyingId) return;
    setManualReplyingId(emailId);
    try {
      await EmailAutomationService.markManualReply(emailId);
      toast.success("Marked as manually replied");
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(emailId);
        return next;
      });
    } catch {
      // Refetch below reverts any optimistic change.
      toast.error("Failed to mark as manually replied");
    } finally {
      setManualReplyingId(null);
      reloadAll();
    }
  };

  const handleRefresh = () => {
    setCurrentPage(1);
    setExpandedIds([]);
    reloadAll();
  };

  const toggleEmailSelected = (email: EmailRow) => {
    if (email.status !== "error") return;
    const next = new Set(selectedIds);
    if (next.has(email._id)) next.delete(email._id);
    else if (next.size < RETRY_BULK_MAX) next.add(email._id);
    else {
      toast.error(`Max ${RETRY_BULK_MAX} emails per retry`);
      return;
    }
    setSelectedIds(next);
  };

  const errorRowsOnPage = filteredRows.filter((r) => r.status === "error");
  const selectedOnPage = errorRowsOnPage.filter((r) => selectedIds.has(r._id)).length;
  const allSelected = errorRowsOnPage.length > 0 && selectedOnPage === errorRowsOnPage.length;
  const someSelected = selectedOnPage > 0 && selectedOnPage < errorRowsOnPage.length;

  const toggleSelectAllOnPage = (checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) {
      for (const r of errorRowsOnPage) {
        if (next.size >= RETRY_BULK_MAX) break;
        next.add(r._id);
      }
    } else for (const r of errorRowsOnPage) next.delete(r._id);
    setSelectedIds(next);
  };

  const handleBulkRetry = async () => {
    if (selectedIds.size === 0) return;
    setBulkRetrying(true);
    try {
      const data = await EmailAutomationService.retryBulkEmails(Array.from(selectedIds));
      const parts: string[] = [];
      if (data.enqueued > 0) parts.push(`${data.enqueued} queued`);
      if (data.skipped > 0) {
        const reasons = Object.entries(data.breakdown)
          .map(([reason, count]) => `${count} ${reason.replace(/_/g, " ")}`)
          .join(", ");
        parts.push(`${data.skipped} skipped (${reasons})`);
      }
      const msg = parts.join(" · ") || "No emails processed";
      if (data.enqueued > 0) toast.success(msg);
      else toast.error(msg);
      setSelectedIds(new Set());
      reloadAll();
    } catch {
      // Nothing was queued; the selection stays so the user can try again.
      toast.error("Failed to retry emails");
    } finally {
      setBulkRetrying(false);
      setRetryDialogOpen(false);
    }
  };

  const handleExport = async (scope: "page" | "all") => {
    setExportOpen(false);
    try {
      setExporting(true);
      const blob = await EmailAutomationService.exportEmails({
        status,
        mailboxId: mailboxParam,
        startDate,
        endDate,
        timezone: getUserTimezone(),
        scope,
        page: scope === "page" ? currentPage : undefined,
        pageSize: scope === "page" ? limit : undefined,
      });
      const scopeLabel = scope === "page" ? `page${currentPage}` : "all";
      downloadBlob(blob, `ajio-emails-${status}-${scopeLabel}-${format(new Date(), "yyyy-MM-dd")}.csv`);
      toast.success("Export downloaded");
    } catch {
      // Export is all-or-nothing; tell the user and keep the screen as is.
      toast.error("Failed to export emails");
    } finally {
      setExporting(false);
    }
  };

  const handleManualFixDone = () => {
    // Stay on Pending: a fixed row leaves the list on refetch; one whose send failed stays with its new reason.
    setSelectedIds(new Set());
    reloadAll();
  };

  const goToPage = (raw: string) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 1) return;
    const target = Math.min(n, totalPages);
    if (target !== currentPage) {
      setExpandedIds([]);
      setCurrentPage(target);
    }
  };

  const mailboxOptions = [
    { value: "all", label: "All Mailboxes" },
    ...mailboxes.map((mb) => ({ value: mb._id, label: `${mb.displayName ?? mb.email} (${mb.email})` })),
  ];
  const pageCount = Math.min(limit, Math.max(0, totalRow - (currentPage - 1) * limit));
  const isPending = status === "pending";
  const colCount = isPending ? 9 : 7;

  // ─── Table body ──────────────────────────────────────────────────────────
  let tbody: ReactNode;
  if (loading && !section) {
    tbody = Array.from({ length: 6 }, (_, i) => (
      <tr key={`sk-${i}`} className="tv-table-loading">
        {Array.from({ length: colCount }, (__, c) => (
          <td key={c}>
            <Skeleton width={`${50 + ((i * 13 + c * 7) % 45)}%`} />
          </td>
        ))}
      </tr>
    ));
  } else if (list.error) {
    tbody = (
      <tr>
        <td colSpan={colCount}>
          <ErrorState message={list.error} onRetry={list.reload} title="Failed to load emails" />
        </td>
      </tr>
    );
  } else if (filteredRows.length === 0) {
    tbody = (
      <tr>
        <td colSpan={colCount}>
          <EmptyState icon="envelope" title={searchTerm ? "No emails match the selected filters." : "No emails available yet."} />
        </td>
      </tr>
    );
  } else {
    tbody = filteredRows.map((email) => {
      const expanded = expandedIds.includes(email._id);
      const cached = detailsCache[email._id];
      const isDetailsLoading = detailsLoading[email._id] === true;
      const meta = cached?.meta ?? email.meta;
      const receivedBodyHtml = (cached?.bodyRaw ?? email.bodyRaw)?.trim() || (cached?.body ?? email.body)?.trim() || "";
      const replyBodyHtml =
        (cached?.replyDetail?.bodyRaw ?? email.replyDetail?.bodyRaw)?.trim() || (cached?.replyDetail?.body ?? email.replyDetail?.body)?.trim() || "";
      const replySubject = email.replyDetail?.subject;
      const replyTo = email.replyDetail?.to ?? "";
      const replyCc = email.replyDetail?.cc ?? "";
      const repliedAt = email.replyDetail?.repliedAt;
      const metaHeader = meta?.header as { date?: string } | undefined;
      const receivedDate = metaHeader?.date || email.receivedAt;
      const errorTooltip =
        email.status === "error"
          ? email.replyDetail?.errorMessage ||
            renderMetaValue((meta?.error as string | undefined) ?? (meta?.message as string | undefined) ?? "Reply failed. Please retry.")
          : null;
      const mailbox = email.mailboxId ? mailboxMap.get(email.mailboxId) : undefined;
      const fixable = email.status === "error" && hasEditPermission && isFixableFailure(email.replyDetail?.errorCode, email.replyDetail?.errorMessage);
      const canSend = isPending && email.status !== "replied" && email.status !== "manually_replied";
      const sending = replyingId === email._id;
      const marking = manualReplyingId === email._id;

      return (
        <Fragment key={email._id}>
          <tr className={`${selectedIds.has(email._id) ? "is-selected" : ""} ${expanded ? "tv-emails-row-open" : ""}`.trim() || undefined}>
            {isPending ? (
              <td className="c-check">
                <input
                  type="checkbox"
                  checked={selectedIds.has(email._id)}
                  disabled={email.status !== "error"}
                  title={email.status === "error" ? undefined : "Only failed emails can be retried"}
                  aria-label={`Select ${email.subject}`}
                  onChange={() => toggleEmailSelected(email)}
                />
              </td>
            ) : null}
            <td className="tv-cell-wrap">
              <strong className="tv-emails-subject">{email.subject}</strong>
            </td>
            <td>
              <div className="tv-emails-two-line">
                <strong className="tv-ellipsis">{email.sender.name || email.sender.email}</strong>
                <small className="tv-ellipsis">{email.sender.email}</small>
              </div>
            </td>
            <td>
              {mailbox ? (
                <div className="tv-emails-two-line">
                  <strong className="tv-ellipsis">{mailbox.displayName || mailbox.email}</strong>
                  <small className="tv-ellipsis">{mailbox.email}</small>
                </div>
              ) : (
                <span className="tv-muted">—</span>
              )}
            </td>
            <td>
              <span title={errorTooltip ?? undefined} className={errorTooltip ? "tv-emails-has-tip" : undefined}>
                <StatusPill value={statusLabels[email.status]} tone={statusTones[email.status]} />
              </span>
            </td>
            {isPending ? (
              <td>
                {fixable ? (
                  <div className="tv-emails-fix">
                    <button type="button" className="secondary-button compact-button" onClick={() => setFixDialog({ type: "awb", emailId: email._id })}>
                      Add AWB
                    </button>
                    <button type="button" className="secondary-button compact-button" onClick={() => setFixDialog({ type: "video", emailId: email._id })}>
                      Add video link
                    </button>
                    {email.manualFix ? (
                      <small className="tv-muted">{email.manualFix.type === "awb" ? `AWB ${email.manualFix.awb} linked` : "Video link added"}</small>
                    ) : null}
                  </div>
                ) : (
                  <span className="tv-muted">—</span>
                )}
              </td>
            ) : null}
            <td>
              <div className="tv-emails-two-line">
                <span>{formatDate(receivedDate, "PPpp")}</span>
                <small>{formatRelative(receivedDate)}</small>
              </div>
            </td>
            <td>
              {email.ajioAcknowledgementReplied === true ? (
                <span className="tv-emails-ack" title="Ajio acknowledged" role="img" aria-label="Ajio acknowledged">
                  <Icon name="check-circle" />
                </span>
              ) : (
                <span className="tv-muted">—</span>
              )}
            </td>
            <td style={{ textAlign: "right" }}>
              <div className="tv-emails-actions">
                {canSend ? (
                  <>
                    {!(email.status === "error" && retriesExhausted(email)) ? (
                      <button
                        type="button"
                        className="icon-button"
                        title={!hasEditPermission ? "You don't have permission to send replies" : sending ? "Sending…" : email.status === "error" ? "Retry reply" : "Send reply"}
                        aria-label={email.status === "error" ? "Retry reply" : "Send reply"}
                        disabled={!hasEditPermission || sending || !mailbox?.email}
                        onClick={() => void handleReply(email._id)}
                      >
                        {sending ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name={email.status === "error" ? "refresh" : "paper-plane"} />}
                      </button>
                    ) : null}
                    {email.status === "error" || email.status === "fetched" ? (
                      <button
                        type="button"
                        className="icon-button tv-emails-ok"
                        title={
                          !hasEditPermission
                            ? "You don't have permission to mark emails as replied"
                            : marking
                              ? "Marking…"
                              : email.status === "fetched"
                                ? "Mark as reply"
                                : "Mark manually replied"
                        }
                        aria-label={email.status === "fetched" ? "Mark as reply" : "Mark manually replied"}
                        disabled={!hasEditPermission || marking}
                        onClick={() => void handleManualReply(email._id)}
                      >
                        {marking ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="check" />}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <span
                    className="tv-emails-ack is-muted"
                    title={email.status === "manually_replied" ? "Manually replied" : "Reply sent"}
                    role="img"
                    aria-label={email.status === "manually_replied" ? "Manually replied" : "Reply sent"}
                  >
                    <Icon name="check-circle" />
                  </span>
                )}
                {email.status === "replied" && hasEditPermission ? (
                  <button
                    type="button"
                    className="icon-button"
                    title="Send reply again"
                    aria-label="Send reply again"
                    disabled={sending}
                    onClick={() => void handleForceReply(email._id)}
                  >
                    {sending ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="paper-plane" />}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="icon-button"
                  aria-expanded={expanded}
                  aria-label={expanded ? "Hide conversation" : "Show conversation"}
                  title={expanded ? "Hide conversation" : "Show conversation"}
                  onClick={() => toggleExpanded(email._id)}
                >
                  <Icon name={expanded ? "caret-up" : "caret-down"} />
                </button>
              </div>
            </td>
          </tr>
          {expanded ? (
            <tr className="tv-emails-detail-row">
              <td colSpan={colCount}>
                <div className="tv-emails-conversation">
                  <h3 className="tv-card-title">
                    Conversation {isDetailsLoading ? <span className="tv-spinner small" aria-label="Loading email" /> : null}
                  </h3>
                  <div className="tv-grid-2 tv-emails-panels">
                    <article className="tv-emails-panel" aria-label="Received email">
                      <h4>Received email</h4>
                      <small className="tv-muted">{formatDate(receivedDate, "PPpp")}</small>
                      <p className="tv-strong">{email.subject}</p>
                      {receivedBodyHtml ? <EmailHtml html={receivedBodyHtml} /> : <p className="tv-muted">No email body available.</p>}
                    </article>
                    <article className="tv-emails-panel" aria-label="Reply">
                      <h4>Reply</h4>
                      {replyTo ? <small className="tv-muted">To: {replyTo}</small> : null}
                      {replyCc ? <small className="tv-muted">CC: {replyCc}</small> : null}
                      {repliedAt ? <small className="tv-muted">{formatDate(repliedAt, "PPpp")}</small> : null}
                      {replySubject ? <p className="tv-strong">{replySubject}</p> : null}
                      {replyBodyHtml ? <EmailHtml html={replyBodyHtml} /> : <p className="tv-muted">No reply content captured yet.</p>}
                    </article>
                  </div>
                </div>
              </td>
            </tr>
          ) : null}
        </Fragment>
      );
    });
  }

  const pendingCount = counts.data?.pending.total ?? 0;
  const repliedCount = counts.data?.replied.total ?? 0;

  return (
    <div className="tv-page tv-emails">
      <PageHeading
        title="AJIO Emails"
        subtitle="AJIO claim emails fetched from your connected mailboxes and the auto replies sent for them."
        actions={
          view === "mailboxes" ? null : (
            <>
              <button type="button" className="secondary-button" onClick={handleRefresh} disabled={loading}>
                <Icon name="refresh" />
                Refresh
              </button>
              <div className="tv-popover-wrap" ref={exportRef}>
                <button
                  type="button"
                  className="primary-button"
                  aria-haspopup="menu"
                  aria-expanded={exportOpen}
                  disabled={exporting || loading}
                  onClick={() => setExportOpen((o) => !o)}
                >
                  {exporting ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="download" />}
                  {exporting ? "Exporting..." : "Export"}
                </button>
                {exportOpen ? (
                  <div className="tv-popover" role="menu">
                    <div className="tv-menu-list">
                      <button type="button" role="menuitem" disabled={exporting} onClick={() => void handleExport("page")}>
                        <Icon name="file-text" />
                        Page Emails ({pageCount})
                      </button>
                      <button type="button" role="menuitem" disabled={exporting} onClick={() => void handleExport("all")}>
                        <Icon name="database" />
                        All Emails ({totalRow})
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )
        }
      />

      <Tabs<View>
        label="Email views"
        value={view}
        onChange={switchTab}
        items={[
          { key: "pending", label: "Pending", icon: "timer", count: pendingCount },
          { key: "replied", label: "Replied", icon: "paper-plane", count: repliedCount },
          { key: "mailboxes", label: "Mailboxes", icon: "envelope" },
        ]}
      />

      {view === "mailboxes" ? (
        <MailboxManager
          onChanged={() => {
            mailboxesRes.reload();
            reloadAll();
          }}
        />
      ) : (
        <section className="glass-card tv-table-card" aria-label={isPending ? "Pending emails" : "Replied emails"}>
          <div className="c-toolbar tv-emails-toolbar">
            <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search subject, sender, content" label="Search emails" />
            <div className="tv-row">
              <DateRangePicker
                value={range}
                label={isPending ? "Pending date range" : "Replied date range"}
                onChange={(r) => {
                  // Whole days, like TrackVid's DatePickerDropdown (a preset ending "yesterday" means end of yesterday).
                  const next = r
                    ? { startDate: startOfDay(r.startDate), endDate: endOfDay(r.endDate) }
                    : isPending
                      ? initialPendingRange()
                      : initialRepliedRange();
                  if (isPending) setPendingRange(next);
                  else setRepliedRange(next);
                  setCurrentPage(1);
                  setExpandedIds([]);
                }}
              />
              <FilterSelect
                label="Mailbox"
                value={selectedMailboxId}
                options={mailboxOptions}
                onChange={(v) => {
                  setSelectedMailboxId(v);
                  setCurrentPage(1);
                  setExpandedIds([]);
                }}
              />
            </div>
          </div>

          {isPending ? (
            <BulkSelectionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
              <button type="button" className="primary-button" disabled={bulkRetrying} onClick={() => setRetryDialogOpen(true)}>
                <Icon name="refresh" />
                {bulkRetrying ? "Retrying..." : `Retry Selected (${selectedIds.size})`}
              </button>
            </BulkSelectionBar>
          ) : null}

          <div className="table-scroll c-table-scroll" tabIndex={0} role="region" aria-label="AJIO emails" aria-busy={loading}>
            <table className={`c-table tv-data-table tv-emails-table ${loading && section ? "is-refreshing" : ""}`.trim()}>
              <colgroup>
                {isPending ? <col style={{ width: 44 }} /> : null}
                <col style={{ width: "24%" }} />
                <col style={{ width: 190 }} />
                <col style={{ width: 190 }} />
                <col style={{ width: 150 }} />
                {isPending ? <col style={{ width: 150 }} /> : null}
                <col style={{ width: 190 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 150 }} />
              </colgroup>
              <thead>
                <tr>
                  {isPending ? (
                    <th scope="col" className="c-check">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        disabled={errorRowsOnPage.length === 0}
                        title={errorRowsOnPage.length === 0 ? "No failed emails on this page" : "Select all failed on page"}
                        aria-label="Select all failed on page"
                        onChange={(e) => toggleSelectAllOnPage(e.currentTarget.checked)}
                      />
                    </th>
                  ) : null}
                  <th scope="col">Subject</th>
                  <th scope="col">Sender</th>
                  <th scope="col">Mailbox</th>
                  <th scope="col">Status</th>
                  {isPending ? <th scope="col">Fix</th> : null}
                  <th scope="col">Received</th>
                  <th scope="col">Ajio Acknowledged</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Quick Actions
                  </th>
                </tr>
              </thead>
              <tbody>{tbody}</tbody>
            </table>
          </div>

          {!hasSearchTerm && totalRow > 0 && !list.error ? (
            <div className="tv-emails-pager">
              <label className="tv-emails-page-jump">
                Page
                <input
                  key={currentPage}
                  type="number"
                  min={1}
                  max={totalPages}
                  defaultValue={currentPage}
                  aria-label="Go to page"
                  disabled={loading}
                  onBlur={(e) => goToPage(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") goToPage(e.currentTarget.value);
                  }}
                />
                of <strong>{totalPages}</strong>
              </label>
              <TablePagination
                total={totalRow}
                page={currentPage}
                size={limit}
                sizes={PAGE_SIZES}
                onPageChange={(p) => {
                  setExpandedIds([]);
                  setCurrentPage(p);
                }}
                onSizeChange={(s) => {
                  setLimit(s);
                  setCurrentPage(1);
                }}
              />
            </div>
          ) : null}
        </section>
      )}

      {retryDialogOpen ? (
        <ConfirmDialog
          title={`Retry ${selectedIds.size} email${selectedIds.size === 1 ? "" : "s"}?`}
          message="We'll check each selected email for its order and video. Only emails whose data is now available will be queued for sending. Emails still missing data will be skipped and remain failed."
          confirmLabel={bulkRetrying ? "Retrying..." : "Retry"}
          busy={bulkRetrying}
          onConfirm={() => void handleBulkRetry()}
          onClose={() => setRetryDialogOpen(false)}
        />
      ) : null}
      {fixDialog?.type === "awb" ? <AddAwbDialog emailId={fixDialog.emailId} onClose={() => setFixDialog(null)} onDone={handleManualFixDone} /> : null}
      {fixDialog?.type === "video" ? (
        <AddVideoLinkDialog emailId={fixDialog.emailId} onClose={() => setFixDialog(null)} onDone={handleManualFixDone} />
      ) : null}
    </div>
  );
}
