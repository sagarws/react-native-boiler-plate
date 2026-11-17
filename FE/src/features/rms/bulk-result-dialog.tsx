"use client";

import { AppDialog } from "@/components/ui/app-dialog";
import { downloadText, toCsv } from "@/lib/download";
import type { RmsBulkResult } from "@/types/rms";

const LIMIT = 200;

function Section<T>({ title, rows, render }: { title: string; rows: readonly T[]; render: (row: T) => string }) {
  if (!rows.length) return null;
  return (
    <div className="tv-stack tv-rms-bulk-section">
      <strong>
        {title} ({rows.length})
      </strong>
      <ul className="tv-rms-bulk-list">
        {rows.slice(0, LIMIT).map((r, i) => (
          <li key={i}>{render(r)}</li>
        ))}
        {rows.length > LIMIT ? <li className="tv-muted">+ {rows.length - LIMIT} more — download report to see all.</li> : null}
      </ul>
    </div>
  );
}

const rowLabel = (n: number) => (n ? `Row ${n} · ` : "");

/** RMS.tsx "Bulk Status Update — {marketplace}" result dialog with the CSV report download. */
export function RmsBulkResultDialog({ result, onClose }: { result: RmsBulkResult; onClose: () => void }) {
  const downloadReport = () => {
    const csv = toCsv([
      ["section", "rowNumber", "ticketId", "detail"],
      ...result.updated.map((r) => ["Updated", r.rowNumber, r.ticketId, r.newStatus]),
      ...result.skipped.map((r) => ["Skipped", r.rowNumber, r.ticketId, r.reason]),
      ...result.notFound.map((r) => ["NotFound", r.rowNumber || "", r.ticketId, ""]),
    ]);
    downloadText(csv, `rms-bulk-status-report-${result.marketplace}.csv`, "text/csv;charset=utf-8");
  };

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
        <div className="tv-row">
          <span className="tv-chip">Rows in sheet: {result.scannedRows ?? result.totalRows}</span>
          {typeof result.ignoredCount === "number" && result.ignoredCount > 0 ? <span className="tv-chip">Ignored (status not Approved/Rejected): {result.ignoredCount}</span> : null}
          <span className="c-status blue">Actionable rows: {result.totalRows}</span>
          <span className="c-status green">Updated: {result.updatedCount}</span>
          <span className="c-status amber">Skipped: {result.skippedCount}</span>
          <span className="c-status red">Not found: {result.notFoundCount}</span>
        </div>
        <Section title="Updated" rows={result.updated} render={(r) => `${rowLabel(r.rowNumber)}${r.ticketId} → ${r.newStatus}`} />
        <Section title="Skipped" rows={result.skipped} render={(r) => `${rowLabel(r.rowNumber)}${r.ticketId || "(no ticketId)"} — ${r.reason}`} />
        <Section title={`Not found in "In Review"`} rows={result.notFound} render={(r) => `${rowLabel(r.rowNumber)}${r.ticketId}`} />
        {!result.updated.length && !result.skipped.length && !result.notFound.length ? (
          <p className="tv-muted">{result.updatedCount ? `${result.updatedCount} record(s) moved to Approved.` : "No rows in the sheet matched an In Review dispute."}</p>
        ) : null}
      </div>
    </AppDialog>
  );
}
