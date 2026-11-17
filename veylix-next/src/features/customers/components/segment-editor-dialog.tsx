// @ts-nocheck
import { useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import {
  buildSegmentRuleDraft,
  segmentRuleConditions,
} from "@/features/customers/lib/segment-rules";
import { showToast } from "@/lib/events";
import { findRecord } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

export function SegmentEditorDialog({ recordId, onClose, onSaved }) {
  const r = recordId ? findRecord("segments", recordId) : void 0;
  const [i, a] = useState(String(r?.name || ""));
  const [o, s] = useState(String(r?.logic || "Match all rules"));
  const [c, u] = useState(() => buildSegmentRuleDraft(r));
  const [d, f] = useState("");
  const p = (e, t, n) => {
    u((r) =>
      r.map((r, i) =>
        i === e
          ? {
              ...r,
              [t]: n,
            }
          : r,
      ),
    );
  };
  return (
    <AppDialog
      title={
        recordId
          ? `Edit segment · ${String(r?.name || "")}`
          : "Create customer segment"
      }
      onClose={onClose}
      wide
      className="ops-detail-dialog"
    >
      <form
        className="c-form"
        data-c-form="segment-rules"
        data-id={recordId || ""}
        onSubmit={(a) => {
          a.preventDefault();
          f("");
          const s = c
            .map((e) => ({
              condition: e.condition.trim(),
              value: e.value.trim(),
            }))
            .filter((e) => e.condition && e.value);
          if (!s.length) f("Add at least one complete segment rule.");
          else if (!i.trim()) f("Segment name is required.");
          else
            try {
              saveRecord(
                "segments",
                {
                  name: i.trim(),
                  logic: o,
                  condition: s[0].condition,
                  value: s[0].value,
                  rules: s,
                  rulesText: s
                    .map((e) => `${e.condition}: ${e.value}`)
                    .join(" · "),
                  status: String(r?.status || "Active"),
                },
                recordId,
              );
              onSaved();
              onClose();
              showToast(
                recordId
                  ? "Segment rules updated."
                  : "Dynamic segment created.",
              );
            } catch (e) {
              f(
                e instanceof Error
                  ? e.message
                  : "The segment could not be saved.",
              );
            }
        }}
      >
        <fieldset>
          <legend>Audience definition</legend>
          <div className="c-form-grid">
            <label className="c-field">
              <span>Segment name *</span>
              <input
                name="name"
                value={i}
                required
                maxLength={120}
                onChange={(e) => a(e.currentTarget.value)}
              />
            </label>
            <label className="c-field">
              <span>Rule logic *</span>
              <select
                name="logic"
                required
                value={o}
                onChange={(e) => s(e.currentTarget.value)}
              >
                <option>Match all rules</option>
                <option>Match any rule</option>
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Rules</legend>
          <div className="segment-rule-editor">
            {c.map((e, t) => (
              <div key={t} className="segment-rule-editor-row">
                <label className="c-field">
                  <span>
                    {"Condition "}
                    {t + 1}
                    {t === 0 ? " *" : ""}
                  </span>
                  <select
                    name={`condition${t + 1}`}
                    required={t === 0}
                    value={e.condition}
                    onChange={(e) => p(t, "condition", e.currentTarget.value)}
                  >
                    <option value="">
                      {t === 0 ? "Choose condition" : "No additional rule"}
                    </option>
                    {segmentRuleConditions.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="c-field">
                  <span>
                    {"Value "}
                    {t + 1}
                    {t === 0 ? " *" : ""}
                  </span>
                  <input
                    name={`value${t + 1}`}
                    required={t === 0}
                    value={e.value}
                    placeholder="Rule value"
                    onChange={(e) => p(t, "value", e.currentTarget.value)}
                  />
                </label>
              </div>
            ))}
          </div>
        </fieldset>
        <p className="c-form-error" role="alert">
          {d}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            {recordId ? "Save segment" : "Create segment"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
