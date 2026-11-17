"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { Spinner } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { downloadBlob } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { bulkClaimCheck, bulkClaimCreate, bulkClaimVerify } from "@/services/cms-create-service";
import type { BulkClaimCheckResponse, BulkClaimCreateRow, BulkClaimVerifyPayloadRow, BulkClaimVerifyRow } from "@/types/cms-create";
import { buildTextPdf, cell, type PdfLine } from "@/features/cms-create/simple-pdf";

const ACCEPT = ".csv,.xlsx,.xls";
type Matched = BulkClaimCheckResponse["matched"][number];
type Filter = "all" | "success" | "failed";

const verifyPayload = (data: BulkClaimCheckResponse): BulkClaimVerifyPayloadRow[] =>
  data.matched
    .filter((m) => m.vmsList.length > 0)
    .map((m) => ({
      rowNumber: m.csvRow.rowNumber,
      returnGateEntryAwb: m.csvRow.returnGateEntryAwb,
      qcReason: m.csvRow.qcReason,
      salesChannel: m.csvRow.salesChannel,
      vmsId: m.vmsList[0]._id,
      platform: m.vmsList[0].eCommercePlatform,
      clientSkuIdEan: m.csvRow.clientSkuIdEan,
      returnOrderType: m.csvRow.returnOrderType,
      forwardAwbNumber: m.csvRow.forwardAwbNumber,
    }));

/**
 * TrackVid `BulkClaimModal`: upload the Increff QC report → check (match each Return AWB against VMS) → verify
 * (resolve the QC reason to a claim type, list missing fields) run automatically; "Create Claims (N)" creates the
 * verified rows; afterwards "Download PDF" exports the Success and Failed tables. In-flight requests abort on close.
 */
