// @ts-nocheck
import { dashboardPeriods } from "@/data/dashboard";

export function findPeriodOption(e = "30") {
  return (
    dashboardPeriods.find((t) => t.id === String(e)) || dashboardPeriods[1]
  );
}
