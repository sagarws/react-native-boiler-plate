import { addDays, differenceInCalendarDays, endOfDay, endOfMonth, format, isSameDay, startOfDay, startOfMonth } from "date-fns";
import { ALL_TIME_START } from "@/mocks/dashboard";
import type { DateRangePresetKey, DateRangeValue } from "@/types/dashboard";

/** TrackVid `formatNumber` for counts (en-IN grouping). */
export const formatCount = (n: number): string => n.toLocaleString("en-IN");

/** `yyyy-MM-dd` for the dashboard endpoints (TrackVid `fmtApiDate`). */
export function fmtApiDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Monday of the week containing `d` (TrackVid `previousMonday`). */
function previousMonday(d: Date): Date {
  const c = startOfDay(d);
  const day = c.getDay();
  c.setDate(c.getDate() - (day === 0 ? 6 : day - 1));
  return c;
}

/** Same ranges as TrackVid `DateRangeFilter.computePreset` (weeks start on Monday). */
export function computePreset(preset: DateRangePresetKey): DateRangeValue {
  const today = new Date();
  switch (preset) {
    case "last7":
      return { startDate: startOfDay(addDays(today, -6)), endDate: endOfDay(today), preset };
    case "lastWeek": {
      const monday = previousMonday(today);
      return { startDate: startOfDay(addDays(monday, -7)), endDate: endOfDay(addDays(monday, -1)), preset };
    }
    case "currentMonth":
      return { startDate: startOfMonth(today), endDate: endOfDay(today), preset };
    case "lastMonth": {
      const last = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { startDate: startOfMonth(last), endDate: endOfMonth(last), preset };
    }
    case "allTime":
      return { startDate: startOfDay(ALL_TIME_START), endDate: endOfDay(today), preset };
    case "custom":
    default:
      return { startDate: startOfDay(addDays(today, -6)), endDate: endOfDay(today), preset: "custom" };
  }
}

export const OUTER_PRESETS: readonly { key: Exclude<DateRangePresetKey, "custom" | "allTime">; label: string }[] = [
  { key: "last7", label: "Last 7 days" },
  { key: "lastWeek", label: "Last week" },
  { key: "currentMonth", label: "Current month" },
  { key: "lastMonth", label: "Last month" },
];

const PRESET_LABELS: Record<DateRangePresetKey, string> = {
  last7: "Last 7 days",
  lastWeek: "Last week",
  currentMonth: "Current month",
  lastMonth: "Last month",
  allTime: "All time",
  custom: "Custom range",
};

/** "Showing data for …" label (TrackVid `formatRangeLabel`). */
export function formatRangeLabel(range: DateRangeValue): string {
  if (range.preset !== "custom") return PRESET_LABELS[range.preset];
  return `${format(range.startDate, "dd MMM yyyy")} – ${format(range.endDate, "dd MMM yyyy")}`;
}

/** Tag a picked range with the preset it matches, so pills and label stay in sync (TrackVid `handleRangeChange`). */
export function tagRange(startDate: Date, endDate: Date): DateRangeValue {
  const next = { startDate: startOfDay(startDate), endDate: endOfDay(endDate) };
  const match = (key: DateRangePresetKey) => {
    const c = computePreset(key);
    return isSameDay(c.startDate, next.startDate) && isSameDay(c.endDate, next.endDate);
  };
  const preset = OUTER_PRESETS.find((p) => match(p.key))?.key ?? (match("allTime") ? "allTime" : "custom");
  return { ...next, preset };
}

/** Current window and the same-length window right before it (TrackVid `computePeriods`). */
export function computePeriods(start: Date, end: Date) {
  // Calendar days, so an end-of-day `end` does not round the window up to one extra day.
  const windowDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(windowDays - 1));
  return {
    current: { startDate: fmtApiDate(start), endDate: fmtApiDate(end) },
    previous: { startDate: fmtApiDate(prevStart), endDate: fmtApiDate(prevEnd) },
  };
}

export const safeRate = (num: number, den: number): number | null => (den <= 0 ? null : (num / den) * 100);

export const safePctDelta = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : a - b);

/** TrackVid `getPlatformDisplayName`. */
export function platformDisplayName(name: string): string {
  const raw = name.trim();
  return raw.toLowerCase() === "nykaa" ? "Nykaa Fashion" : raw;
}
