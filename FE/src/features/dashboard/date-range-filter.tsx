"use client";

import { DateRangePicker, defaultDatePresets, type DatePreset } from "@/components/ui/date-range-picker";
import { computePreset, OUTER_PRESETS, tagRange } from "@/features/dashboard/dashboard-helpers";
import type { DateRangeValue } from "@/types/dashboard";

/**
 * Sidebar ranges of the custom picker: the shared `defaultDatePresets`, except "Last week" which
 * TrackVid computes Monday → Sunday (the shared preset uses Sunday-start weeks).
 */
const PICKER_PRESETS: readonly DatePreset[] = defaultDatePresets.map((p) =>
  p.label === "Last week"
    ? {
        label: p.label,
        compute: () => {
          const r = computePreset("lastWeek");
          return { startDate: r.startDate, endDate: r.endDate };
        },
      }
    : p,
);

/** TrackVid `DateRangeFilter`: four preset pills + a custom-range picker (two months, quick ranges). */
export function DateRangeFilter({ value, onChange }: { value: DateRangeValue; onChange: (next: DateRangeValue) => void }) {
  const customActive = value.preset === "custom" || value.preset === "allTime";

  return (
    <div className="tv-dash-range" role="group" aria-label="Date range">
      {OUTER_PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          className="tv-dash-pill"
          aria-pressed={value.preset === p.key}
          onClick={() => onChange(computePreset(p.key))}
        >
          {p.label}
        </button>
      ))}
      <span className={`tv-dash-custom ${customActive ? "is-active" : ""}`.trim()}>
        <DateRangePicker
          value={{ startDate: value.startDate, endDate: value.endDate }}
          presets={PICKER_PRESETS}
          label="Custom date range"
          onChange={(r) => {
            if (r) onChange(tagRange(r.startDate, r.endDate));
          }}
        />
      </span>
    </div>
  );
}
