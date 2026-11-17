"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/icons/icon";
import type { DataColumn } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { CMS_STATUS, TEMP_PERMIT } from "@/config/constant";
import {
  BUNDLE_TAB_COLUMNS,
  FULL_COLUMN_TABS,
  MAX_AUTO_CLAIM_ATTEMPTS,
  PLATFORM_BUNDLE_TABS,
  POB_ID_REQUIRED_MESSAGE,
  SUB_ORDER_REQUIRED_MESSAGE,
  USERNAME_PLATFORMS,
  collectBundleImages,
  getProcessCount,
  getRetryLimitMessage,
  isMissingRequiredPobId,
  isMissingRequiredSubOrder,
  remainingTatDays,
  usernameOf,
} from "@/features/cms/cms-rules";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ICms } from "@/types/cms";
import type { IUser } from "@/types/common";

export interface CmsColumnContext {
  status: string;
  platformTab: string;
  canEdit: boolean;
  isAdmin: boolean;
  user: IUser | null;
  now: number;
  retryingDriveIds: ReadonlySet<string>;
  zipBusyId: string;
  statusBusyId: string;
  onEditFields: (row: ICms) => void;
  onEditTicket: (row: ICms) => void;
  onEditUsername: (row: ICms) => void;
  onEmail: (row: ICms) => void;
  onSixSide: (row: ICms) => void;
  onImages: (row: ICms) => void;
  onRetryDrive: (id: string) => void;
  onDownloadAll: (row: ICms) => void;
  onHistory: (row: ICms) => void;
  onView: (row: ICms) => void;
  onDelete: (row: ICms) => void;
  onApprove: (row: ICms) => void;
  onReject: (row: ICms) => void;
}

const DASH = <span className="tv-muted">- - -</span>;
const text = (v: string | undefined | null): ReactNode => (v ? v : DASH);
const when = (v: string | undefined): ReactNode => (v ? formatDate(v, "dd/MM/yyyy hh:mm:ss a") : DASH);

