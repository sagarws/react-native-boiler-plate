import {
  Box,
  CircularProgress,
  Dialog,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  Button as ButtonElement,
} from "@mui/material";
import {
  CheckCircle,
  Close,
  CloudUploadOutlined,
  DownloadOutlined,
  HelpOutline,
  InfoOutlined,
  InsertDriveFileOutlined,
} from "./icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "./toast";
import { jsPDF } from "jspdf";
import PlatformIcon from "./PlatformIcon";
import { bulkClaimCheck, bulkClaimCreate, bulkClaimVerify } from "./api";
import { bulkIncreffResults, bulkIncreffTemplate } from "@renderer/services/claimCreate.service";
import { platformDisplayName as getPlatformDisplayName } from "./platforms/registry";
import { tint } from "./tint";
import {
  buildForcedSixSidePdf,
  isSixSideOnlyFailure,
} from "./platforms/ajio/sixSideRebuild";

interface BulkClaimVmsRow {
  _id: string;
  awbNo: string;
  eCommercePlatform: string;
  orderType: string;
  orderCondition?: number;
  createdAt?: string;
}
interface BulkClaimCsvRow {
  rowNumber: number;
  returnOrderType: string;
  salesChannel: string;
  returnGateEntryAwb: string;
  qcReason: string;
  clientSkuIdEan: string;
  forwardAwbNumber: string;
  forwardUnitBasePrice: string;
}
interface BulkClaimCheckResponse {
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  matched: { csvRow: BulkClaimCsvRow; vmsList: BulkClaimVmsRow[] }[];
  unmatched: { csvRow: BulkClaimCsvRow; reason: string }[];
  // Rows dropped up-front because their Sales Channel didn't match any
  // platform toggled `allowed: true` in company.settings.increffAllocation.
  skippedByPlatform?: number;
}

const ACCEPT = ".csv,.xlsx,.xls";

interface Props {
  open: boolean;
  onClose: () => void;
}

