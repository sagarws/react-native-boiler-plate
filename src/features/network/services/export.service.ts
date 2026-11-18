import type { CapturedRequest, NetworkExport } from '../types';
import { networkRepository } from '../repository/network.repository';
import { parseUrl } from '../utils/url';
import { generateCurl } from './curl';
import { redactRecord } from './redact';

/**
 * NetworkExportService: one UTF-8 JSON array of captured calls, in the
 * capture schema (no wrapper object; the site and date are in the file name), redacted unless the user opted in. Records are read and
 * prepared in small chunks, yielding between them, so a large export doesn't
 * freeze the UI.
 */

const CHUNK = 40;
const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** A record as it may leave the app: redaction + matching cURL. */
export function prepareForExport(
  record: CapturedRequest,
  includeSensitive: boolean,
): CapturedRequest {
  const safe = redactRecord(record, includeSensitive);
  return { ...safe, curl: generateCurl(record, includeSensitive) };
}

/** Most common page origin + '/', or null when there are no records. */
export function websiteOf(records: readonly CapturedRequest[]): string | null {
  const counts = new Map<string, number>();
  for (const r of records) {
    const origin = parseUrl(r.pageUrl)?.origin;
    if (origin) counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  counts.forEach((count, origin) => {
    if (count > max) {
      best = origin;
      max = count;
    }
  });
  return best ? `${best}/` : null;
}

/** `seller.snapdeal.com` → `snapdeal`; `foo.co.in` → `foo`. */
export function siteLabel(website: string | null): string {
  const host = website ? parseUrl(website)?.hostname ?? '' : '';
  if (!host) return 'all';
  if (/^\d+(\.\d+){3}$/.test(host) || host === 'localhost') {
    return host.replace(/[^a-z0-9]+/g, '-');
  }
  const labels = host.split('.');
  // Two short final labels (co.in, com.au, gov.uk) form one public suffix.
  const suffixLength =
    labels.length > 2 &&
    labels[labels.length - 1].length <= 3 &&
    labels[labels.length - 2].length <= 3
      ? 2
      : 1;
  const name = labels[labels.length - suffixLength - 1] ?? labels[0];
  return name.replace(/[^a-z0-9-]+/g, '-') || 'site';
}

export function exportFileName(website: string | null, at: Date): string {
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(at.getDate()).padStart(2, '0')}`;
  return `network-capture-${siteLabel(website)}-${date}.json`;
}

export interface ExportResult {
  fileName: string;
  json: string;
  count: number;
}

/**
 * Builds the export for [ids] (newest first, as listed), or every record
 * when [ids] is null. Missing/damaged records are skipped.
 */
export async function buildExport(
  ids: readonly string[] | null,
  includeSensitive: boolean,
  at: Date = new Date(),
): Promise<ExportResult> {
  const wanted = ids ?? networkRepository.summaries().map(s => s.id);
  const requests: CapturedRequest[] = [];
  for (let i = 0; i < wanted.length; i += CHUNK) {
    for (const id of wanted.slice(i, i + CHUNK)) {
      const record = networkRepository.get(id);
      if (record) requests.push(prepareForExport(record, includeSensitive));
    }
    if (i + CHUNK < wanted.length) await yieldToUi();
  }
  const website = websiteOf(requests);
  const doc: NetworkExport = requests;
  await yieldToUi();
  return {
    fileName: exportFileName(website, at),
    json: JSON.stringify(doc, null, 2),
    count: requests.length,
  };
}