function Chip({ tone, label, title, spin = false }: { tone: "green" | "amber" | "red" | "blue" | "neutral"; label: ReactNode; title?: string; spin?: boolean }) {
  return (
    <span className={`c-status ${tone === "neutral" ? "tv-cms-chip-neutral" : tone} ${title ? "tv-cms-help" : ""}`.trim()} title={title}>
      {spin ? <span className="tv-spinner small" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

function IconAction({ icon, label, onClick, danger = false, disabled = false, busy = false }: { icon: "pencil" | "history" | "eye" | "trash" | "refresh"; label: string; onClick: () => void; danger?: boolean; disabled?: boolean; busy?: boolean }) {
  return (
    <button type="button" className={`icon-button tv-cms-icon-btn ${danger ? "is-danger" : ""}`.trim()} aria-label={label} title={label} onClick={onClick} disabled={disabled || busy}>
      {busy ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name={icon} />}
    </button>
  );
}

function scriptStatusCell(row: ICms): ReactNode {
  const scriptStatus = row.scriptProcessingStatus || "Not Started";
  const isAjio = row.eCommercePlatform.toLowerCase().trim() === "ajio";
  const driveNotReady = isAjio && (row.driveStatus === "pending" || row.driveStatus === "failed");
  if (driveNotReady && scriptStatus === "Not Started") {
    return row.driveStatus === "failed" ? (
      <Chip tone="red" label="Link prep failed" title="Could not prepare Google Drive links. The system will retry automatically; this claim isn't ready to auto-claim yet." />
    ) : (
      <Chip tone="amber" spin label="Preparing links…" title="Preparing Google Drive links for this AJIO claim. It will be ready to auto-claim in a few moments." />
    );
  }
  switch (scriptStatus) {
    case "Queued":
      return <Chip tone="amber" label="Queued" />;
    case "Running":
      return <Chip tone="blue" spin label="Running" />;
    case "Success":
    case "Completed":
      return <Chip tone="green" label={row.ticketNumber ? "Completed" : "Success"} />;
    case "Help Center Failed":
      return <Chip tone="amber" label="Help Center Failed" title={row.scriptProcessingError || "Help Center processing failed"} />;
    case "Failed":
      return <Chip tone="red" label="Failed" title={row.scriptProcessingError || "Processing failed"} />;
    default:
      return <Chip tone="neutral" label="Not Started" />;
  }
}

function attemptsCell(row: ICms): ReactNode {
  const count = getProcessCount(row);
  const limit = count >= MAX_AUTO_CLAIM_ATTEMPTS;
  const title = limit
    ? TEMP_PERMIT
      ? `${getRetryLimitMessage(row)} — retry allowed (TEMP_PERMIT is on)`
      : `${getRetryLimitMessage(row)} — this claim can no longer be auto-claimed`
    : `Auto-claim attempts: ${count}`;
  return <Chip tone={limit ? "red" : count === 0 ? "neutral" : count > 1 ? "amber" : "blue"} label={count} title={title} />;
}

const scriptErrorColumn: DataColumn<ICms> = {
  key: "scriptProcessingError",
  header: "Script Error",
  width: 220,
  render: (row) =>
    row.scriptProcessingError ? (
      <span className="tv-cms-error-text tv-cms-help" title={row.scriptProcessingError}>
        {row.scriptProcessingError}
      </span>
    ) : (
      <span className="tv-muted">—</span>
    ),
};

/** Builds the Manage SPF Claims columns exactly like TrackVid's `columns` memo (per status and platform tab). */
export function buildCmsColumns(ctx: CmsColumnContext): DataColumn<ICms>[] {
  const { status, platformTab, canEdit, isAdmin } = ctx;
  const p = platformTab.toLowerCase();
  const inReview = status === CMS_STATUS.IN_REVIEW;

  const rowEditable = (row: ICms) =>
    (canEdit && row.status === CMS_STATUS.PENDING && status === CMS_STATUS.PENDING) ||
    (canEdit && TEMP_PERMIT && row.status === CMS_STATUS.FAILED_TO_PROCEED && status === CMS_STATUS.FAILED_TO_PROCEED) ||
    (isAdmin && row.status === CMS_STATUS.IN_REVIEW && inReview);

  const all: DataColumn<ICms>[] = [
    {
      key: "eCommercePlatform",
      header: "E-commerce Platform",
      width: 180,
      sortable: true,
      render: (row) => (
        <span className="tv-row" style={{ gap: 4 }}>
          <span>{row.eCommercePlatform}</span>
          {rowEditable(row) ? <IconAction icon="pencil" label="Edit Claim" onClick={() => ctx.onEditFields(row)} /> : null}
        </span>
      ),
    },
    {
      key: "ticketNumber",
      header: "Ticket",
      width: 160,
      sortable: true,
      render: (row) => {
        const editable = rowEditable(row);
        return (
          <span className="tv-row" style={{ gap: 4 }}>
            {editable ? <IconAction icon="pencil" label="Edit Ticket" onClick={() => ctx.onEditTicket(row)} /> : null}
            {row.ticketNumber ? <span className="tv-mono">{row.ticketNumber}</span> : editable ? null : DASH}
          </span>
        );
      },
    },
    ...(inReview || status === CMS_STATUS.APPROVED || status === CMS_STATUS.REJECTED
      ? [
          {
            key: "processingMode",
            header: "Processed By",
            width: 140,
            align: "center" as const,
            render: (row: ICms) => {
              const mode = row.processingMode === "manual" ? "Manual" : row.processingMode === "desktop" ? "Desktop app" : "Automated";
              return <span className={`tv-cms-mode is-${row.processingMode ?? "automated"}`}>{mode}</span>;
            },
          },
        ]
      : []),
    { key: "AWBNumber", header: "Return AWB", width: 160, sortable: true, render: (row) => <span className="tv-mono">{row.AWBNumber || "- - -"}</span> },
    { key: "seller_sku", header: "Seller SKU", width: 150, sortable: true, render: (row) => text(row.seller_sku) },
    {
      key: "pobid",
      header: "POB ID",
      width: 130,
      sortable: true,
      render: (row) =>
        isMissingRequiredPobId(row) ? (
          <span className="tv-cms-missing tv-cms-help" title={POB_ID_REQUIRED_MESSAGE}>
            Missing
          </span>
        ) : (
          text(row.pobid)
        ),
    },
    {
      key: "status",
      header: "Status",
      width: 160,
      sortable: true,
      render: (row) => {
        const reason =
          row.status === CMS_STATUS.FAILED_TO_PROCEED
            ? row.scriptProcessingError || "Retry limit reached. The automation did not report an error message for the final attempt."
            : undefined;
        return reason ? (
          <span className="tv-cms-help" title={reason}>
            <StatusPill value={row.status} />
          </span>
        ) : (
          <StatusPill value={row.status} />
        );
      },
    },
    ...(status === CMS_STATUS.PAID
      ? [
          {
            key: "compensationAmount",
            header: "Compensation",
            width: 140,
            sortable: true,
            align: "right" as const,
            render: (row: ICms) => {
              const n = Number(row.compensationAmount);
              return row.compensationAmount == null || !Number.isFinite(n) ? DASH : <strong className="tv-cms-money">{formatCurrency(n)}</strong>;
            },
          },
        ]
      : []),
    ...(status === CMS_STATUS.PENDING
      ? [
          { key: "scriptProcessingStatus", header: "Script Status", width: 160, sortable: true, render: scriptStatusCell },
          { key: "processCount", header: "Attempts", width: 110, sortable: true, align: "center" as const, render: attemptsCell },
          scriptErrorColumn,
        ]
      : []),
    ...(status === CMS_STATUS.FAILED_TO_PROCEED ? [scriptErrorColumn] : []),
    ...(status === CMS_STATUS.REJECTED
      ? [
          {
            key: "rejectReason",
            header: "Reject Reason",
            width: 200,
            render: (row: ICms) => {
              const reason = (row.rejectReason ?? "").trim();
              return reason ? (
                <span className="tv-ellipsis tv-cms-help" title={reason}>
                  {reason}
                </span>
              ) : (
                DASH
              );
            },
          },
        ]
      : []),
    {
      key: "emailFormate",
      header: "Preview",
      width: 120,
      render: (row) => (
        <button type="button" className="secondary-button compact-button" onClick={() => ctx.onEmail(row)}>
          <Icon name="envelope" /> Email
        </button>
      ),
    },
    {
      key: "sixSideImages",
      header: "Six Side Images",
      width: 150,
      render: (row) =>
        row.sixSideImages?.fileKey ? (
          <button type="button" className="secondary-button compact-button" onClick={() => ctx.onSixSide(row)}>
            <Icon name="download" /> Download
          </button>
        ) : (
          <span className="tv-muted">- - - - -</span>
        ),
    },
    ...(p === "ajio"
      ? [
          {
            key: "driveStatus",
            header: "Drive Status",
            width: 150,
            render: (row: ICms) => {
              if (row.eCommercePlatform.toLowerCase().trim() !== "ajio") return <span className="tv-muted">—</span>;
              if (row.driveStatus === "pending")
                return <Chip tone="amber" spin label="Preparing…" title="Copying CCTV/image links from S3 to Google Drive. Ready to auto-claim in a few moments." />;
              if (row.driveStatus === "failed") {
                const retrying = ctx.retryingDriveIds.has(row._id);
                return (
                  <span className="tv-row" style={{ gap: 4 }}>
                    <Chip tone="red" label="Failed" title="Could not prepare Google Drive links. The system retries automatically; this claim isn't ready yet." />
                    <IconAction icon="refresh" label={retrying ? "Retrying…" : "Retry Drive conversion"} busy={retrying} onClick={() => ctx.onRetryDrive(row._id)} />
                  </span>
                );
              }
              return <Chip tone="green" label="Ready" />;
            },
          },
        ]
      : []),
    { key: "returnDeliveryDate", header: "Return Delivery Date", width: 200, sortable: true, render: (row) => when(row.returnDeliveryDate) },
    {
      key: "outOfTat",
      header: "Out Of TAT",
      width: 130,
      render: (row) => {
        const remaining = remainingTatDays(row, ctx.user, ctx.now);
        if (remaining === null) return DASH;
        if (remaining <= 0) return <Chip tone="red" label="TAT Expired" />;
        return <Chip tone={remaining <= 2 ? "amber" : "green"} label={`${remaining} day${remaining === 1 ? "" : "s"}`} />;
      },
    },
    { key: "typeOfClaim", header: "Type of Claim", width: 200, sortable: true, render: (row) => <span className="tv-ellipsis" title={row.typeOfClaim}>{row.typeOfClaim || "- - -"}</span> },
    { key: "forwardAWB", header: "Scanned Number", width: 160, sortable: true, render: (row) => text(row.forwardAWB) },
    { key: "customerOrderNumber", header: "Cust. Order Number", width: 160, sortable: true, render: (row) => text(row.customerOrderNumber) },
    { key: "order_Brand", header: "Brand", width: 150, sortable: true, render: (row) => text(row.order_Brand) },
    {
      key: "ecommerce_account_username",
      header: "Username",
      width: 200,
      sortable: true,
      render: (row) => {
        const username = usernameOf(row);
        if (username.trim()) return <span className="tv-ellipsis" title={username}>{username}</span>;
        if (!USERNAME_PLATFORMS.has(row.eCommercePlatform.toLowerCase().trim())) return DASH;
        return <IconAction icon="pencil" label="Edit Username" onClick={() => ctx.onEditUsername(row)} />;
      },
    },
    { key: "nykaa_vendor_code", header: "Vendor Code", width: 140, render: (row) => text(row.nykaaClaimDetails?.vendorCode) },
    { key: "nykaa_sku_id", header: "SKU ID", width: 140, render: (row) => text(row.nykaaClaimDetails?.skuId) },
    { key: "nykaa_return_type", header: "Return Type", width: 120, render: (row) => text(row.nykaaClaimDetails?.returnType) },
    { key: "accountType", header: "Account Type", width: 150, sortable: true, render: (row) => text(row.accountType) },
    { key: "forwardOrderDate", header: "Forward Order Date", width: 200, sortable: true, render: (row) => when(row.forwardOrderDate) },
    { key: "feed", header: "Feed Name", width: 150, sortable: true, render: (row) => text(row.feed?.name) },
    {
      key: "images",
      header: "Images",
      width: 150,
      render: (row) => {
        const entries = collectBundleImages(row);
        if (!entries.length) return <span className="tv-muted">- - - - -</span>;
        return (
          <button type="button" className="secondary-button compact-button" onClick={() => ctx.onImages(row)}>
            <Icon name="download" /> Download ({entries.length})
          </button>
        );
      },
    },
    { key: "createdAt", header: "Create Date - Time", width: 200, sortable: true, render: (row) => when(row.createdAt) },
    {
      key: "allResources",
      header: "Download All Resources",
      width: 170,
      render: (row) => {
        const busy = ctx.zipBusyId === row._id;
        return (
          <button type="button" className="secondary-button compact-button" disabled={busy} onClick={() => ctx.onDownloadAll(row)}>
            {busy ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="download" />} Download
          </button>
        );
      },
    },
    { key: "history", header: "History", width: 80, align: "center", render: (row) => <IconAction icon="history" label="Claim history" onClick={() => ctx.onHistory(row)} /> },
    { key: "view", header: "View", width: 70, align: "center", render: (row) => <IconAction icon="eye" label="View Claim" onClick={() => ctx.onView(row)} /> },
    ...(status === CMS_STATUS.PENDING
      ? [{ key: "delete", header: "Delete", width: 80, align: "center" as const, render: (row: ICms) => <IconAction icon="trash" danger label="Delete Claim" onClick={() => ctx.onDelete(row)} /> }]
      : []),
  ];

  let result = FULL_COLUMN_TABS.has(platformTab) ? all : all.filter((c) => c.key !== "sixSideImages");
  const nykaaOnly = new Set(["nykaa_vendor_code", "nykaa_sku_id", "nykaa_return_type"]);
  if (platformTab === "Nykaa") result = result.filter((c) => c.key !== "customerOrderNumber" && c.key !== "accountType");
  else result = result.filter((c) => !nykaaOnly.has(c.key));
  if (platformTab === "Snapdeal") result = result.filter((c) => !["customerOrderNumber", "accountType", "seller_sku"].includes(c.key));

  if (PLATFORM_BUNDLE_TABS.has(platformTab)) {
    const byKey = new Map(result.map((c) => [c.key, c]));
    result = BUNDLE_TAB_COLUMNS.map((k) => byKey.get(k)).filter((c): c is DataColumn<ICms> => Boolean(c));
  } else {
    result = result.filter((c) => c.key !== "images");
  }

  if (platformTab === "Meesho" || platformTab === "Snapdeal") {
    const forward = result.find((c) => c.key === "forwardAWB");
    const without = result.filter((c) => c.key !== "forwardAWB");
    const subOrder: DataColumn<ICms> = {
      key: "subOrderNumber",
      header: "Sub Order No",
      width: 180,
      sortable: true,
      render: (row) =>
        isMissingRequiredSubOrder(row) ? (
          <span className="tv-cms-missing tv-cms-help" title={SUB_ORDER_REQUIRED_MESSAGE}>
            Missing
          </span>
        ) : (
          text(row.subOrderNumber)
        ),
    };
    const at = without.findIndex((c) => c.key === "AWBNumber");
    without.splice(at === -1 ? without.length : at + 1, 0, ...(forward ? [{ ...forward, header: "Forward AWB" }, subOrder] : [subOrder]));
    result = without;
  }

  // In Review + cms::edit: Approve / Reject column first.
  if (ctx.canEdit && inReview) {
    result = [
      {
        key: "actions",
        header: "Actions",
        width: 190,
        render: (row) =>
          row.status === CMS_STATUS.IN_REVIEW ? (
            <span className="tv-row" style={{ gap: 6 }}>
              <button type="button" className="primary-button compact-button" disabled={ctx.statusBusyId === row._id} onClick={() => ctx.onApprove(row)}>
                {ctx.statusBusyId === row._id ? <span className="tv-spinner small" aria-hidden="true" /> : null}
                Approve
              </button>
              <button type="button" className="danger-button compact-button" disabled={ctx.statusBusyId === row._id} onClick={() => ctx.onReject(row)}>
                Reject
              </button>
            </span>
          ) : null,
      },
      ...result,
    ];
  }
  return result;
}
