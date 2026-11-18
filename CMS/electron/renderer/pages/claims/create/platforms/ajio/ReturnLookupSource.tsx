import { ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import type { ReturnLookupSourceValue } from "../../types";

/**
 * Where the Return Order Number lookup reads from.
 *
 * TWO SOURCES ANSWER THE SAME QUESTION and neither is right for every claim,
 * which is why this is a control and not a setting:
 *
 *   API     asks AJIO now. Always current, and the only source that can chase a
 *           missing forward AWB or find an order filed under another account —
 *           but it needs a signed-in browser and walks a month of pages per
 *           window, so a miss is slow.
 *   Report  reads what the nightly AJIO report sync already downloaded.
 *           Instant, no login, no network — and blind to anything created since
 *           the last sync, or older than the backup goes.
 *
 * NEVER BOTH AT ONCE. A toggle that fell back from one to the other would make
 * "not found" mean two different things and hide which source answered — and
 * the difference matters: not in the backup is a sync problem, not on AJIO is a
 * wrong number.
 */
const ReturnLookupSource = ({
  value,
  onChange,
}: {
  value: ReturnLookupSourceValue;
  onChange: (next: ReturnLookupSourceValue) => void;
}) => (
  <Tooltip
    title={
      value === "api"
        ? "Return Order Number is looked up on AJIO now — current, but slower"
        : "Return Order Number is read from this machine's AJIO report backup — instant, but only as new as the last sync"
    }
  >
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      aria-label="Return order lookup source"
      // An empty value means the operator pressed the button already selected.
      // Ignored rather than cleared: there is no "neither" for this choice.
      onChange={(_event, next: ReturnLookupSourceValue | null) => {
        if (next) onChange(next);
      }}
      sx={{ height: 34 }}
    >
      <ToggleButton value="api" sx={{ px: 1.5, fontSize: 12, fontWeight: 600 }}>
        API
      </ToggleButton>
      <ToggleButton value="report" sx={{ px: 1.5, fontSize: 12, fontWeight: 600 }}>
        Report
      </ToggleButton>
    </ToggleButtonGroup>
  </Tooltip>
);

export default ReturnLookupSource;
