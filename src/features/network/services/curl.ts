import type { CapturedBody, CapturedRequest, FormDataEntry } from '../types';
import { redactRecord } from './redact';

/**
 * CurlGenerator: a POSIX-shell `curl` command for a captured request.
 *
 * Every argument is single-quoted; a `'` inside becomes `'\''`, which is the
 * only escape single quotes need, so `$`, backticks, `!`, newlines and
 * backslashes pass through literally.
 */

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Headers curl sets itself or that would corrupt a replay. */
const SKIP_HEADERS = new Set(['content-length', 'host']);

function isFormData(value: unknown): value is FormDataEntry[] {
  return Array.isArray(value);
}

function bodyArgs(body: CapturedBody | null): {
  args: string[];
  note: string | null;
} {
  if (!body) return { args: [], note: null };
  switch (body.kind) {
    case 'json':
      return {
        args: ['--data-raw', shellQuote(JSON.stringify(body.value))],
        note: body.truncated
          ? 'request body was truncated when captured'
          : null,
      };
    case 'text':
      return {
        args:
          typeof body.value === 'string'
            ? ['--data-raw', shellQuote(body.value)]
            : [],
        note: body.truncated
          ? 'request body was truncated when captured'
          : null,
      };
    case 'formData': {
      if (!isFormData(body.value)) return { args: [], note: null };
      const args: string[] = [];
      for (const entry of body.value) {
        if (entry.value !== null) {
          // --form-string never interprets a leading @ or < as a file.
          args.push(
            '--form-string',
            shellQuote(`${entry.name}=${entry.value}`),
          );
        } else {
          args.push(
            '-F',
            shellQuote(
              `${entry.name}=@${entry.fileName || 'file'}${
                entry.type ? `;type=${entry.type}` : ''
              }`,
            ),
          );
        }
      }
      const hasFiles = body.value.some(e => e.value === null);
      return {
        args,
        note: hasFiles
          ? 'file parts reference local files you must supply'
          : null,
      };
    }
    case 'binary':
      return {
        args: ['--data-binary', '@request-body.bin'],
        note: `binary request body (${
          body.sizeBytes ?? '?'
        } bytes) is not inlined; save it as request-body.bin`,
      };
    default:
      return { args: [], note: 'request body type could not be captured' };
  }
}

/**
 * The command, one option per line. Sensitive values are redacted unless
 * [includeSensitive] — the same rule as copies and exports.
 */
export function generateCurl(
  record: Pick<
    CapturedRequest,
    | 'method'
    | 'url'
    | 'requestHeaders'
    | 'requestBody'
    | 'pageUrl'
    | 'responseHeaders'
    | 'responseBody'
    | 'frameId'
  >,
  includeSensitive: boolean,
): string {
  const safe = redactRecord(record as CapturedRequest, includeSensitive);
  const method = safe.method.toUpperCase();
  const lines: string[] = [`curl ${shellQuote(safe.url)}`];
  const { args, note } = bodyArgs(safe.requestBody);
  // curl defaults to GET, or to POST once a body is given (as Chrome's
  // "Copy as cURL" relies on); any other combination needs -X.
  if (method === 'HEAD') lines.push('--head');
  else if (args.length > 0 ? method !== 'POST' : method !== 'GET') {
    lines.push(`-X ${shellQuote(method)}`);
  }
  // Multipart bodies set their own Content-Type (with the boundary).
  const multipart = safe.requestBody?.kind === 'formData';
  for (const [name, value] of Object.entries(safe.requestHeaders)) {
    const lower = name.toLowerCase();
    if (SKIP_HEADERS.has(lower)) continue;
    if (multipart && lower === 'content-type') continue;
    // Cookies as curl's cookie option, like a browser's "Copy as cURL".
    if (lower === 'cookie') lines.push(`-b ${shellQuote(value)}`);
    else lines.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  }
  for (let i = 0; i < args.length; i += 2) {
    lines.push(`${args[i]} ${args[i + 1]}`);
  }
  const command = lines.join(' \\\n  ');
  return note ? `${command}\n# Note: ${note}` : command;
}
