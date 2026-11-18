import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Radio,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OrderLookupRecord } from "../../api";

interface Props {
  open: boolean;
  records: OrderLookupRecord[];
  /** Previously chosen SKU — preselects the matching row on reopen. */
  currentSku?: string;
  /** Called with the chosen SKU when the user clicks OK. */
  onConfirm: (sku: string) => void;
  /**
   * Safety escape hatch. When provided, renders a "Cancel" button that
   * closes the modal without a pick — the caller decides whether to
   * expose it (e.g. always available on the create form so the operator
   * is never locked in when the record list ends up all-blank).
   */
  onCancel?: () => void;
}

/**
 * AJIO multi-record SKU picker. Renders when /order/{awb} returned >1
 * masterImport rows for the entered AWB so the operator has to disambiguate
 * which record the claim belongs to.
 *
 * Rules (per product):
 *  - No backdrop-dismiss, no Escape-dismiss. Backdrop clicks and Esc are
 *    swallowed so an accidental click can't dismiss the picker.
 *  - Cancel is available via the optional `onCancel` prop (safety valve
 *    when the record set has no pickable SKU; the caller decides whether
 *    to expose it).
 *  - Non-empty SKU rows render the SKU in a disabled input; the row's radio
 *    is always selectable.
 *  - Empty SKU rows render an enabled input; the row's radio is only
 *    selectable once the operator has typed a non-blank SKU into that row.
 *  - Only one radio can be selected at a time.
 *  - OK stays disabled until a valid SKU is chosen.
 */
const EXTRA_ROW_ID = "__ajio-picker-extra__";

const AjioSkuPickerModal = ({ open, records, currentSku, onConfirm, onCancel }: Props) => {
  // Extend the returned records with a single synthetic blank row when none
  // of the master-data rows has an empty SKU. Gives the operator a place to
  // type an SKU that doesn't exist in master data without polluting the
  // upstream list. `records` reference identity is what drives the seeding
  // effect below, so `useMemo` keeps that stable across renders where the
  // underlying `records` prop hasn't changed.
  const effectiveRecords = useMemo<OrderLookupRecord[]>(() => {
    const hasEmpty = records.some((r) => !(r.sku || "").trim());
    if (hasEmpty) return records;
    return [...records, { _id: EXTRA_ROW_ID, sku: "" }];
  }, [records]);

  // Local per-row editable values (indexed 1:1 with `effectiveRecords`).
  // Non-empty rows are seeded from records[i].sku; typed-in SKUs for empty
  // rows persist across close/reopen so the operator can revisit and edit.
  const [values, setValues] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const seededRecordsRef = useRef<OrderLookupRecord[] | null>(null);

  // Seed values on the first open for a given records reference. On
  // subsequent reopens with the same records we preserve whatever the
  // operator typed into empty rows and only recompute the preselection
  // from `currentSku`.
  useEffect(() => {
    if (!open) return;
    let effectiveValues = values;
    if (seededRecordsRef.current !== effectiveRecords) {
      effectiveValues = effectiveRecords.map((r) => r.sku || "");
      setValues(effectiveValues);
      seededRecordsRef.current = effectiveRecords;
    }
    const trimmed = (currentSku || "").trim();
    const preIdx = trimmed
      ? effectiveValues.findIndex((v) => v.trim() === trimmed)
      : -1;
    setSelectedIndex(preIdx >= 0 ? preIdx : null);
    // `values` intentionally omitted — we only want to react to open/records/
    // currentSku transitions, not every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveRecords, currentSku]);

  const isRowSelectable = useMemo(
    () => (idx: number) => (values[idx] || "").trim().length > 0,
    [values],
  );

  const canConfirm =
    selectedIndex !== null && isRowSelectable(selectedIndex);

  const handleValueChange = (idx: number, next: string) => {
    setValues((prev) => {
      const copy = prev.slice();
      copy[idx] = next;
      return copy;
    });
    // If the row currently selected has been cleared, drop the selection so
    // the OK button re-disables.
    if (selectedIndex === idx && !next.trim()) {
      setSelectedIndex(null);
    }
  };

  const handleSelect = (idx: number) => {
    if (!isRowSelectable(idx)) return;
    setSelectedIndex(idx);
  };

  const handleOk = () => {
    if (!canConfirm || selectedIndex === null) return;
    onConfirm((values[selectedIndex] || "").trim());
  };

  return (
    <Dialog
      open={open}
      // No backdrop / escape dismiss — the operator MUST pick a record.
      onClose={(_e, reason) => {
        if (reason === "backdropClick" || reason === "escapeKeyDown") return;
      }}
      disableEscapeKeyDown
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle sx={{ pb: 1, fontWeight: 700 }}>
        Select Seller SKU for this AWB
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
          Select the SKU that this claim belongs to. Rows without an SKU let
          you type one in — the radio becomes selectable once a value is
          entered.
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {effectiveRecords.map((record, idx) => {
            const isEmptyRow = !(record.sku || "").trim();
            const rowValue = values[idx] || "";
            const selectable = isRowSelectable(idx);
            return (
              <Box
                key={record._id || idx}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  border: "1px solid",
                  borderColor:
                    selectedIndex === idx ? "primary.main" : "divider",
                  borderRadius: 1,
                  px: 1,
                  py: 0.5,
                }}
              >
                <Radio
                  checked={selectedIndex === idx}
                  onChange={() => handleSelect(idx)}
                  disabled={!selectable}
                  value={idx}
                />
                <TextField
                  size="small"
                  fullWidth
                  placeholder={
                    isEmptyRow ? "Enter SKU for this record" : ""
                  }
                  value={rowValue}
                  disabled={!isEmptyRow}
                  onChange={(e) => handleValueChange(idx, e.target.value)}
                />
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        {onCancel && (
          <Button variant="tonal"
                color="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="contained"
          onClick={handleOk}
          disabled={!canConfirm}
        >
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AjioSkuPickerModal;
