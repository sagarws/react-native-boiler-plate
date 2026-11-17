import { format } from "date-fns";
import type { StatusTone } from "@/components/ui/status-pill";
import { toast } from "@/lib/events";
import { SUPPORT_ALLOWED_MIME, SUPPORT_MAX_FILE_SIZE, SUPPORT_MAX_FILES } from "@/services/supportChat-service";
import type { SupportTicketStatus } from "@/types/support";

/** TrackVid `statusMeta`: label + colour per ticket status. */
export function statusMeta(status: SupportTicketStatus | string): { tone: StatusTone; label: string } {
  const map: Record<SupportTicketStatus, { tone: StatusTone; label: string }> = {
    OPEN: { tone: "blue", label: "Open" },
    ASSIGNED: { tone: "amber", label: "In progress" },
    RESOLVED: { tone: "green", label: "Resolved" },
    REOPENED: { tone: "red", label: "Reopened" },
  };
  return map[status as SupportTicketStatus] ?? { tone: "blue", label: status };
}

export const statusFilterOptions = (["OPEN", "ASSIGNED", "RESOLVED", "REOPENED"] as const).map((s) => ({ value: s, label: statusMeta(s).label }));

export const isImageMime = (mime: string): boolean => Boolean(mime?.startsWith("image/"));
export const isPdfMime = (mime: string): boolean => mime === "application/pdf";

/** TrackVid `dayLabelFor`: Today / Yesterday / "Monday, Nov 3". */
export function dayLabelFor(date: Date): string {
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return format(date, "EEEE, MMM d");
}

/** TrackVid `handlePickFiles`: PNG/JPG/WEBP/PDF only, 10 MB max, at most 5 files kept (toasts for rejects). */
export function pickValidFiles(selected: readonly File[], current: readonly File[]): File[] {
  const valid: File[] = [];
  selected.forEach((f) => {
    if (!(SUPPORT_ALLOWED_MIME as readonly string[]).includes(f.type)) {
      toast.error(`${f.name}: only PNG/JPG/WEBP/PDF allowed`);
      return;
    }
    if (f.size > SUPPORT_MAX_FILE_SIZE) {
      toast.error(`${f.name}: too large (max 10 MB)`);
      return;
    }
    valid.push(f);
  });
  return [...current, ...valid].slice(0, SUPPORT_MAX_FILES);
}

export const SUPPORT_ACCEPT = SUPPORT_ALLOWED_MIME.join(",");
