import NativeScreenOcr from '@/specs/NativeScreenOcr';
import { logger } from '@/shared/utils';

/** What JS may know about the stored key — never the key itself. */
export interface GeminiKeyStatus {
  hasKey: boolean;
  /** Last four characters, for "…abcd". */
  hint: string;
}

export type GeminiTestOutcome =
  | 'ok'
  | 'no_key'
  | 'no_internet'
  | 'invalid_key'
  | 'api_disabled'
  | 'model_not_found'
  | 'quota'
  | 'safety_blocked'
  | 'server'
  | 'timeout'
  | 'bad_response'
  | 'unsupported';

const OUTCOMES: readonly GeminiTestOutcome[] = [
  'ok',
  'no_key',
  'no_internet',
  'invalid_key',
  'api_disabled',
  'model_not_found',
  'quota',
  'safety_blocked',
  'server',
  'timeout',
  'bad_response',
];

const NO_KEY: GeminiKeyStatus = { hasKey: false, hint: '' };

/** A Test connection / model-list result with Google's own explanation. */
export interface GeminiReport {
  outcome: GeminiTestOutcome;
  /** HTTP status, 0 when none. */
  status: number;
  /** Google's error message (redacted natively), or ''. */
  detail: string;
}

export interface GeminiModelInfo {
  id: string;
  displayName: string;
}

function outcomeOf(value: unknown): GeminiTestOutcome {
  return OUTCOMES.includes(value as GeminiTestOutcome)
    ? (value as GeminiTestOutcome)
    : 'bad_response';
}

export function parseReport(json: string): GeminiReport {
  try {
    const r = JSON.parse(json) as Record<string, unknown>;
    return {
      outcome: outcomeOf(r.outcome),
      status: typeof r.status === 'number' ? r.status : 0,
      detail: typeof r.detail === 'string' ? r.detail.slice(0, 300) : '',
    };
  } catch {
    return { outcome: 'bad_response', status: 0, detail: '' };
  }
}

export function parseModels(json: string): GeminiModelInfo[] {
  try {
    const r = JSON.parse(json) as Record<string, unknown>;
    if (!Array.isArray(r.models)) return [];
    return r.models.flatMap(m => {
      const o = (m && typeof m === 'object' ? m : {}) as Record<
        string,
        unknown
      >;
      return typeof o.id === 'string' && /^[A-Za-z0-9._-]+$/.test(o.id)
        ? [
            {
              id: o.id,
              displayName:
                typeof o.displayName === 'string' ? o.displayName : o.id,
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}

export function parseKeyStatus(json: string): GeminiKeyStatus {
  try {
    const r = JSON.parse(json) as Record<string, unknown>;
    return {
      hasKey: r.hasKey === true,
      hint: typeof r.hint === 'string' ? r.hint.slice(-4) : '',
    };
  } catch {
    return NO_KEY;
  }
}

/** Plausibility check before saving (Gemini keys are long, no whitespace). */
export function looksLikeApiKey(value: string): boolean {
  const key = value.trim();
  return key.length >= 20 && key.length <= 512 && !/\s/.test(key);
}

/**
 * The Gemini API key lives only in native, Keystore-encrypted storage. JS
 * hands it over once on save and afterwards only learns whether one exists.
 * Never log it.
 */
export const translateService = {
  async getKeyStatus(): Promise<GeminiKeyStatus> {
    if (!NativeScreenOcr) return NO_KEY;
    try {
      return parseKeyStatus(await NativeScreenOcr.getGeminiKeyStatus());
    } catch (error) {
      logger.error(
        'translate.getKeyStatus failed',
        error instanceof Error ? error.name : 'unknown',
      );
      return NO_KEY;
    }
  },

  async saveKey(apiKey: string): Promise<boolean> {
    if (!NativeScreenOcr || !looksLikeApiKey(apiKey)) return false;
    try {
      return await NativeScreenOcr.setGeminiKey(apiKey.trim());
    } catch {
      // Deliberately not logging the error: it could carry the key.
      return false;
    }
  },

  clearKey(): void {
    NativeScreenOcr?.clearGeminiKey();
  },

  async test(): Promise<GeminiReport> {
    if (!NativeScreenOcr)
      return { outcome: 'unsupported', status: 0, detail: '' };
    try {
      return parseReport(await NativeScreenOcr.testGeminiKey());
    } catch {
      return { outcome: 'server', status: 0, detail: '' };
    }
  },

  /** Models this key can call; empty with the report when listing failed. */
  async listModels(): Promise<{
    report: GeminiReport;
    models: GeminiModelInfo[];
  }> {
    if (!NativeScreenOcr) {
      return {
        report: { outcome: 'unsupported', status: 0, detail: '' },
        models: [],
      };
    }
    try {
      const json = await NativeScreenOcr.listGeminiModels();
      return { report: parseReport(json), models: parseModels(json) };
    } catch {
      return {
        report: { outcome: 'server', status: 0, detail: '' },
        models: [],
      };
    }
  },
};
