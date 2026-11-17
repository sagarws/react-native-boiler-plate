"use client";

import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import type { OrderLookupRecord } from "@/types/cms-create";

const EXTRA_ROW_ID = "__ajio-picker-extra__";

/**
 * TrackVid `AjioSkuPickerModal`: the AWB matched several master rows, so the operator picks the SKU this claim is
 * about. Rows without a SKU take a typed value (a synthetic blank row is always offered). No Escape / backdrop
 * close; Cancel defers the pick (skuName stays required on submit).
 */
export function AjioSkuPickerDialog({ records, currentSku, onConfirm, onCancel }: { records: OrderLookupRecord[]; currentSku: string; onConfirm: (sku: string) => void; onCancel: () => void }) {
  const rows = records.some((r) => !(r.sku || "").trim()) ? records : [...records, { _id: EXTRA_ROW_ID, sku: "" }];
  const [values, setValues] = useState<string[]>(() => rows.map((r) => r.sku || ""));
  const [selected, setSelected] = useState<number | null>(() => {
    const t = currentSku.trim();
    const i = t ? rows.findIndex((r) => (r.sku || "").trim() === t) : -1;
    return i >= 0 ? i : null;
  });
  const selectable = (i: number) => (values[i] || "").trim().length > 0;
  const canConfirm = selected !== null && selectable(selected);

  return (
    <AppDialog
      title="Select Seller SKU for this AWB"
      onClose={onCancel}
      locked
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary-button" disabled={!canConfirm} onClick={() => selected !== null && onConfirm((values[selected] || "").trim())}>
            OK
          </button>
        </>
      }
    >
      <p className="tv-muted">Select the SKU that this claim belongs to. Rows without an SKU let you type one in — the radio becomes selectable once a value is entered.</p>
      <div className="tv-stack tv-cmsc-sku-list" role="radiogroup" aria-label="Seller SKU">
        {rows.map((r, i) => {
          const empty = !(r.sku || "").trim();
          return (
            <label key={r._id || i} className={`tv-cmsc-sku-row ${selected === i ? "is-selected" : ""}`}>
              <input type="radio" name="ajio-sku" checked={selected === i} disabled={!selectable(i)} onChange={() => setSelected(i)} />
              <input
                className="tv-input"
                value={values[i] || ""}
                disabled={!empty}
                placeholder={empty ? "Enter SKU for this record" : ""}
                aria-label={empty ? "New SKU" : `SKU ${r.sku}`}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setValues((prev) => prev.map((x, j) => (j === i ? v : x)));
                  if (selected === i && !v.trim()) setSelected(null);
                }}
              />
              {r.pobId ? <span className="tv-small tv-muted">POB {r.pobId}</span> : null}
            </label>
          );
        })}
      </div>
    </AppDialog>
  );
}
