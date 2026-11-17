// @ts-nocheck
import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { showToast } from "@/lib/events";
import { findRecord } from "@/lib/store/core";
import { addCustomerNote } from "@/lib/store/customers";

export function CustomerNoteDialog({ customerId, onClose, onSaved }) {
  const r = findRecord("customers", customerId);
  const [i, a] = useState("");
  return r ? (
    <AppDialog
      title={`Add note · ${String(r.name || "Customer")}`}
      onClose={onClose}
    >
      <form
        className="c-form customer-note-form"
        data-c-form="customer-note"
        data-id={r.id}
        onSubmit={(e) => {
          e.preventDefault();
          a("");
          try {
            const t = new FormData(e.currentTarget);
            addCustomerNote(r.id, String(t.get("note") || ""));
            onSaved();
            showToast("Customer note saved.");
          } catch (e) {
            a(
              e instanceof Error
                ? e.message
                : "The customer note could not be saved.",
            );
          }
        }}
      >
        <label className="c-field">
          <span>
            {"Internal note "}
            <small>*</small>
          </span>
          <textarea
            name="note"
            rows={5}
            maxLength={2e3}
            required
            placeholder="Add context your team should remember…"
          />
        </label>
        <p>
          Notes are internal to the local demo workspace and are added to the
          customer activity timeline.
        </p>
        <p className="c-form-error" role="alert">
          {i}
        </p>
        <div className="c-form-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Save note
          </button>
        </div>
      </form>
    </AppDialog>
  ) : null;
}