export function BulkClaimDialog({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<BulkClaimCheckResponse | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [verifyByRow, setVerifyByRow] = useState(new Map<number, BulkClaimVerifyRow>());
  const [createByRow, setCreateByRow] = useState(new Map<number, BulkClaimCreateRow>());

  useEffect(
    () => () => {
      abort.current?.abort();
      abort.current = null;
    },
    [],
  );

  const run = async (f: File) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const current = () => abort.current === controller && !controller.signal.aborted;
    setResult(null);
    setVerifyByRow(new Map());
    setCreateByRow(new Map());
    setChecking(true);
    let data: BulkClaimCheckResponse | null = null;
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await bulkClaimCheck(fd, controller.signal);
      if (!current()) return;
      if (res.isSuccess) {
        data = res.data;
        setResult(res.data);
        setFilter("all");
      } else toast.error(res.displayMessage || "Failed to parse file");
    } catch (e) {
      if (current()) toast.error(errorMessage(e, "Request failed"));
    } finally {
      if (current()) setChecking(false);
    }
    if (!data || !current()) return;
    const rows = verifyPayload(data);
    if (!rows.length) return;
    setVerifying(true);
    try {
      const res = await bulkClaimVerify({ rows }, controller.signal);
      if (!current()) return;
      setVerifyByRow(new Map(res.data.results.map((r) => [r.rowNumber, r])));
    } catch (e) {
      if (current()) toast.error(errorMessage(e, "Verify failed"));
    } finally {
      if (current()) setVerifying(false);
    }
  };

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    void run(f);
  };

  const createPayload = result ? verifyPayload(result).filter((r) => verifyByRow.get(r.rowNumber)?.isValid === true) : [];
  const hasCreateResults = createByRow.size > 0;

  const create = async () => {
    if (!createPayload.length) {
      toast.error("No verified rows to create");
      return;
    }
    setCreating(true);
    try {
      const res = await bulkClaimCreate({ rows: createPayload });
      setCreateByRow(new Map(res.data.results.map((r) => [r.rowNumber, r])));
      setFilter("success");
      toast.success(res.displayMessage || "Create complete");
    } catch (e) {
      toast.error(errorMessage(e, "Create failed"));
    } finally {
      setCreating(false);
    }
  };

  const successRows: Matched[] = result
    ? result.matched.filter((m) => {
        const c = createByRow.get(m.csvRow.rowNumber);
        if (c) return c.isSuccess;
        const v = verifyByRow.get(m.csvRow.rowNumber);
        return v ? v.isValid : true;
      })
    : [];
  const failedRows: Matched[] = result
    ? [
        ...result.matched.filter((m) => {
          const c = createByRow.get(m.csvRow.rowNumber);
          if (c) return !c.isSuccess;
          const v = verifyByRow.get(m.csvRow.rowNumber);
          return Boolean(v) && !v?.isValid;
        }),
        ...result.unmatched.map((u) => ({ csvRow: u.csvRow, vmsList: [], reason: u.reason })),
      ]
    : [];

  const reasonOf = (m: Matched & { reason?: string }) => {
    const c = createByRow.get(m.csvRow.rowNumber);
    const v = verifyByRow.get(m.csvRow.rowNumber);
    if (c?.error) return c.error;
    if (v && !v.isValid && v.missingFields.length) return `Missing / invalid: ${v.missingFields.join(", ")}`;
    if (m.reason) return m.reason;
    return m.vmsList.length === 0 ? "Unmatched (no VMS record)" : "Failed";
  };

  const statusOf = (m: Matched): { label: string; tone: "green" | "red" | "amber" | "blue" } => {
    const c = createByRow.get(m.csvRow.rowNumber);
    const v = verifyByRow.get(m.csvRow.rowNumber);
    if (c) return c.isSuccess ? { label: c.cmsId ? `Created · ${c.cmsId.slice(-6)}` : "Created", tone: "green" } : { label: c.error || "Create failed", tone: "red" };
    if (!v) return { label: verifying ? "Verifying…" : "Not verified", tone: "blue" };
    return v.isValid ? { label: v.resolvedTypeOfClaim ? `Ready · ${v.resolvedTypeOfClaim}` : "Ready", tone: "green" } : { label: `Missing: ${v.missingFields.join(", ")}`, tone: "amber" };
  };

  const downloadPdf = () => {
    if (!successRows.length && !failedRows.length) {
      toast.error("No rows to export");
      return;
    }
    const now = new Date();
    const vms = (m: Matched) => (m.vmsList.length ? m.vmsList.map((v) => `${v.eCommercePlatform} · ${v.awbNo}`).join(" | ") : "-");
    const section = (title: string, rows: Matched[], last: (m: Matched) => string): PdfLine[] => [
      { text: `Bulk Claim - ${title} (${rows.length})`, size: 14, bold: true },
      { text: `Generated ${now.toLocaleString()}${file ? ` · ${file.name}` : ""}`, muted: true },
      { text: `${cell("Row #", 7)}${cell("Return AWB", 18)}${cell("Sales Channel", 14)}${cell("QC Reason", 30)}${cell("VMS Matches", 30)}${title === "Success" ? "Status" : "Reason"}`, bold: true },
      ...(rows.length ? rows.map((m) => ({ text: `${cell(String(m.csvRow.rowNumber), 7)}${cell(m.csvRow.returnGateEntryAwb || "-", 18)}${cell(m.csvRow.salesChannel, 14)}${cell(m.csvRow.qcReason, 30)}${cell(vms(m), 30)}${last(m)}` })) : [{ text: "No rows", muted: true }]),
      { text: " " },
    ];
    const blob = buildTextPdf([...section("Success", successRows, (m) => statusOf(m).label), ...section("Failed", failedRows, reasonOf)]);
    downloadBlob(blob, `${file?.name.replace(/\.[^.]+$/, "") || "bulk-claim"}-results-${now.toISOString().slice(0, 10)}.pdf`);
  };

  const table = (rows: Matched[], kind: "success" | "failed") => (
    <div className="table-scroll tv-cmsc-bulk-table">
      <table className="tv-data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Row #</th>
            <th>Return AWB</th>
            <th>Sales Channel</th>
            <th>QC Reason</th>
            <th>VMS Matches</th>
            <th>{kind === "success" ? "Status" : "Reason"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => {
            const st = statusOf(m);
            return (
              <tr key={`${kind}-${m.csvRow.rowNumber}-${m.csvRow.returnGateEntryAwb}`}>
                <td>{i + 1}</td>
                <td>{m.csvRow.rowNumber}</td>
                <td className="tv-mono">{m.csvRow.returnGateEntryAwb || "—"}</td>
                <td>{m.csvRow.salesChannel}</td>
                <td>{m.csvRow.qcReason || "—"}</td>
                <td>
                  {m.vmsList.length === 0 ? (
                    <span className="tv-muted">—</span>
                  ) : (
                    m.vmsList.map((v) => (
                      <span key={v._id} className="tv-row tv-small">
                        <PlatformLogo name={v.eCommercePlatform} showName={false} /> {v.eCommercePlatform} · <span className="tv-mono">{v.awbNo}</span> <span className="tv-chip">{v.orderType}</span>
                      </span>
                    ))
                  )}
                </td>
                <td>{kind === "success" ? <StatusPill value={st.label} tone={st.tone} /> : <span className="tv-cmsc-reason">{reasonOf(m)}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const tabs: { key: Filter; label: string; count: number }[] = result
    ? [
        { key: "all", label: "Total", count: result.totalRows },
        { key: "success", label: hasCreateResults ? "Success" : "Matched", count: successRows.length },
        { key: "failed", label: hasCreateResults ? "Failed" : "Unmatched", count: failedRows.length },
      ]
    : [];
  const busy = checking || verifying || creating;

  return (
    <AppDialog
      title={
        <span className="tv-stack tv-cmsc-bulk-title">
          <span>Bulk Claim</span>
          <small className="tv-muted">Upload the Increff QC CSV / Excel report. We&apos;ll match each row&apos;s Return AWB against your VMS records.</small>
        </span>
      }
      onClose={onClose}
      size="xl"
      footer={
        <>
          {hasCreateResults ? (
            <button type="button" className="primary-button" onClick={downloadPdf}>
              <Icon name="download" /> Download PDF
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={() => void create()} disabled={busy || createPayload.length === 0}>
              {creating ? <Spinner /> : null} Create Claims{createPayload.length ? ` (${createPayload.length})` : ""}
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <input ref={input} type="file" accept={ACCEPT} hidden aria-label="Increff QC report" onChange={(e) => {
        const f = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        pick(f);
      }} />
      {!result ? (
        <button
          type="button"
          className={`tv-dropzone tv-cmsc-upload-zone ${dragging ? "is-dragging" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          <Icon name="upload" />
          <strong>{file ? "File selected" : "Click to browse or drag-and-drop"}</strong>
          <span className="tv-muted">{file ? "You can replace the file by clicking again" : `Accepted formats: ${ACCEPT.split(",").join(", ").toUpperCase()}`}</span>
        </button>
      ) : null}
      {file && !result ? (
        <div className="tv-cmsc-file-card">
          <Icon name="file-text" />
          <span className="tv-stack">
            <strong>{file.name}</strong>
            <small className="tv-muted">{(file.size / 1024).toFixed(1)} KB</small>
          </span>
          {checking || verifying ? <Spinner label={checking ? "Checking VMS…" : "Verifying rows…"} /> : null}
        </div>
      ) : null}
      {result ? (
        <div className="tv-stack">
          <div className="tv-row tv-cmsc-bulk-tabs" role="tablist" aria-label="Bulk claim rows">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={filter === t.key} className={`tv-cmsc-bulk-tab ${filter === t.key ? "is-active" : ""} tone-${t.key}`} onClick={() => setFilter(t.key)}>
                {t.label} <span className="tv-tab-count">{t.count}</span>
              </button>
            ))}
            {verifying ? <Spinner label="Verifying rows…" /> : null}
          </div>
          {successRows.length > 0 && filter !== "failed" ? (
            <section>
              <h3 className="tv-section-title">Success ({successRows.length})</h3>
              {table(successRows, "success")}
            </section>
          ) : null}
          {failedRows.length > 0 && filter !== "success" ? (
            <section>
              <h3 className="tv-section-title">Failed ({failedRows.length})</h3>
              {table(failedRows, "failed")}
            </section>
          ) : null}
          {successRows.length === 0 && failedRows.length === 0 ? <p className="tv-muted">The file has no rows.</p> : null}
        </div>
      ) : null}
    </AppDialog>
  );
}
