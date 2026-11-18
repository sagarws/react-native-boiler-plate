import {
  Box,
  CircularProgress,
  Dialog,
  IconButton,
  LinearProgress,
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
import { useCallback, useMemo, useState } from "react";
import { bulkSheetTemplate } from "@renderer/services/claimCreate.service";
import { accountsFor, useClaimCatalogue } from "../ClaimCatalogue";
import {
  CheckCircle,
  Close,
  CloudUploadOutlined,
  DownloadOutlined,
  EditOutlined,
  HelpOutline,
  InfoOutlined,
  VideocamOffOutlined,
  VideocamOutlined,
} from "../icons";
import PlatformIcon from "../PlatformIcon";
import { tint } from "../tint";
import { toast } from "../toast";
import {
  discardBulkRun,
  isBusy,
  proceedBulkRun,
  reverifyBulkRow,
  startBulkRun,
  useBulkRun,
  type BulkPhase,
} from "./bulkRun";
import EditBulkRowDialog from "./EditBulkRowDialog";
import { platformSheets, templateSpec, type BulkRow } from "./normalBulk";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The feed picked on the page; every claim is filed under it, as Save files one. */
  feedId: string;
}

type Filter = "all" | "ready" | "failed" | "created";

const isFailed = (row: BulkRow) => row.status === "invalid" || row.status === "failed";

/** Can the operator change this row? Not while it is being worked, and not once it is filed. */
const isEditable = (row: BulkRow) =>
  row.status === "invalid" || row.status === "failed" || row.status === "ready";

const PHASE_STEPS: { phase: BulkPhase; label: string }[] = [
  { phase: "refilling", label: "Refill" },
  { phase: "verifying", label: "Verify" },
  { phase: "review", label: "Review" },
  { phase: "creating", label: "Save" },
];

const stepIndex = (phase: BulkPhase): number =>
  phase === "done" ? PHASE_STEPS.length : PHASE_STEPS.findIndex((step) => step.phase === phase);

/**
 * Normal Bulk Claim: the company's own template, one sheet per platform.
 *
 * Upload → REFILL the blanks on rows that carry little more than an AWB (local
 * report backup, then the marketplace) → VERIFY every row against VMS and its
 * platform's rules, filing nothing → REVIEW, where any row that is not ready
 * can be edited and is checked again → PROCEED files the ready rows.
 *
 * THE RUN LIVES IN `bulkRun`, not here: closing this dialog leaves it running,
 * and reopening it shows where it has got to. Discard is the only thing that
 * stops it.
 */
