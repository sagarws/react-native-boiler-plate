"use client";

import { useAsync } from "@/lib/use-async";
import { FileService } from "@/services/file-service";

/** Safe http(s) or same-origin URL for media tags; anything else (javascript:, data:) is rejected. */
export function safeMediaUrl(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    // Not a URL at all: treat as "not attached".
    return undefined;
  }
}

/** Resolve a stored file key to a viewable URL (mock of the `/order/view/<key>` proxy). */
export async function resolveFileUrl(key: string): Promise<string> {
  const direct = safeMediaUrl(key);
  if (direct) return direct;
  if (/[\\?#]|\.\./.test(key) || key.trim() !== key) throw new Error("Invalid file key.");
  return (await FileService.getFileUrl(key)).url;
}

export function useFileUrl(key: string | undefined): { url: string | null; loading: boolean } {
  const { data, loading } = useAsync(() => (key ? resolveFileUrl(key) : Promise.resolve("")), [key]);
  return { url: data || null, loading: Boolean(key) && loading };
}

export const isImageKey = (value?: string): boolean => /\.(jpe?g|png|gif|webp|bmp)(\?.*)?$/i.test(value ?? "");

// ----- Minimal ZIP writer (store method, no compression) so "Download All Resources" needs no dependency. -----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a .zip Blob from named files. Folder paths use "/" in the name. */
export async function buildZip(files: readonly { name: string; data: Blob }[]): Promise<Blob> {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = new Uint8Array(await f.data.arrayBuffer());
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts: BlobPart[] = [...locals, ...centrals, end].map((u) => u.slice().buffer);
  return new Blob(parts, { type: "application/zip" });
}

const EXT_BY_MIME: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" };

/** Fetch one resource for the ZIP; a resource that cannot be fetched becomes a small .txt note instead. */
export async function fetchForZip(name: string, key: string): Promise<{ name: string; data: Blob }> {
  try {
    const url = await resolveFileUrl(key);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const mime = (res.headers.get("content-type") ?? blob.type).split(";")[0];
    return { name: `${name}.${EXT_BY_MIME[mime] ?? mime.split("/")[1] ?? "bin"}`, data: blob };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unavailable";
    return { name: `${name}.txt`, data: new Blob([`Could not download "${name}" (${key}): ${reason}`], { type: "text/plain" }) };
  }
}
