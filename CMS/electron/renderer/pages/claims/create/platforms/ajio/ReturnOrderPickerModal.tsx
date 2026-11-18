import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Radio,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { AjioReturnOrderLine } from "@shared/types/masterDataReport";

interface Props {
  open: boolean;
  returnOrderNo: string;
  lines: AjioReturnOrderLine[];
  onConfirm: (line: AjioReturnOrderLine) => void;
  onCancel: () => void;
}

/**
 * Which line of a multi-line AJIO return order this claim is about.
 *
 * A return order can carry several articles, each with its own EAN and —
 * occasionally — its own AWB or POB. The form holds one of each, so when AJIO
 * answers with more than one line the operator picks. Cancel is always there:
 * nothing is written to the form until a line is chosen, so backing out leaves
 * it exactly as it was.
 */
const ReturnOrderPickerModal = ({ open, returnOrderNo, lines, onConfirm, onCancel }: Props) => {
  const [selected, setSelected] = useState<number | null>(null);

  // A fresh answer is a fresh choice — never carry a pick over from the
  // previous return order.
  useEffect(() => {
    if (open) setSelected(null);
  }, [open, lines]);

  const detail = (label: string, value: string | null) => (
    <Typography variant="body2" color="text.secondary" component="span">
      {label}{" "}
      <Typography variant="body2" color="text.primary" component="span">
        {value || "—"}
      </Typography>
    </Typography>
  );

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === "backdropClick") return;
        onCancel();
      }}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle sx={{ pb: 1, fontWeight: 700 }}>
        {returnOrderNo} has {lines.length} lines
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
          Choose the article this claim is for. Its return AWB, forward AWB,
          EAN and POB ID are filled into the form.
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {lines.map((line, idx) => (
            <Box
              key={`${line.returnAwbNo ?? ""}-${line.ean ?? ""}-${idx}`}
              onClick={() => setSelected(idx)}
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 1,
                border: "1px solid",
                borderColor: selected === idx ? "primary.main" : "divider",
                borderRadius: 1,
                px: 1,
                py: 1,
                cursor: "pointer",
              }}
            >
              <Radio checked={selected === idx} onChange={() => setSelected(idx)} size="small" />
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  columnGap: 2,
                  rowGap: 0.5,
                  minInlineSize: 0,
                  flex: 1,
                }}
              >
                {detail("EAN", line.ean)}
                {detail("POB", line.pobId)}
                {detail("Return AWB", line.returnAwbNo)}
                {detail("Forward AWB", line.fwdAwbNo)}
                {detail("Jio code", line.jioCode)}
                {/* The customer's own order number. Shown because it is the
                    one identifier an operator may be holding from the buyer's
                    side, which makes it the thing that tells two lines of the
                    same return order apart. */}
                {detail("Customer order", line.custOrderNo)}
                {detail("Status", line.returnStatus)}
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="tonal" color="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={selected === null}
          onClick={() => {
            const line = selected === null ? undefined : lines[selected];
            if (line) onConfirm(line);
          }}
        >
          Use this line
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReturnOrderPickerModal;
