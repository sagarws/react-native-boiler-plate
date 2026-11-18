import { Box, LinearProgress, Typography } from "@mui/material";
import { isBusy, useBulkRun } from "./bulkRun";

interface Props {
  /** Reopens the Normal Bulk Claim dialog. */
  onOpen: () => void;
}

/**
 * The bulk run, while its dialog is closed — so a run left going in the
 * background is visible from the page, with its progress, and one click away.
 * Shown while it works and while it waits for review; gone once idle.
 */
const BulkRunIndicator = ({ onOpen }: Props) => {
  const { phase, progress, rows } = useBulkRun();

  if (phase === "idle") return null;

  const ready = rows.filter((row) => row.status === "ready").length;
  const label = isBusy(phase)
    ? (progress?.label ?? "Working…")
    : phase === "review"
      ? `${ready} of ${rows.length} ready — review and Proceed`
      : "Finished — open to see the results";

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
      title="Open the bulk claim"
      sx={{
        cursor: "pointer",
        minWidth: 180,
        maxWidth: 260,
        px: 1.25,
        py: 0.5,
        borderRadius: "6px",
        border: (t) => `1px solid ${t.palette.divider}`,
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      <Typography noWrap sx={{ fontSize: 11, fontWeight: 600, color: "text.secondary" }}>
        Bulk claim · {label}
      </Typography>
      {isBusy(phase) && (
        <LinearProgress
          sx={{ mt: 0.5, height: 3, borderRadius: 2 }}
          variant={progress && progress.total > 0 ? "determinate" : "indeterminate"}
          value={progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
        />
      )}
    </Box>
  );
};

export default BulkRunIndicator;
