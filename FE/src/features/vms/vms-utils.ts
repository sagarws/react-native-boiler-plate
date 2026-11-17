import { format, isValid } from "date-fns";
import { buildZip, fetchForZip, resolveFileUrl } from "@/features/cms/cms-files";
import type { VmsOrder } from "@/types/vms";

/** TrackVid `convertKBtoMB` (sizes are stored in KB). */
export function convertKBtoMB(value: number | null | undefined): string {
  const val = Number(value ?? 0) / 1024;
  return `${val.toFixed(2)} MB`;
}

/** TrackVid `secondsToTime`: `0h 1m 12s`. */
export function secondsToTime(seconds: number | null | undefined): string {
  const s = Number(seconds ?? 0);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = Math.ceil(s % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

const DISPLAY_NAME_OVERRIDES: Record<string, string> = { nykaa: "Nykaa Fashion" };

/** TrackVid `getPlatformDisplayName` ("Nykaa" → "Nykaa Fashion"). */
export function getPlatformDisplayName(name?: string | null): string {
  if (!name) return "";
  const raw = name.trim();
  return DISPLAY_NAME_OVERRIDES[raw.toLowerCase()] ?? raw;
}

/** The BE sometimes sends malformed timestamps; every format call is guarded (TrackVid `isValidDate`). */
export function safeFormat(value: string | null | undefined, pattern: string, fallback = ""): string {
  if (!value) return fallback;
  const d = new Date(value);
  return isValid(d) ? format(d, pattern) : fallback;
}

/** Copy/Download/Favorite are disabled for a deleted row and for a GOOD return (TrackVid rule). */
export function isLockedRow(row: VmsOrder): boolean {
  return row.isDeleted || (row.orderType === "Return" && row.orderCondition === 1);
}

export { resolveFileUrl };

/** TrackVid `handleDownloadAllResources`: video + screenshots in `<trackingId>/` inside `<trackingId>.zip`. */
export async function buildResourcesZip(order: VmsOrder): Promise<Blob | null> {
  const items: { name: string; key: string }[] = [];
  if (order.key) items.push({ name: `${order.orderType} Video`, key: order.key });
  order.screenshots.forEach((s, i) => items.push({ name: `Screenshot ${i + 1}`, key: s.url }));
  if (!items.length) return null;
  const files = await Promise.all(items.map((it) => fetchForZip(`${order.trackingId}/${it.name}`, it.key)));
  return buildZip(files);
}

export { buildZip, fetchForZip };
