"use client";

import { AppDialog } from "@/components/ui/app-dialog";
import { downloadText, toCsv } from "@/lib/download";
import type { BulkStatusResult } from "@/types/cms";

function Section({ title, lines, extra }: { title: string; lines: string[]; extra: number }) {
  if (!lines.length) return null;
  return (
    <div className="tv-stack" style={{ gap: 6 }}>
      <strong className="tv-small">{title}</strong>
      <div className="tv-cms-scroll-box">
        {lines.map((l) => (
          <p key={l} className="tv-small">
            {l}
          </p>
        ))}
        {extra > 0 ? <p className="tv-small tv-muted">+ {extra} more — download report to see all.</p> : null}
      </div>
    </div>
  );
}

/** TrackVid inline "Bulk Status Update — <marketplace>" result dialog + CSV report. */
export function BulkResultDialog({ result, onClose }: { result: BulkStatusResult; onClose: () => void }) {
  const downloadReport = () => {
    const rows: (string | number)[][] = [["section", "rowNumber", "ticketId", "detail"]];
    result.updated.forEach((r) => rows.push(["Updated", r.rowNumber, r.ticketId, r.newStatus]));
    result.skipped.forEach((r) => rows.push(["Skipped", r.rowNumber, r.ticketId, r.reason]));
    result.notFound.forEach((r) => rows.push(["NotFound", r.rowNumber, r.ticketId, ""]));
    downloadText(toCsv(rows), `bulk-status-report-${result.marketplace}.csv`, "text/csv;charset=utf-8");
  };
  const isAjio = result.marketplace.toLowerCase() === "ajio";
  return (
    <AppDialog
      title={`Bulk Status Update — ${result.marketplace}`}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button type="button" className="secondary-button" onClick={downloadReport}>
            Download Report
          </button>
          <button type="button" className="primary-button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="tv-stack">
        <div className="tv-row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="c-status blue">Rows in sheet: {result.scannedRows ?? result.totalRows}</span>
          {result.ignoredCount ? <span className="c-status blue">Ignored (status not Approved/Rejected): {result.ignoredCount}</span> : null}
          <span className="c-status blue">Actionable rows: {result.totalRows}</span>
          <span className="c-status green">Updated: {result.updatedCount}</span>
          <span className="c-status amber">Skipped: {result.skippedCount}</span>
          <span className="c-status red">Not found: {result.notFoundCount}</span>
        </div>
        <Section
          title={`Updated (${result.updated.length})`}
          lines={result.updated.slice(0, 200).map((r) => `Row ${r.rowNumber} · ${r.ticketId} → ${r.newStatus}`)}
          extra={result.updated.length - 200}
        />
        <Section
          title={`Skipped (${result.skipped.length})`}
          lines={result.skipped.slice(0, 200).map((r) => `Row ${r.rowNumber} · ${r.ticketId || "(no ticketId)"} — ${r.reason}`)}
          extra={result.skipped.length - 200}
        />
        <Section
          title={isAjio ? `Not found (excluded Pending or missing ticket) (${result.notFound.length})` : `Not found in "In Review" (${result.notFound.length})`}
          lines={result.notFound.slice(0, 200).map((r) => `Row ${r.rowNumber} · ${r.ticketId}`)}
          extra={result.notFound.length - 200}
        />
      </div>
    </AppDialog>
  );
}
