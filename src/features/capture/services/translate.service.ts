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
  'quota',
  'safety_blocked',
  'server',
  'timeout',
  'bad_response',
];

const NO_KEY: GeminiKeyStatus = { hasKey: false, hint: '' };

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

  async test(): Promise<GeminiTestOutcome> {
    if (!NativeScreenOcr) return 'unsupported';
    try {
      const outcome = await NativeScreenOcr.testGeminiKey();
      return OUTCOMES.includes(outcome as GeminiTestOutcome)
        ? (outcome as GeminiTestOutcome)
        : 'bad_response';
    } catch {
      return 'server';
    }
  },
};
