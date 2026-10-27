import { isOcrMode, type OcrResult } from '../capture.types';

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Validates one result crossing the native bridge or read back from storage.
 * Text is kept byte-for-byte — Devanagari, emoji and line breaks included.
 */
export function parseOcrResult(raw: unknown): OcrResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  if (typeof r.text !== 'string') return null;
  if (!isOcrMode(r.mode)) return null;
  return {
    id: r.id,
    text: r.text,
    mode: r.mode,
    createdAt: finiteNumber(r.createdAt, 0),
    durationMs: Math.max(0, finiteNumber(r.durationMs, 0)),
    ...(typeof r.refined === 'string' && r.refined.length > 0
      ? { refined: r.refined }
      : {}),
    ...(typeof r.translation === 'string' && r.translation.length > 0
      ? {
          translation: r.translation,
          targetLanguage:
            typeof r.targetLanguage === 'string' ? r.targetLanguage : undefined,
          sourceLanguage:
            typeof r.sourceLanguage === 'string' ? r.sourceLanguage : undefined,
        }
      : {}),
    lineCount: Math.max(
      0,
      Math.round(finiteNumber(r.lineCount, r.text.split('\n').length)),
    ),
  };
}

/** Parses a JSON object string; '' or invalid input gives null. */
export function parseOcrResultJson(json: string): OcrResult | null {
  if (!json) return null;
  try {
    return parseOcrResult(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Parses a JSON array string, dropping any malformed entries. */
export function parseOcrResultList(json: string): OcrResult[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseOcrResult).filter((r): r is OcrResult => r !== null);
  } catch {
    return [];
  }
}