const NormalBulkClaimModal = ({ open, onClose, feedId }: Props) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
  const catalogue = useClaimCatalogue();
  const { phase, rows, fileName, progress } = useBulkRun();
  const [downloading, setDownloading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<BulkRow | null>(null);

  const accountsOf = useCallback(
    (platform: string) => accountsFor(catalogue, platform),
    [catalogue],
  );
  const sheets = useMemo(
    () => platformSheets(catalogue.platforms, accountsOf, catalogue),
    [catalogue.platforms, accountsOf],
  );

  const downloadTemplate = async () => {
    if (sheets.length === 0) {
      toast.error("This company has no platforms to build a template for");
      return;
    }
    setDownloading(true);
    try {
      const result = await bulkSheetTemplate(templateSpec(sheets));

      if (result.success) toast.success("Template saved");
      else if (result.error.message !== "Cancelled") toast.error(result.error.message);
    } finally {
      setDownloading(false);
    }
  };

  const load = (file?: File) => {
    setFilter("all");
    void startBulkRun(file, sheets, accountsOf);
  };

  const readyRows = useMemo(() => rows.filter((row) => row.status === "ready"), [rows]);
  const counts = useMemo(
    () => ({
      all: rows.length,
      ready: readyRows.length,
      failed: rows.filter(isFailed).length,
      created: rows.filter((row) => row.status === "created").length,
    }),
    [rows, readyRows],
  );
  const rowsBusy = rows.some(
    (row) => row.status === "refilling" || row.status === "preparing" || row.status === "creating",
  );

  const visible = rows.filter((row) =>
    filter === "all"
      ? true
      : filter === "ready"
        ? row.status === "ready"
        : filter === "created"
          ? row.status === "created"
          : isFailed(row),
  );

  const busy = isBusy(phase);
  const reading = phase === "reading";

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];

    if (file && !busy) void load(file);
  };

  /** A claim value as the row will file it: the cell, what refill kept, or what verification found. */
  const shown = (row: BulkRow, path: "forwardAWB" | "skuName" | "subOrderNumber") => {
    const column = row.platform.columns.find((entry) => entry.path === path);
    const fromCell = column
      ? Object.entries(row.cells).find(([key]) => key.trim().toLowerCase() === column.header.toLowerCase())?.[1]?.trim()
      : "";
    const value = fromCell || row.refilled?.[path] || (row.values?.[path] as string | undefined) || "";

    return value || "—";
  };

  const refillCell = (row: BulkRow) => {
    if (!row.refill) {
      return <Typography sx={{ fontSize: 12, color: "text.disabled" }}>—</Typography>;
    }
    const { source, filled, message } = row.refill;
    const where = source === "both" ? "backup + marketplace" : source === "local" ? "local backup" : "marketplace";

    return (
      <Tooltip title={message ?? (filled.length > 0 ? `Filled ${filled.join(", ")}` : "Nothing to fill")} arrow>
        <Typography
          sx={{
            fontSize: 12,
            color: filled.length > 0 ? "success.main" : "warning.main",
            whiteSpace: "nowrap",
          }}
        >
          {filled.length > 0 ? `Filled · ${where}` : "Not found"}
        </Typography>
      </Tooltip>
    );
  };

  const statusCell = (row: BulkRow) => {
    switch (row.status) {
      case "pending":
        return (
          <Tooltip title="Waiting to be checked" arrow>
            <HelpOutline sx={{ fontSize: 18, color: "text.disabled" }} />
          </Tooltip>
        );
      case "refilling":
      case "preparing":
      case "creating":
        return (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <CircularProgress size={14} />
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              {row.status === "refilling" ? "Refilling…" : row.status === "preparing" ? "Verifying…" : "Saving…"}
            </Typography>
          </Stack>
        );
      case "ready":
        return (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <CheckCircle sx={{ fontSize: 18, color: "success.main" }} />
            <Typography sx={{ fontSize: 12, color: "success.main" }}>Ready</Typography>
          </Stack>
        );
      case "created":
        return (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <CheckCircle sx={{ fontSize: 18, color: "success.main" }} />
            <Typography sx={{ fontSize: 12, color: "success.main" }}>Created</Typography>
          </Stack>
        );
      default:
        return (
          <Stack direction="row" spacing={0.75} alignItems="flex-start">
            <InfoOutlined
              sx={{
                fontSize: 18,
                mt: "1px",
                color: row.status === "failed" ? "error.main" : "warning.main",
              }}
            />
            <Typography
              sx={{
                fontSize: 12,
                color: row.status === "failed" ? "error.main" : "warning.main",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
              title={row.errors.join("\n")}
            >
              {row.errors.join(" · ") || "Failed"}
            </Typography>
          </Stack>
        );
    }
  };

  return (
    <Dialog
      open={open}
      fullScreen={fullScreen}
      maxWidth="lg"
      fullWidth
      onClose={onClose}
      PaperProps={{
        sx: {
          overflow: "hidden",
          bgcolor: "background.paper",
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
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700, color: "text.primary", lineHeight: 1.2 }}>
            Bulk Claim — Normal
          </Typography>
          <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
            One sheet per platform. Video and images are taken from VMS by Return AWB.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <ButtonElement
            variant="tonal"
            color="secondary"
            onClick={() => void downloadTemplate()}
            disabled={downloading || catalogue.loading}
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
            onClick={onClose}
            size="small"
            sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderRadius: "50%" }}
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
        {rows.length === 0 && (
          <Box
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => !busy && void load()}
            sx={(t) => ({
              border: `1px solid ${isDragging ? t.palette.primary.main : t.palette.divider}`,
              borderRadius: "11px",
              p: 3,
              cursor: busy ? "progress" : "pointer",
              textAlign: "center",
              background: isDragging ? tint("primary.main", 0.06) : "var(--veylix-input)",
              transition: "border-color .2s ease, background .2s ease",
              "&:hover": { borderColor: t.palette.primary.main },
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
                  background: tint("primary.main", 0.1),
                  color: "var(--veylix-accent-text)",
                }}
              >
                {reading ? <CircularProgress size={22} /> : <CloudUploadOutlined sx={{ fontSize: 26 }} />}
              </Box>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: "text.primary" }}>
                {reading ? "Reading the workbook…" : "Click to browse or drag-and-drop the filled template"}
              </Typography>
              <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                Accepted formats: .XLSX, .XLS — download the template above first
              </Typography>
            </Stack>
          </Box>
        )}

        {rows.length > 0 && (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography sx={{ fontSize: 12, color: "text.secondary", mr: 1 }} noWrap>
                {fileName}
              </Typography>
              {(
                [
                  { key: "all", label: "Total rows", count: counts.all, color: "primary.main" },
                  { key: "ready", label: "Ready", count: counts.ready, color: "info.main" },
                  { key: "created", label: "Created", count: counts.created, color: "success.main" },
                  { key: "failed", label: "Failed", count: counts.failed, color: "warning.main" },
                ] as { key: Filter; label: string; count: number; color: string }[]
              ).map(({ key, label, count, color }) => {
                const active = filter === key;

                return (
                  <Box
                    key={key}
                    onClick={() => setFilter(key)}
                    sx={{
                      cursor: "pointer",
                      px: 1.5,
                      py: 0.5,
                      borderRadius: "11px",
                      border: (t) => `1px solid ${active ? t.palette.primary.main : t.palette.divider}`,
                      bgcolor: active ? tint("primary.main", 0.08) : "background.paper",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 0.75,
                    }}
                  >
                    <Typography
                      sx={{ fontSize: 12, fontWeight: 700, color: active ? "primary.main" : "text.secondary" }}
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
            </Stack>

            {phase !== "idle" && phase !== "reading" && (
              <Stack direction="row" spacing={1} alignItems="center">
                {PHASE_STEPS.map((step, index) => {
                  const at = stepIndex(phase);
                  const color = index < at ? "success.main" : index === at ? "primary.main" : "text.disabled";

                  return (
                    <Stack key={step.phase} direction="row" spacing={0.5} alignItems="center">
                      {index > 0 && <Box sx={{ width: 16, height: "1px", bgcolor: "divider" }} />}
                      {index < at ? (
                        <CheckCircle sx={{ fontSize: 14, color }} />
                      ) : (
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color }} />
                      )}
                      <Typography sx={{ fontSize: 12, fontWeight: index === at ? 700 : 500, color }}>
                        {step.label}
                      </Typography>
                    </Stack>
                  );
                })}
              </Stack>
            )}

            {progress && (
              <Box>
                <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 0.5 }}>
                  {progress.label} {progress.total > 0 ? `${progress.done} / ${progress.total}` : ""}
                </Typography>
                <LinearProgress
                  variant={progress.total > 0 ? "determinate" : "indeterminate"}
                  value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
                />
              </Box>
            )}

            <TableContainer
              sx={{
                border: (t) => `1px solid ${t.palette.divider}`,
                borderRadius: "11px",
                maxHeight: "52vh",
              }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 44 }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Platform</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 64 }}>Row #</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Return AWB</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Type Of Claim</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Forward AWB</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>SKU</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Sub-order</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 120 }}>Refill</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 90 }}>VMS</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 260 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, width: 56 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={12} sx={{ fontSize: 12, color: "text.secondary", textAlign: "center" }}>
                        No rows in this view
                      </TableCell>
                    </TableRow>
                  )}
                  {visible.map((row, index) => (
                    <TableRow key={row.id}>
                      <TableCell sx={{ fontSize: 12, color: "text.secondary" }}>{index + 1}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <PlatformIcon name={row.platformLabel} size={16} />
                          <Typography sx={{ fontSize: 12 }}>{row.platformLabel}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{row.rowNumber}</TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: "monospace" }}>{row.awb || "—"}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{row.claimType || "—"}</TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: "monospace" }}>{shown(row, "forwardAWB")}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{shown(row, "skuName")}</TableCell>
                      <TableCell sx={{ fontSize: 12, fontFamily: "monospace" }}>{shown(row, "subOrderNumber")}</TableCell>
                      <TableCell>{refillCell(row)}</TableCell>
                      <TableCell>
                        {row.status === "pending" || row.status === "refilling" || row.status === "preparing" ? (
                          <Typography sx={{ fontSize: 12, color: "text.disabled" }}>—</Typography>
                        ) : (
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Tooltip title={row.videoFound ? "Return video found" : "No return video in VMS"} arrow>
                              {row.videoFound ? (
                                <VideocamOutlined sx={{ fontSize: 16, color: "success.main" }} />
                              ) : (
                                <VideocamOffOutlined sx={{ fontSize: 16, color: "text.disabled" }} />
                              )}
                            </Tooltip>
                            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                              {row.screenshots} img
                            </Typography>
                          </Stack>
                        )}
                      </TableCell>
                      <TableCell>{statusCell(row)}</TableCell>
                      <TableCell>
                        {isEditable(row) && !busy && (
                          <Tooltip title="Edit this row and verify it again" arrow>
                            <IconButton size="small" aria-label="edit row" onClick={() => setEditing(row)}>
                              <EditOutlined sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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
        {busy && (
          <Typography sx={{ fontSize: 11, color: "text.secondary", mr: "auto", alignSelf: "center" }}>
            Runs in the background — close this and reopen Bulk Claim to check on it.
          </Typography>
        )}
        {rows.length > 0 && (
          <ButtonElement
            variant="tonal"
            color="secondary"
            onClick={discardBulkRun}
            sx={{ height: 32, fontSize: 12, fontWeight: 600 }}
          >
            Discard
          </ButtonElement>
        )}
        {rows.length > 0 && (
          <ButtonElement
            variant="tonal"
            color="secondary"
            onClick={() => load()}
            disabled={busy}
            sx={{ height: 32, fontSize: 12, fontWeight: 600 }}
          >
            Upload another file
          </ButtonElement>
        )}
        <ButtonElement
          variant="contained"
          onClick={() => void proceedBulkRun(feedId)}
          disabled={busy || rowsBusy || readyRows.length === 0}
          sx={{ minWidth: 140, height: 32, fontSize: 12, fontWeight: 600 }}
        >
          {phase === "creating" ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            `Proceed${readyRows.length > 0 ? ` (${readyRows.length})` : ""}`
          )}
        </ButtonElement>
        <ButtonElement
          variant="tonal"
          color="secondary"
          onClick={onClose}
          sx={{ minWidth: 90, height: 32, fontSize: 12, fontWeight: 600 }}
        >
          Close
        </ButtonElement>
      </Box>
      <EditBulkRowDialog
        row={editing}
        onClose={() => setEditing(null)}
        onSave={(cells) => {
          const id = editing?.id;

          setEditing(null);
          if (id) void reverifyBulkRow(id, cells, accountsOf);
        }}
      />
    </Dialog>
  );
};

export default NormalBulkClaimModal;
