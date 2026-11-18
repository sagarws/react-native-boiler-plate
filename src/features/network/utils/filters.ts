import type { CallFilter, CallSummary, CapturedBody } from '../types';

/** Status class used by filters, badges and colours. */
export type StatusClass =
  | 'pending'
  | 'failed'
  | 'success'
  | 'redirect'
  | 'clientError'
  | 'serverError'
  | 'info'
  | 'unknown';

export function statusClass(
  s: Pick<CallSummary, 'status' | 'error' | 'pending'>,
): StatusClass {
  if (s.pending) return 'pending';
  if (s.error) return 'failed';
  const code = s.status;
  if (code === null) return 'unknown';
  if (code >= 500) return 'serverError';
  if (code >= 400) return 'clientError';
  if (code >= 300) return 'redirect';
  if (code >= 200) return 'success';
  return 'info';
}

export function matchesFilter(s: CallSummary, filter: CallFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'success':
    case 'clientError':
    case 'serverError':
    case 'failed':
      return statusClass(s) === filter;
    default:
      return s.method === filter;
  }
}

/**
 * Search over URL, endpoint, method and status. Every whitespace-separated
 * term must match (case-insensitive).
 */
export function matchesSearch(s: CallSummary, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${s.method} ${s.status ?? ''} ${s.url}`.toLowerCase();
  return terms.every(term => hay.includes(term));
}

export function filterCalls(
  calls: readonly CallSummary[],
  filter: CallFilter,
  query: string,
): CallSummary[] {
  return calls.filter(s => matchesFilter(s, filter) && matchesSearch(s, query));
}

/** Readable text for a body: pretty JSON, text as-is, form fields listed. */
export function bodyToText(body: CapturedBody | null): string {
  if (!body) return '';
  switch (body.kind) {
    case 'json':
      try {
        return JSON.stringify(body.value, null, 2);
      } catch {
        return String(body.value);
      }
    case 'text':
      return typeof body.value === 'string' ? body.value : '';
    case 'formData':
      return Array.isArray(body.value)
        ? body.value
            .map(e => {
              const entry = e as {
                name: string;
                value: string | null;
                fileName?: string;
              };
              return `${entry.name}=${
                entry.value ?? `<file ${entry.fileName ?? ''}>`
              }`;
            })
            .join('\n')
        : '';
    case 'binary':
      return typeof body.value === 'string' ? body.value : '';
    default:
      return typeof body.value === 'string' ? body.value : '';
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDurationMs(ms: number | null): string {
  if (ms === null) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}
