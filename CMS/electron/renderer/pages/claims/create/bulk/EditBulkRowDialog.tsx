import {
  Box,
  Dialog,
  MenuItem,
  Stack,
  TextField,
  Typography,
  Button as ButtonElement,
} from "@mui/material";
import { useEffect, useState } from "react";
import { editableCells, type BulkRow } from "./normalBulk";

interface Props {
  row: BulkRow | null;
  onClose: () => void;
  /** The row's cells as edited — the caller checks the row again. */
  onSave: (cells: Record<string, string>) => void;
}

/**
 * One bulk row, as its sheet's columns — for the operator to fix what refill
 * could not fill or verification refused.
 *
 * Every column of the platform's sheet, not just the failing ones: the fix for
 * "no such SKU" is as often the claim type or the account as the SKU itself.
 * A column with fixed values is a picker, so the edit cannot introduce the
 * same "not one of the valid values" it was opened to fix.
 */
const EditBulkRowDialog = ({ row, onClose, onSave }: Props) => {
  const [cells, setCells] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!row) return;
    const next: Record<string, string> = { ...row.cells };

    for (const { column, value } of editableCells(row)) next[column.header] = value;
    setCells(next);
  }, [row]);

  if (!row) return null;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <Box sx={{ px: 2.5, py: 1.5, borderBottom: (t) => `1px solid ${t.palette.divider}` }}>
        <Typography sx={{ fontSize: 18, fontWeight: 750, letterSpacing: "-0.5px" }}>
          Edit {row.platformLabel} row {row.rowNumber}
        </Typography>
        {row.errors.length > 0 && (
          <Typography sx={{ fontSize: 12, color: "warning.dark", mt: 0.5 }}>{row.errors.join(" · ")}</Typography>
        )}
        {row.refill?.message && (
          <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.5 }}>
            Refill: {row.refill.message}
          </Typography>
        )}
      </Box>

      <Stack useFlexGap sx={{ gap: "20px", padding: "24px 24px 20px", maxHeight: "60vh", overflowY: "auto" }}>
        {editableCells(row).map(({ column }) => {
          const value = cells[column.header] ?? "";
          const options = column.options ?? [];
          const change = (next: string) => setCells((current) => ({ ...current, [column.header]: next }));

          return (
            <TextField
              key={column.header}
              label={column.required ? `${column.header} *` : column.header}
              size="small"
              fullWidth
              value={value}
              helperText={column.hint}
              select={options.length > 0}
              onChange={(event) => change(event.target.value)}
            >
              {options.length > 0 && [
                <MenuItem key="" value="">
                  <em>Blank</em>
                </MenuItem>,
                ...options.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                )),
              ]}
            </TextField>
          );
        })}
      </Stack>

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
        <ButtonElement variant="tonal" color="secondary" onClick={onClose} sx={{ height: 32, fontSize: 12, fontWeight: 600 }}>
          Cancel
        </ButtonElement>
        <ButtonElement
          variant="contained"
          onClick={() => onSave(cells)}
          sx={{ height: 32, fontSize: 12, fontWeight: 600 }}
        >
          Save and verify again
        </ButtonElement>
      </Box>
    </Dialog>
  );
};

export default EditBulkRowDialog;
