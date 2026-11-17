import { endOfDay, startOfDay } from "date-fns";
import type { DateRange } from "@/components/ui/date-range-picker";
import type { StatusTone } from "@/components/ui/status-pill";
import type { EmailRow, EmailStatus, MailFetchFolder, MailboxStatus } from "@/types/emails";

/** Pure helpers ported from TrackVid `EmailInbox.tsx`, `manualFixRules.ts` and `IntegrationsSettings.tsx`. */

export const PAGE_SIZE = 10;
export const PAGE_SIZES = [10, 20, 25, 50, 100] as const;
export const RETRY_BULK_MAX = 100;
/** TrackVid reads `VITE_APP_MAX_EMAIL_RETRIES` (default 5). */
export const MAX_RETRY_ATTEMPTS = Number(process.env.NEXT_PUBLIC_MAX_EMAIL_RETRIES ?? "") || 5;
/** TrackVid `VITE_APP_SINGLE_EMAIL_POLLING`: on in the mock UI so Sync and the last-sync editor show. */
export const SINGLE_EMAIL_POLLING_ENABLED = (process.env.NEXT_PUBLIC_SINGLE_EMAIL_POLLING ?? "true").trim().toLowerCase() === "true";

export const statusLabels: Record<EmailStatus, string> = {
  new: "New",
  fetched: "Fetched",
  replied: "Auto Replied",
  manually_replied: "Manually replied",
  error: "Error",
};

export const statusTones: Record<EmailStatus, StatusTone> = {
  new: "blue",
  fetched: "amber",
  replied: "green",
  manually_replied: "green",
  error: "red",
};

export const mailboxStatusTones: Record<MailboxStatus, StatusTone> = {
  connected: "green",
  error: "red",
  token_expired: "amber",
};

export const getUserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Old engines without Intl time zones: the BE treats UTC as the default.
    return "UTC";
  }
};

/** Local time with its UTC offset, e.g. `2026-11-17T10:30:00+05:30` (what the BE expects). */
export const formatDateWithTimezone = (date: Date): string => {
  const tz = -date.getTimezoneOffset();
  const pad = (n: number) => String(n).padStart(2, "0");
  const sign = tz >= 0 ? "+" : "-";
  const offset = `${sign}${pad(Math.floor(Math.abs(tz) / 60))}:${pad(Math.abs(tz) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`;
};

/**
 * Pending starts on "All Time", Replied on today (TrackVid initial filters). "All Time" ends at the end
 * of today (TrackVid used "now") so emails that arrive while the page is open still show up.
 */
export const initialPendingRange = (): DateRange => ({ startDate: new Date(2024, 9, 25), endDate: endOfDay(new Date()) });
export const initialRepliedRange = (): DateRange => ({ startDate: startOfDay(new Date()), endDate: endOfDay(new Date()) });

export const retriesExhausted = (email: EmailRow): boolean =>
  typeof email.retryAttempts === "number" && email.retryAttempts >= MAX_RETRY_ATTEMPTS;

export const renderMetaValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    // Circular objects cannot be stringified; show a placeholder instead.
    return "[object]";
  }
};

// ─── Manual fix rules (TrackVid manualFixRules.ts) ─────────────────────────

/** Failure codes a missing AWB link or video explains — the ones worth fixing by hand. */
export const FIXABLE_ERROR_CODES = new Set(["order_not_found", "order_identifier_missing", "video_not_found"]);

const FIXABLE_MESSAGE_PATTERNS = [/unable to locate order/i, /unable to determine order identifier/i, /video is not found/i];

export const isFixableFailure = (errorCode?: string | null, errorMessage?: string | null): boolean => {
  if (errorCode) return FIXABLE_ERROR_CODES.has(errorCode);
  return !!errorMessage && FIXABLE_MESSAGE_PATTERNS.some((p) => p.test(errorMessage));
};

/** Mirrors the BE rule: AJIO only accepts https://drive.google.com links. */
export const isGoogleDriveLink = (raw: string): boolean => {
  const value = raw.trim();
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "drive.google.com" && url.pathname.length > 1;
  } catch {
    // Not a parseable URL, so not a Drive link.
    return false;
  }
};

// ─── Mailboxes (TrackVid IntegrationsSettings.tsx) ─────────────────────────

export const MAIL_FETCH_FOLDER_LABELS: Record<MailFetchFolder, string> = {
  inbox: "Inbox",
  allMail: "All Mail (incl. archived)",
};

export const MAIL_FETCH_FOLDER_HELP =
  "Which folder the automation searches. Pick All Mail when a Gmail filter archives AJIO mail — archived mail is not in the Inbox, so an Inbox-only search returns nothing.";

export const readErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

/** ISO → the `YYYY-MM-DDTHH:mm` shape `<input type="datetime-local">` needs, in local time. */
export const toDateTimeLocalValue = (iso?: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** Why a chosen "last synced at" is refused ("" when acceptable; empty clears the watermark). */
export const validateLastSyncValue = (value: string, mailboxCreatedAt: string): string => {
  if (!value) return "";
  const chosen = new Date(value);
  if (Number.isNaN(chosen.getTime())) return "Enter a valid date and time.";
  if (chosen.getTime() > Date.now()) return "Last sync date cannot be in the future.";
  if (mailboxCreatedAt) {
    const connectedAt = new Date(mailboxCreatedAt);
    if (!Number.isNaN(connectedAt.getTime()) && chosen.getTime() < connectedAt.getTime()) {
      return `This mailbox was connected on ${connectedAt.toLocaleString()}. Mail from before that is never fetched, so the date cannot be earlier.`;
    }
  }
  return "";
};
