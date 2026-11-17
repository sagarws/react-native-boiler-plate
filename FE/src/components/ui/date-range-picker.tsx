"use client";

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { useDismiss } from "@/components/ui/use-dismiss";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface DatePreset {
  label: string;
  compute: () => DateRange;
}

/** Same quick ranges as TrackVid-FE `DateRangeFilter` (sidebar list). */
export const defaultDatePresets: DatePreset[] = [
  { label: "Today", compute: () => ({ startDate: startOfDay(new Date()), endDate: new Date() }) },
  { label: "Yesterday", compute: () => ({ startDate: startOfDay(subDays(new Date(), 1)), endDate: startOfDay(subDays(new Date(), 1)) }) },
  { label: "Last 7 days", compute: () => ({ startDate: startOfDay(subDays(new Date(), 6)), endDate: new Date() }) },
  {
    label: "Last week",
    compute: () => ({
      startDate: startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }),
      endDate: endOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }),
    }),
  },
  { label: "This Month", compute: () => ({ startDate: startOfMonth(new Date()), endDate: new Date() }) },
  {
    label: "Last Month",
    compute: () => ({ startDate: startOfMonth(subMonths(new Date(), 1)), endDate: endOfMonth(subMonths(new Date(), 1)) }),
  },
  { label: "All Time", compute: () => ({ startDate: new Date(2024, 9, 25), endDate: new Date() }) },
];

export function formatRange(r: DateRange | null): string {
  if (!r) return "All dates";
  return isSameDay(r.startDate, r.endDate)
    ? format(r.startDate, "dd MMM yyyy")
    : `${format(r.startDate, "dd MMM yyyy")} – ${format(r.endDate, "dd MMM yyyy")}`;
}

function MonthGrid({
  month,
  start,
  end,
  minDate,
  maxDate,
  onPick,
  onPrev,
  onNext,
}: {
  month: Date;
  start: Date | null;
  end: Date | null;
  minDate?: Date;
  maxDate?: Date;
  onPick: (d: Date) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const first = startOfWeek(startOfMonth(month));
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const today = new Date();
  return (
    <div className="tv-calendar">
      <div className="tv-calendar-head">
        {onPrev ? (
          <button type="button" onClick={onPrev} aria-label="Previous month">
            <Icon name="caret-left" />
          </button>
        ) : (
          <span style={{ width: 28 }} />
        )}
        <span>{format(month, "MMMM yyyy")}</span>
        {onNext ? (
          <button type="button" onClick={onNext} aria-label="Next month">
            <Icon name="caret-right" />
          </button>
        ) : (
          <span style={{ width: 28 }} />
        )}
      </div>
      <div className="tv-calendar-grid" role="grid" aria-label={format(month, "MMMM yyyy")}>
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <span key={d}>{d}</span>
        ))}
        {days.map((d) => {
          const outside = !isSameMonth(d, month);
          const disabled = (minDate && isBefore(d, startOfDay(minDate))) || (maxDate && isAfter(startOfDay(d), maxDate));
          const edge = (start && isSameDay(d, start)) || (end && isSameDay(d, end));
          const inRange = start && end && isAfter(d, start) && isBefore(d, end);
          return (
            <button
              key={d.toISOString()}
              type="button"
              disabled={Boolean(disabled) || outside}
              className={`${outside ? "is-outside" : ""} ${edge ? "is-edge" : ""} ${inRange ? "in-range" : ""} ${isSameDay(d, today) ? "is-today" : ""}`
                .replace(/\s+/g, " ")
                .trim()}
              aria-pressed={Boolean(edge)}
              aria-label={format(d, "dd MMMM yyyy")}
              onClick={() => onPick(d)}
            >
              {format(d, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Template period-menu style trigger + popover with presets and a two-month calendar. */
export function DateRangePicker({
  value,
  onChange,
  presets = defaultDatePresets,
  minDate = new Date(2024, 9, 25),
  maxDate = new Date(),
  allowClear = false,
  align = "right",
  label = "Date range",
}: {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  presets?: readonly DatePreset[];
  minDate?: Date;
  maxDate?: Date;
  allowClear?: boolean;
  align?: "left" | "right";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<Date | null>(value?.startDate ?? null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(value?.endDate ?? null);
  const [month, setMonth] = useState<Date>(startOfMonth(subMonths(value?.endDate ?? new Date(), 1)));
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, wrapRef, close);

  const openPicker = () => {
    setDraftStart(value?.startDate ?? null);
    setDraftEnd(value?.endDate ?? null);
    setMonth(startOfMonth(subMonths(value?.endDate ?? new Date(), 1)));
    setOpen(true);
  };

  const pick = (d: Date) => {
    if (!draftStart || draftEnd) {
      setDraftStart(d);
      setDraftEnd(null);
    } else if (isBefore(d, draftStart)) {
      setDraftEnd(draftStart);
      setDraftStart(d);
    } else {
      setDraftEnd(d);
    }
  };

  const activePreset = value
    ? presets.find((p) => {
        const r = p.compute();
        return isSameDay(r.startDate, value.startDate) && isSameDay(r.endDate, value.endDate);
      })?.label
    : undefined;

  return (
    <div className="tv-popover-wrap" ref={wrapRef}>
      <button type="button" className="secondary-button tv-date-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : openPicker())}>
        <Icon name="calendar" />
        <span>{activePreset ?? formatRange(value)}</span>
        <Icon name="caret-down" />
      </button>
      {open ? (
        <div className={`tv-popover ${align === "left" ? "align-left" : ""}`.trim()} role="dialog" aria-label={label}>
          <div className="tv-daterange">
            <div className="tv-daterange-presets">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={activePreset === p.label ? "is-active" : undefined}
                  onClick={() => {
                    onChange(p.compute());
                    close();
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="tv-calendars">
              <MonthGrid
                month={month}
                start={draftStart}
                end={draftEnd}
                minDate={minDate}
                maxDate={maxDate}
                onPick={pick}
                onPrev={() => setMonth((m) => subMonths(m, 1))}
              />
              <MonthGrid
                month={addMonths(month, 1)}
                start={draftStart}
                end={draftEnd}
                minDate={minDate}
                maxDate={maxDate}
                onPick={pick}
                onNext={() => setMonth((m) => addMonths(m, 1))}
              />
            </div>
            <div className="tv-daterange-foot">
              {allowClear ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    onChange(null);
                    close();
                  }}
                >
                  Clear
                </button>
              ) : null}
              <button type="button" className="secondary-button" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!draftStart}
                onClick={() => {
                  if (draftStart) onChange({ startDate: draftStart, endDate: draftEnd ?? draftStart });
                  close();
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