const BulkClaimModal = ({ open, onClose }: Props) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // A blank QC report with exactly the columns the backend reads, so a sheet
  // put together by hand is not refused for a missing or misspelled header.
  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const saved = await bulkIncreffTemplate();

      if (saved.success) toast.success("Template saved");
      else if (saved.error.message !== "Cancelled") toast.error(saved.error.message);
    } finally {
      setDownloading(false);
    }
  };
  const [result, setResult] = useState<BulkClaimCheckResponse | null>(null);
  // Filter tab — always "Total / Success / Failed", regardless of whether
  // Create has been fired yet. The Success/Failed buckets change meaning
  // by phase:
  //   • Pre-create  : Success = matched (ready to create) · Failed = unmatched
  //   • Post-create : Success = createCMS succeeded · Failed = createCMS
  //                   failed OR the row was unmatched from the start
  const [filter, setFilter] = useState<"all" | "success" | "failed">("all");

  // Verify state — keyed by CSV rowNumber so we can render per-row status
  // in the matched table without re-shaping the primary result payload.
  interface VerifyRow {
    rowNumber: number;
    isValid: boolean;
    resolvedTypeOfClaim: string | null;
    missingFields: string[];
  }
  const [verifying, setVerifying] = useState(false);
  const [verifyByRow, setVerifyByRow] = useState<Map<number, VerifyRow>>(new Map());

  // Create state — same keying so the Status column can show per-row
  // create outcome ("Created" vs the underlying error) once the operator
  // hits Create Claims.
  interface CreateRow {
    rowNumber: number;
    isSuccess: boolean;
    cmsId?: string;
    error?: string;
  }
  const [creating, setCreating] = useState(false);
  const [createByRow, setCreateByRow] = useState<Map<number, CreateRow>>(new Map());
  // PDF export runs in chunks that yield back to the event loop, so the
  // button reflects the in-flight state and prevents overlapping exports
  // from stacking up (a second click during a 5k-row export used to leak
  // a second jsPDF doc into memory).
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [forcing, setForcing] = useState(false);

  // Holds the AbortController for the current check→verify pipeline. Dropping
  // file B while file A is still awaiting network used to run both pipelines
  // in parallel, and their `setResult` / `setVerifyByRow` writes interleaved
  // non-deterministically (winner was whichever response landed last).
  // `handleClose` had the same problem — the modal could reopen while an
  // orphan verify from the previous session was still in flight and stamp
  // stale rows onto a fresh session. `runCheckAndVerify` aborts whatever's
  // here before starting, `handleClose` aborts on close, and the unmount
  // effect covers the "modal removed without close" edge case.
  const abortRef = useRef<AbortController | null>(null);
  // Bumped whenever the results stop belonging to the run that produced them
  // (a new file, a close). Force create checks it before writing, because it
  // runs for minutes and cannot be aborted mid-upload.
  const sessionRef = useRef(0);

  const handleClose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current += 1;
    setForcing(false);
    setFile(null);
    setResult(null);
    setFilter("all");
    setVerifyByRow(new Map());
    setCreateByRow(new Map());
    setChecking(false);
    setVerifying(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onClose();
  };

  // Belt-and-braces: if the modal unmounts without going through handleClose
  // (parent route change, error boundary reset), still tear down any live
  // pipeline so its late response can't setState on a torn-down component.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const handleBrowse = () => fileInputRef.current?.click();

  // Reduce a check response to the shape /cms/bulk-claim-verify expects.
  // Extracted so the auto-run chain below can call it against fresh check
  // data without waiting for the `useMemo` derived from `result` state.
  const buildVerifyPayload = (checkData: BulkClaimCheckResponse) =>
    checkData.matched
      .flatMap((m) => {
        // The first VMS match is the one the claim is filed against. A row with
        // none cannot be verified, and `flatMap` drops it — which is what the
        // filter it replaces did, while also proving to the compiler that
        // `vms` exists.
        const vms = m.vmsList[0];

        if (!vms) return [];

        return [{
        rowNumber: m.csvRow.rowNumber,
        returnGateEntryAwb: m.csvRow.returnGateEntryAwb,
        qcReason: m.csvRow.qcReason,
        salesChannel: m.csvRow.salesChannel,
        vmsId: vms._id,
        platform: vms.eCommercePlatform,
        // Nykaa verify needs the CSV SKU ID and Return Order Type to derive
        // its per-row missing-field list; harmless for other platforms.
        clientSkuIdEan: m.csvRow.clientSkuIdEan,
        returnOrderType: m.csvRow.returnOrderType,
        // Forward AWB from the CSV — bulk-create uses this to seed the
        // CMS `forwardAWB` field directly, bypassing MasterImport (which
        // Increff-only rows don't populate).
        forwardAwbNumber: m.csvRow.forwardAwbNumber,
        }];
      });

  // Combined upload → check → verify chain. Runs automatically as soon as
  // a file is selected (browse or drag-drop) so the operator sees a single
  // loading state and lands directly on the results table with each row's
  // Status pre-populated. Kept sequential so verify uses the fresh check
  // response instead of waiting for the `result` state / memo cascade.
  //
  // Concurrency: any in-flight prior pipeline is aborted before starting, and
  // every state write is gated on `abortRef.current === controller` so a
  // response that races back after a newer file (or a close) has replaced the
  // controller is silently discarded. Without that gate, the axios interceptor
  // rewrites AbortErrors into plain string rejections (see config/axios.ts),
  // making them indistinguishable from real "request failed" errors in the
  // catch — so we rely on the signal, not the error shape.
  const runCheckAndVerify = async (f: File) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    sessionRef.current += 1;
    const isCurrent = () => abortRef.current === controller;

    setResult(null);
    setVerifyByRow(new Map());
    setCreateByRow(new Map());
    setChecking(true);
    let checkData: BulkClaimCheckResponse | null = null;
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res: any = await bulkClaimCheck(fd, { signal: controller.signal });
      if (!isCurrent()) return;
      const data = res?.data;
      if (data?.isSuccess) {
        checkData = data.data as BulkClaimCheckResponse;
        setResult(checkData);
        setFilter("all");
      } else {
        toast.error(data?.displayMessage || "Failed to parse file");
      }
    } catch (err: any) {
      if (!isCurrent() || controller.signal.aborted) return;
      toast.error(err?.response?.data?.displayMessage || err?.message || "Request failed");
    } finally {
      if (isCurrent()) setChecking(false);
    }

    if (!checkData || !isCurrent()) return;
    const rowsForVerify = buildVerifyPayload(checkData);
    if (rowsForVerify.length === 0) {
      // Nothing to verify — the check surfaced only unmatched rows.
      return;
    }
    setVerifying(true);
    try {
      const res: any = await bulkClaimVerify(rowsForVerify, { signal: controller.signal });
      if (!isCurrent()) return;
      const data = res?.data;
      if (data?.isSuccess) {
        const next = new Map<number, VerifyRow>();
        for (const r of (data.data?.results || []) as VerifyRow[]) {
          next.set(r.rowNumber, r);
        }
        setVerifyByRow(next);
      } else {
        toast.error(data?.displayMessage || "Verify failed");
      }
    } catch (err: any) {
      if (!isCurrent() || controller.signal.aborted) return;
      toast.error(err?.response?.data?.displayMessage || err?.message || "Request failed");
    } finally {
      if (isCurrent()) setVerifying(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f) void runCheckAndVerify(f);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) {
      setFile(f);
      void runCheckAndVerify(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  // `createPayload` still needs to derive from `result` state (for the
  // Create button + count badge) since the drop/browse handlers fire and
  // forget. Keep the same memo shape as before for downstream consumers.
  const verifyPayload = useMemo(
    () => (result ? buildVerifyPayload(result) : []),
    [result],
  );

  // Rows that Verify judged valid AND not filed yet. Feed of the Create
  // action — one createCMS call per row on the BE, sequentially, so the
  // returned per-row outcomes line up with the rowNumbers we render. "Not
  // filed yet" because Force create can run first: a row it already filed
  // must not be offered again.
  const createPayload = useMemo(
    () =>
      verifyPayload.filter((r) => {
        const v = verifyByRow.get(r.rowNumber);
        return v?.isValid === true && !createByRow.has(r.rowNumber);
      }),
    [verifyPayload, verifyByRow, createByRow],
  );

  // AJIO rows whose ONLY verify failure is "Six-side Images (need at least
  // 3)", not filed yet. Force create files them with a PDF of whatever
  // screenshots exist.
  const forcePayload = useMemo(
    () =>
      verifyPayload.filter((r) => {
        if ((r.platform || "").toLowerCase() !== "ajio") return false;
        if (createByRow.has(r.rowNumber)) return false;
        const v = verifyByRow.get(r.rowNumber);
        return !!v && !v.isValid && isSixSideOnlyFailure(v.missingFields);
      }),
    [verifyPayload, verifyByRow, createByRow],
  );

  // Results are MERGED, never replaced: Create and Force create each file a
  // different set of rows, and either may run first.
  const mergeCreateResults = (rows: CreateRow[]) =>
    setCreateByRow((current) => {
      const next = new Map(current);
      for (const r of rows) next.set(r.rowNumber, r);
      return next;
    });

  const handleCreate = async () => {
    if (createPayload.length === 0) {
      toast.error("No verified rows to create");
      return;
    }
    setCreating(true);
    try {
      const res: any = await bulkClaimCreate(createPayload);
      const data = res?.data;
      if (data?.isSuccess) {
        mergeCreateResults((data.data?.results || []) as CreateRow[]);
        // Jump to the Success tab so the operator sees the freshly-
        // created rows first. Failed rows (create errors + unmatched
        // originals) live one click away in the Failed tab.
        setFilter("success");
        toast.success(data.displayMessage || "Create complete");
      } else {
        toast.error(data?.displayMessage || "Create failed");
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.displayMessage || err?.message || "Request failed");
    } finally {
      setCreating(false);
    }
  };

  /**
   * Files the AJIO rows that failed ONLY on the six-side count, with a PDF of
   * the screenshots that exist — fewer than three allowed.
   *
   * The PDFs are built here (the backend's bulk create has no PDF writer and
   * would store a JPEG), three at a time, then the rows go to the same
   * bulk-create endpoint carrying `sixSideImagesKey`. A row whose PDF could not
   * be built is reported failed with that reason and never sent.
   */
  const handleForceCreate = async () => {
    if (forcePayload.length === 0 || forcing) return;
    const session = sessionRef.current;
    const isCurrent = () => sessionRef.current === session;
    setForcing(true);
    try {
      const ready: (typeof forcePayload[number] & { sixSideImagesKey: string })[] = [];
      const broken: CreateRow[] = [];
      let next = 0;

      const worker = async () => {
        while (next < forcePayload.length) {
          const row = forcePayload[next++];
          if (!row) continue;
          try {
            const sixSideImagesKey = await buildForcedSixSidePdf(row.returnGateEntryAwb);
            ready.push({ ...row, sixSideImagesKey });
          } catch (err: any) {
            broken.push({
              rowNumber: row.rowNumber,
              isSuccess: false,
              error: `Six-side PDF: ${err?.message || "could not be built"}`,
            });
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(3, forcePayload.length) }, () => worker()),
      );

      let created: CreateRow[] = [];
      if (ready.length > 0) {
        const res: any = await bulkClaimCreate(ready);
        if (!isCurrent()) return;
        const data = res?.data;
        if (!data?.isSuccess) {
          toast.error(data?.displayMessage || "Force create failed");
          mergeCreateResults(broken);
          return;
        }
        created = (data.data?.results || []) as CreateRow[];
      }

      if (!isCurrent()) return;
      mergeCreateResults([...created, ...broken]);

      const ok = created.filter((r) => r.isSuccess).length;
      const total = forcePayload.length;
      const summary = `Force created ${ok} of ${total} claim${total === 1 ? "" : "s"}`;
      if (ok === total) toast.success(summary);
      else if (ok > 0) toast.info(`${summary} — see the Failed tab for the rest`);
      else toast.error(`${summary} — see the Failed tab`);
    } catch (err: any) {
      if (isCurrent()) toast.error(err?.response?.data?.displayMessage || err?.message || "Request failed");
    } finally {
      if (isCurrent()) setForcing(false);
    }
  };

  // `hasCreateResults` gates the Create → Download PDF button swap and the
  // meaning of the Success/Failed buckets (see filter comment above).
  const hasCreateResults = createByRow.size > 0;

  // Rows shown in the Success bucket. Precedence per row (latest signal
  // wins): createCMS outcome > verify verdict > "still pending". A row
  // with no verify entry yet is treated as pending-success so the table
  // isn't blank while verify is in flight — it flips to Failed the
  // moment verify returns invalid.
  const successRows = useMemo(() => {
    if (!result) return [] as BulkClaimCheckResponse["matched"];
    return result.matched.filter((m) => {
      const c = createByRow.get(m.csvRow.rowNumber);
      if (c) return c.isSuccess === true;
      const v = verifyByRow.get(m.csvRow.rowNumber);
      if (v) return v.isValid;
      return true;
    });
  }, [result, createByRow, verifyByRow]);

  // Rows shown in the Failed bucket. Same precedence as successRows,
  // plus every originally-unmatched CSV row (they can't become claims
  // without a VMS record). Unmatched rows are lifted into the matched
  // shape with an empty vmsList so the table renderer stays uniform.
  const failedRows = useMemo(() => {
    if (!result) return [] as BulkClaimCheckResponse["matched"];
    const unmatchedAsMatched = result.unmatched.map((u) => ({
      csvRow: u.csvRow,
      vmsList: [] as BulkClaimCheckResponse["matched"][number]["vmsList"],
    }));
    const failedMatched = result.matched.filter((m) => {
      const c = createByRow.get(m.csvRow.rowNumber);
      if (c) return c.isSuccess === false;
      const v = verifyByRow.get(m.csvRow.rowNumber);
      return !!v && !v.isValid;
    });
    return [...failedMatched, ...unmatchedAsMatched];
  }, [result, createByRow, verifyByRow]);

  // One wording for every surface — the table, the PDF and the .xlsx — so a
  // reason read on screen is the reason in the file.
  const vmsText = (m: BulkClaimCheckResponse["matched"][number], empty: string): string =>
    m.vmsList.length === 0
      ? empty
      : m.vmsList
          .map((v) => `${getPlatformDisplayName(v.eCommercePlatform)} · ${v.awbNo}`)
          .join(" | ");

  const successCells = (m: BulkClaimCheckResponse["matched"][number]): string[] => {
    const outcome = createByRow.get(m.csvRow.rowNumber);
    // Pre-create a Success row has no outcome yet — it is ready, not failed.
    const statusText = !outcome
      ? "Ready to create"
      : outcome.isSuccess
        ? outcome.cmsId
          ? `Created · ${outcome.cmsId}`
          : "Created"
        : outcome.error || "Failed";
    return [
      String(m.csvRow.rowNumber),
      m.csvRow.returnGateEntryAwb || "",
      m.csvRow.salesChannel || "",
      m.csvRow.qcReason || "",
      vmsText(m, ""),
      statusText,
    ];
  };

  const failedCells = (m: BulkClaimCheckResponse["matched"][number]): string[] => {
    const created = createByRow.get(m.csvRow.rowNumber);
    const verify = verifyByRow.get(m.csvRow.rowNumber);
    const reason = created?.error
      ? created.error
      : verify && !verify.isValid && verify.missingFields.length
        ? `Missing / invalid: ${verify.missingFields.join(", ")}`
        : m.vmsList.length === 0
          ? "Unmatched (no VMS record)"
          : "Failed";
    return [
      String(m.csvRow.rowNumber),
      m.csvRow.returnGateEntryAwb || "—",
      m.csvRow.salesChannel || "",
      m.csvRow.qcReason || "",
      vmsText(m, "—"),
      reason,
    ];
  };

  const exportResultsXlsx = async () => {
    if (successRows.length === 0 && failedRows.length === 0) {
      toast.error("No rows to export");
      return;
    }
    if (exportingXlsx) return;
    setExportingXlsx(true);
    try {
      const saved = await bulkIncreffResults({
        fileStem: file?.name?.replace(/\.[^.]+$/, "") || "bulk-claim",
        success: successRows.map(successCells),
        failed: failedRows.map(failedCells),
      });

      if (saved.success) toast.success("Results saved");
      else if (saved.error.message !== "Cancelled") toast.error(saved.error.message);
    } finally {
      setExportingXlsx(false);
    }
  };

  // Renders a plain, autotable-free PDF using jsPDF's text primitives — we
  // avoid pulling in jspdf-autotable as a new dep. Column widths are
  // hand-tuned for A4 landscape and match the on-screen tables. Success
  // and Failed are emitted as separate sections, each starting on a new
  // page with its own table.
  //
  // Perf notes (5000+ row exports):
  //   • `getTextWidth` calls are the hot loop. The original impl trimmed one
  //     char at a time inside a `while`, so a wide cell measured itself once
  //     per character — O(rows × cols × chars) — and froze the tab.
  //   • The truncation helper below does two things:
  //       (1) memoize by (maxWidth,text) so repeated cell strings (platform
  //           names, dashes, "Created" text) hit the cache after the first row.
  //       (2) binary-search the largest fitting prefix instead of a linear
  //           trim, dropping per-cell measurements from O(n) to O(log n).
  //   • Row emission runs on an async generator that yields to the event loop
  //     every `YIELD_EVERY` rows, keeping the tab interactive on huge exports.
  const downloadResultsPdf = async () => {
    if (successRows.length === 0 && failedRows.length === 0) {
      toast.error("No rows to export");
      return;
    }
    if (generatingPdf) return;
    setGeneratingPdf(true);
    // Yield to the browser between chunks so a big export doesn't monopolize
    // the main thread. 250 rows ≈ one screenful; small enough that clicks +
    // scroll stay responsive, large enough that the setTimeout overhead is
    // negligible against jsPDF's per-row cost.
    const YIELD_EVERY = 250;
    const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0));

    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 32;
      const rowH = 22;
      const now = new Date();

      const successCols = [
        { key: "row", label: "Row #", width: 42 },
        { key: "awb", label: "Return AWB", width: 130 },
        { key: "channel", label: "Sales Channel", width: 110 },
        { key: "qc", label: "QC Reason", width: 150 },
        { key: "vms", label: "VMS Matches", width: 180 },
        { key: "status", label: "Status", width: 140 },
      ];
      const failedCols = [
        { key: "row", label: "Row #", width: 42 },
        { key: "awb", label: "Return AWB", width: 130 },
        { key: "channel", label: "Sales Channel", width: 110 },
        { key: "qc", label: "QC Reason", width: 150 },
        { key: "vms", label: "VMS Matches", width: 160 },
        { key: "reason", label: "Reason", width: 160 },
      ];

      // Truncation helper — see perf notes on `downloadResultsPdf`. Font +
      // size are constant across every cell so the (maxWidth,text) key is
      // sufficient; the ellipsis width is measured once and reused.
      const truncCache = new Map<string, string>();
      const ellipsis = "…";
      const ellipsisWidth = doc.getTextWidth(ellipsis);
      const truncateToWidth = (raw: string, maxWidth: number): string => {
        if (!raw) return raw;
        const cacheKey = `${maxWidth}|${raw}`;
        const cached = truncCache.get(cacheKey);
        if (cached !== undefined) return cached;
        let result: string;
        if (doc.getTextWidth(raw) <= maxWidth) {
          result = raw;
        } else if (maxWidth <= ellipsisWidth) {
          // Column too narrow to even fit the ellipsis — emit whatever
          // single leading char fits, or empty.
          const firstChar = raw[0] ?? "";

          result = firstChar && doc.getTextWidth(firstChar) <= maxWidth ? firstChar : "";
        } else {
          const budget = maxWidth - ellipsisWidth;
          // Largest prefix whose measured width ≤ budget.
          let lo = 0;
          let hi = raw.length;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (doc.getTextWidth(raw.slice(0, mid)) <= budget) lo = mid;
            else hi = mid - 1;
          }
          result = `${raw.slice(0, lo)}${ellipsis}`;
        }
        truncCache.set(cacheKey, result);
        return result;
      };

      const drawSection = async (
        bucket: "success" | "failed",
        rowsForPdf: BulkClaimCheckResponse["matched"],
        isFirst: boolean,
      ) => {
        if (!isFirst) doc.addPage();
        const cols = bucket === "success" ? successCols : failedCols;
        const tableWidth = cols.reduce((a, c) => a + c.width, 0);
        const startX = Math.max(margin, (pageWidth - tableWidth) / 2);
        let y = margin;

        // Section header
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        const title = `Bulk Claim — ${bucket === "success" ? "Success" : "Failed"} (${rowsForPdf.length})`;
        doc.text(title, margin, y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text(
          `Generated ${now.toLocaleString()}${file ? ` · ${file.name}` : ""}`,
          margin,
          y + 14,
        );
        doc.setTextColor(0);
        y += 36;

        const drawHeader = () => {
          doc.setFillColor(240, 245, 247);
          doc.rect(startX, y, tableWidth, rowH, "F");
          doc.setDrawColor(200);
          doc.setLineWidth(0.5);
          doc.rect(startX, y, tableWidth, rowH);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          let x = startX;
          for (const c of cols) {
            doc.text(c.label, x + 4, y + 14);
            x += c.width;
          }
          y += rowH;
        };

        drawHeader();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);

        if (rowsForPdf.length === 0) {
          doc.setTextColor(120);
          doc.text("No rows", startX + 4, y + 14);
          doc.setTextColor(0);
          return;
        }

        for (let idx = 0; idx < rowsForPdf.length; idx++) {
          const m = rowsForPdf[idx];

          if (!m) continue;

          // Page break if we're about to run off the bottom margin. Redraw
          // the same section's table header on the continuation page.
          if (y + rowH > pageHeight - margin) {
            doc.addPage();
            y = margin;
            drawHeader();
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
          }
          doc.setDrawColor(220);
          doc.rect(startX, y, tableWidth, rowH);

          const cells = bucket === "success" ? successCells(m) : failedCells(m);

          let x = startX;
          // Walked by column rather than by cell index, because the column is
          // what carries the width — a cell with no column would have nowhere
          // to be drawn.
          cols.forEach((col, i) => {
            doc.text(truncateToWidth(cells[i] ?? "", col.width - 8), x + 4, y + 14);
            x += col.width;
          });
          y += rowH;

          // Yield periodically so the tab keeps painting. `idx + 1` because
          // we want the yield AFTER the chunk, not before its first row.
          if ((idx + 1) % YIELD_EVERY === 0) {
            await yieldToMain();
          }
        }
      };

      await drawSection("success", successRows, true);
      await drawSection("failed", failedRows, false);

      const fileStem = file?.name?.replace(/\.[^.]+$/, "") || "bulk-claim";
      doc.save(`${fileStem}-results-${now.toISOString().slice(0, 10)}.pdf`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate PDF");
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <Dialog
      open={open}
      fullScreen={fullScreen}
      maxWidth="lg"
      fullWidth
      onClose={handleClose}
      PaperProps={{
        sx: {
          overflow: "hidden",
          bgcolor: "background.paper",
          // Cap dialog height so the sticky header + footer stay in view
          // regardless of how many result rows expand the body. The body
          // Box below carries the overflow.
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.5,
          py: 1.5,
          borderBottom: (t) => `1px solid ${t.palette.divider}`,
          gap: 2,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: "11px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                `linear-gradient(135deg, ${tint('primary.main', 0.10)} 0%, ${tint('primary.light', 0.18)} 100%)`,
              color: "var(--veylix-accent-text)",
            }}
          >
            <CloudUploadOutlined sx={{ fontSize: 18 }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 16, fontWeight: 700, color: "text.primary", lineHeight: 1.2 }}>
              Bulk Claim — Increff
            </Typography>
            <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
              Upload the Increff QC CSV / Excel report. We'll match each row's
              Return AWB against your VMS records.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
        {/* Offered as soon as there is a result — before Create it records
            what will be filed and why the rest will not; after, what was. */}
        {result && (
          <ButtonElement
            variant="tonal"
            color="secondary"
            onClick={() => void exportResultsXlsx()}
            disabled={exportingXlsx || checking || verifying || creating || forcing}
            startIcon={
              exportingXlsx ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <DownloadOutlined sx={{ fontSize: 14 }} />
              )
            }
            sx={{ height: 32, fontSize: 12, fontWeight: 600 }}
          >
            Export result
          </ButtonElement>
        )}
        <ButtonElement
          variant="tonal"
          color="secondary"
          onClick={() => void downloadTemplate()}
          disabled={downloading}
          startIcon={
            downloading ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <DownloadOutlined sx={{ fontSize: 14 }} />
            )
          }
          sx={{ height: 32, fontSize: 12, fontWeight: 600 }}
        >
          Download template
        </ButtonElement>
        <IconButton
          aria-label="close"
          onClick={handleClose}
          size="small"
          sx={{
            border: (t) => `1px solid ${t.palette.divider}`,
            borderRadius: "50%",
            "&:hover": { bgcolor: tint('primary.main', 0.08), borderColor: "primary.main" },
          }}
        >
          <Close sx={{ fontSize: 18 }} />
        </IconButton>
        </Stack>
      </Box>

      {/* Body */}
      <Box
        sx={{
          p: 2.5,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {/* Dropzone — collapses once the pipeline produces a result so
            the results tables get the full body height. The hidden file
            input still needs to live in the tree (any state, all phases)
            so the ref stays wired for programmatic .click() if we ever
            re-expose a "replace file" affordance from the results view. */}
        {!result && (
          <Box
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleBrowse}
            sx={(t) => ({
              border: `1px solid ${
                isDragging ? t.palette.primary.main : t.palette.divider
              }`,
              borderRadius: "11px",
              p: 3,
              cursor: "pointer",
              textAlign: "center",
              background: isDragging
                ? tint('primary.main', 0.06)
                : "var(--veylix-input)",
              transition: "border-color .2s ease, background .2s ease",
              "&:hover": {
                borderColor: t.palette.primary.main,
                background: tint('primary.main', 0.04),
              },
            })}
          >
            <Stack alignItems="center" spacing={1.25}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: "11px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background:
                    `linear-gradient(135deg, ${tint('primary.main', 0.10)} 0%, ${tint('primary.light', 0.18)} 100%)`,
                  color: "var(--veylix-accent-text)",
                }}
              >
                <CloudUploadOutlined sx={{ fontSize: 26 }} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: "text.primary" }}>
                  {file ? "File selected" : "Click to browse or drag-and-drop"}
                </Typography>
                <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.25 }}>
                  {file
                    ? "You can replace the file by clicking again"
                    : `Accepted formats: ${ACCEPT.split(",").join(", ").toUpperCase()}`}
                </Typography>
              </Box>
            </Stack>
          </Box>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          style={{ display: "none" }}
          onChange={handleFileInput}
        />

        {/* Selected file card + inline loader. The Check VMS + Verify
            buttons were removed — check + verify now run automatically as
            soon as a file is selected, so this row only surfaces the file
            metadata and the current stage of the upload pipeline. Hidden
            once results land so the tables get the full body height. */}
        {file && !result && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1.25,
              p: 1.25,
              borderRadius: "11px",
              border: (t) => `1px solid ${t.palette.divider}`,
              bgcolor: "background.default",
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: "11px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: tint('primary.main', 0.10),
                  color: "var(--veylix-accent-text)",
                  flexShrink: 0,
                }}
              >
                <InsertDriveFileOutlined sx={{ fontSize: 18 }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "text.primary",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {file.name}
                </Typography>
                <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                  {(file.size / 1024).toFixed(1)} KB
                </Typography>
              </Box>
            </Stack>
            {(checking || verifying) && (
              <Stack direction="row" alignItems="center" spacing={1}>
                <CircularProgress size={16} color="primary" />
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  {checking ? "Checking VMS…" : "Verifying rows…"}
                </Typography>
              </Stack>
            )}
          </Box>
        )}

        {/* Results */}
        {result && (
          <Stack spacing={1.5}>
            {/* Filter tabs + PDF download. Tab labels flip based on
                `hasCreateResults`:
                  • before Create → Total / Matched / Unmatched
                  • after Create  → Total / Success / Failed (counted from
                    the per-row create outcome)
                The PDF download is only offered post-create, keyed on the
                current tab (Success or Failed). "All" and "Total" tabs
                don't get a download — bucket-specific exports keep the
                downstream sheet focused. */}
            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              useFlexGap
              alignItems="center"
              sx={{ width: "100%" }}
            >
              {(
                [
                  {
                    key: "all",
                    label: "Total rows",
                    count: result.totalRows,
                    color: "var(--veylix-accent-text)",
                  },
                  {
                    key: "success",
                    label: "Success",
                    count: successRows.length,
                    color: "success.main",
                  },
                  {
                    key: "failed",
                    label: "Failed",
                    count: failedRows.length,
                    color: "warning.main",
                  },
                ] as {
                  key: "all" | "success" | "failed";
                  label: string;
                  count: number;
                  color: string;
                }[]
              ).map(({ key, label, count, color }) => {
                const isActive = filter === key;
                return (
                  <Box
                    key={key}
                    onClick={() => setFilter(key as typeof filter)}
                    sx={{
                      cursor: "pointer",
                      px: 1.5,
                      py: 0.5,
                      borderRadius: "11px",
                      border: (t) =>
                        `1px solid ${isActive ? t.palette.primary.main : t.palette.divider}`,
                      bgcolor: isActive ? tint('primary.main', 0.08) : "background.paper",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 0.75,
                      transition: "background .15s ease, border-color .15s ease",
                      "&:hover": !isActive
                        ? { borderColor: "primary.main", background: tint('primary.main', 0.04) }
                        : undefined,
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: isActive ? "primary.main" : "text.secondary",
                      }}
                    >
                      {label}
                    </Typography>
                    <Box
                      sx={{
                        minWidth: 22,
                        height: 20,
                        px: 0.75,
                        borderRadius: "10px",
                        bgcolor: color,
                        color: "common.white",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {count}
                    </Box>
                  </Box>
                );
              })}
              {/* PDF download button lives in the footer post-create,
                  not up here — keeps the tab row focused on filtering. */}
            </Stack>

            {/* Success / Failed table. Same table shell in every phase;
                content is derived from the filter and the bucketing memos
                above. Pre-create Success = matched rows; post-create
                Success = matched rows that created successfully. Same for
                Failed (with unmatched rows folded in). "All" stacks both
                buckets vertically. */}
            {successRows.length > 0 && (filter === "all" || filter === "success") && (
              <Box>
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "success.main",
                    mb: 0.75,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  Success ({successRows.length})
                </Typography>
                <TableContainer
                  sx={{
                    border: (t) => `1px solid ${t.palette.divider}`,
                    borderRadius: "11px",
                    // Height caps at ~5 dense rows + sticky header — anything
                    // beyond that scrolls in-place so long sheets don't push
                    // the modal off-screen.
                    maxHeight: 260,
                  }}
                >
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {/* Position within this list. Distinct from "Row #",
                            which is the line number in the uploaded sheet and
                            is therefore non-contiguous once rows split across
                            the success / failed tables. */}
                        <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 48 }}>#</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Row #</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Return AWB</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Sales Channel</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>QC Reason</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VMS Matches</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 96 }}>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {successRows.map((m, index) => {
                        const verify = verifyByRow.get(m.csvRow.rowNumber);
                        const created = createByRow.get(m.csvRow.rowNumber);
                        return (
                        <TableRow key={`${m.csvRow.rowNumber}-${m.csvRow.returnGateEntryAwb}`}>
                          <TableCell sx={{ fontSize: 12, color: "text.secondary" }}>
                            {index + 1}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{m.csvRow.rowNumber}</TableCell>
                          <TableCell sx={{ fontSize: 12, fontFamily: "monospace" }}>
                            {m.csvRow.returnGateEntryAwb}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{m.csvRow.salesChannel}</TableCell>
                          <TableCell sx={{ fontSize: 12 }}>{m.csvRow.qcReason}</TableCell>
                          <TableCell>
                            <Stack spacing={0.5}>
                              {m.vmsList.map((v) => (
                                <Stack
                                  key={v._id}
                                  direction="row"
                                  spacing={0.75}
                                  alignItems="center"
                                >
                                  <PlatformIcon name={v.eCommercePlatform} size={16} />
                                  <Typography sx={{ fontSize: 12 }}>
                                    {getPlatformDisplayName(v.eCommercePlatform)}
                                  </Typography>
                                  <Typography
                                    sx={{ fontSize: 12, fontFamily: "monospace", color: "text.secondary" }}
                                  >
                                    · {v.awbNo}
                                  </Typography>
                                  <Box
                                    sx={{
                                      px: 0.75,
                                      height: 18,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      borderRadius: "9px",
                                      border: (t) => `1px solid ${t.palette.divider}`,
                                      bgcolor: "background.paper",
                                      fontSize: 11,
                                      fontWeight: 600,
                                      color: "text.secondary",
                                    }}
                                  >
                                    {v.orderType}
                                  </Box>
                                </Stack>
                              ))}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            {created ? (
                              // Create outcome takes precedence over the
                              // verify state — once the operator hit Create,
                              // that's the final word for this row until they
                              // re-verify.
                              created.isSuccess ? (
                                <Tooltip
                                  title={
                                    created.cmsId
                                      ? `Created · CMS id ${created.cmsId}`
                                      : "Created"
                                  }
                                  arrow
                                >
                                  <CheckCircle sx={{ fontSize: 20, color: "success.main" }} />
                                </Tooltip>
                              ) : (
                                <Tooltip
                                  title={created.error || "Create failed"}
                                  arrow
                                >
                                  <InfoOutlined sx={{ fontSize: 20, color: "error.main" }} />
                                </Tooltip>
                              )
                            ) : !verify ? (
                              // Not verified yet — neutral marker so the
                              // column is never blank before the user acts.
                              <Tooltip title="Click Verify to check this row" arrow>
                                <HelpOutline sx={{ fontSize: 18, color: "text.disabled" }} />
                              </Tooltip>
                            ) : verify.isValid ? (
                              <Tooltip
                                title={
                                  verify.resolvedTypeOfClaim
                                    ? `Ready · resolved claim: ${verify.resolvedTypeOfClaim}`
                                    : "Ready"
                                }
                                arrow
                              >
                                <CheckCircle sx={{ fontSize: 20, color: "success.main" }} />
                              </Tooltip>
                            ) : (
                              <Tooltip
                                title={
                                  <Box>
                                    <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.5 }}>
                                      Missing / invalid:
                                    </Typography>
                                    <Box component="ul" sx={{ pl: 2, m: 0 }}>
                                      {verify.missingFields.map((f, i) => (
                                        <li key={i}>
                                          <Typography sx={{ fontSize: 12 }}>{f}</Typography>
                                        </li>
                                      ))}
                                    </Box>
                                  </Box>
                                }
                                arrow
                              >
                                <InfoOutlined sx={{ fontSize: 20, color: "warning.main" }} />
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {/* Failed table — same layout as Success, populated from the
                `failedRows` memo. Includes originally-unmatched CSV rows
                (rendered with an empty VMS Matches cell) so the operator
                sees every row that will NOT become a claim in one place. */}
            {failedRows.length > 0 && (filter === "all" || filter === "failed") && (
              <Box>
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "warning.main",
                    mb: 0.75,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  Failed ({failedRows.length})
                </Typography>
                <TableContainer
                  sx={{
                    border: (t) => `1px solid ${t.palette.divider}`,
                    borderRadius: "11px",
                    maxHeight: 260,
                  }}
                >
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {/* See the note on the success table — position in this
                            list, not the sheet's line number. */}
                        <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 48 }}>#</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Row #</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Return AWB</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Sales Channel</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>QC Reason</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VMS Matches</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 220 }}>
                          Reason
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {failedRows.map((m, index) => {
                        const created = createByRow.get(m.csvRow.rowNumber);
                        // Reason precedence: create error > verify missing
                        // fields > "Unmatched (no VMS)" fallback.
                        const verify = verifyByRow.get(m.csvRow.rowNumber);
                        const reason = created?.error
                          ? created.error
                          : verify && !verify.isValid && verify.missingFields.length
                            ? `Missing / invalid: ${verify.missingFields.join(", ")}`
                            : m.vmsList.length === 0
                              ? "Unmatched (no VMS record)"
                              : "Failed";
                        return (
                          <TableRow
                            key={`f-${m.csvRow.rowNumber}-${m.csvRow.returnGateEntryAwb}`}
                          >
                            <TableCell sx={{ fontSize: 12, color: "text.secondary" }}>
                              {index + 1}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {m.csvRow.rowNumber}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12, fontFamily: "monospace" }}>
                              {m.csvRow.returnGateEntryAwb || "—"}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {m.csvRow.salesChannel}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {m.csvRow.qcReason}
                            </TableCell>
                            <TableCell>
                              {m.vmsList.length === 0 ? (
                                <Typography sx={{ fontSize: 12, color: "text.disabled" }}>
                                  —
                                </Typography>
                              ) : (
                                <Stack spacing={0.5}>
                                  {m.vmsList.map((v) => (
                                    <Stack
                                      key={v._id}
                                      direction="row"
                                      spacing={0.75}
                                      alignItems="center"
                                    >
                                      <PlatformIcon name={v.eCommercePlatform} size={16} />
                                      <Typography sx={{ fontSize: 12 }}>
                                        {getPlatformDisplayName(v.eCommercePlatform)}
                                      </Typography>
                                      <Typography
                                        sx={{
                                          fontSize: 12,
                                          fontFamily: "monospace",
                                          color: "text.secondary",
                                        }}
                                      >
                                        · {v.awbNo}
                                      </Typography>
                                    </Stack>
                                  ))}
                                </Stack>
                              )}
                            </TableCell>
                            <TableCell sx={{ fontSize: 12, color: "warning.main" }}>
                              {reason}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

          </Stack>
        )}
      </Box>

      {/* Footer */}
      <Box
        sx={{
          px: 2.5,
          py: 1.5,
          borderTop: (t) => `1px solid ${t.palette.divider}`,
          display: "flex",
          justifyContent: "flex-end",
          gap: 1,
        }}
      >
        {/* Footer actions.
              • Force create (Failed tab only): files the AJIO rows whose only
                verify failure is the six-side count, with a PDF of whatever
                screenshots exist.
              • Create Claims: while verified rows remain unfiled.
              • Download PDF: once anything has been created — Success and
                Failed on separate pages, whatever tab is active. */}
        {filter === "failed" && forcePayload.length > 0 && (
          <Tooltip title="Creates the AJIO claims that failed only on 'Six-side Images (need at least 3)', using a PDF of the screenshots available — even fewer than 3.">
            <span>
              <ButtonElement
                variant="tonal"
                color="warning"
                onClick={() => void handleForceCreate()}
                disabled={forcing || checking || verifying || creating}
                startIcon={forcing ? <CircularProgress size={14} color="inherit" /> : undefined}
                sx={{ minWidth: 150, height: 32, fontSize: 12, fontWeight: 600 }}
              >
                {forcing ? "Force creating…" : `Force create (${forcePayload.length})`}
              </ButtonElement>
            </span>
          </Tooltip>
        )}
        {hasCreateResults && (
          <ButtonElement
            variant={createPayload.length > 0 ? "tonal" : "contained"}
            color={createPayload.length > 0 ? "secondary" : "primary"}
            onClick={() => void downloadResultsPdf()}
            disabled={generatingPdf}
            startIcon={
              generatingPdf ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <DownloadOutlined sx={{ fontSize: 14 }} />
              )
            }
            // A contained button takes its text colour from the theme's
            // contrast pair; forcing white breaks on a light primary.
            sx={{ minWidth: 150, height: 32, fontSize: 12, fontWeight: 600 }}
          >
            {generatingPdf ? "Generating…" : "Download PDF"}
          </ButtonElement>
        )}
        {(!hasCreateResults || createPayload.length > 0) && (
        <ButtonElement
          variant="contained"
          onClick={() => void handleCreate()}
          disabled={checking || verifying || creating || forcing || createPayload.length === 0}
          sx={{ minWidth: 130, height: 32, fontSize: 12, fontWeight: 600 }}
        >
          {creating ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            `Create Claims${createPayload.length > 0 ? ` (${createPayload.length})` : ""}`
          )}
        </ButtonElement>
        )}
        <ButtonElement
          variant="tonal"
                color="secondary"
          onClick={handleClose}
          sx={{ minWidth: 90, height: 32, fontSize: 12, fontWeight: 600, color: "gray", borderColor: "gray" }}
        >
          Close
        </ButtonElement>
      </Box>
    </Dialog>
  );
};

export default BulkClaimModal;
