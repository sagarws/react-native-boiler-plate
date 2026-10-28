import NativeScreenOcr from '@/specs/NativeScreenOcr';

/**
 * Manage Life's bridge to the existing native Gemini client (same key, model
 * and thinking level as Refine/Translation). Lives in capture/services
 * because only this folder may use the native module. The data is the
 * user's own summary; it is never logged.
 */
export type LifeCoachOutcome =
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
  | 'cancelled'
  | 'unsupported';

const OUTCOMES: readonly LifeCoachOutcome[] = [
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
  'cancelled',
];

export interface LifeCoachReply {
  outcome: LifeCoachOutcome;
  /** The model's JSON text when ok. */
  text: string;
  status: number;
  detail: string;
}

export function parseLifeCoachReply(json: string): LifeCoachReply {
  try {
    const r = JSON.parse(json) as Record<string, unknown>;
    const outcome = OUTCOMES.includes(r.outcome as LifeCoachOutcome)
      ? (r.outcome as LifeCoachOutcome)
      : 'bad_response';
    return {
      outcome,
      text: typeof r.text === 'string' ? r.text : '',
      status: typeof r.status === 'number' ? r.status : 0,
      detail: typeof r.detail === 'string' ? r.detail.slice(0, 300) : '',
    };
  } catch {
    return { outcome: 'bad_response', text: '', status: 0, detail: '' };
  }
}

export const lifeCoachService = {
  async recommend(data: string): Promise<LifeCoachReply> {
    if (!NativeScreenOcr)
      return { outcome: 'unsupported', text: '', status: 0, detail: '' };
    try {
      return parseLifeCoachReply(
        await NativeScreenOcr.lifeRecommendations(data),
      );
    } catch {
      return { outcome: 'server', text: '', status: 0, detail: '' };
    }
  },
};
