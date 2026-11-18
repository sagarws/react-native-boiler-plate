/**
 * One claim, per platform, step by step.
 *
 * @type {Record<string, Record<string, string>>}
 */
export const CLAIM_STEPS: Record<string, Record<string, string>>;
/** The steps for one platform, in order. Empty for a platform with no entry. */
export function claimSteps(platform: any): {
    key: string;
    description: string;
}[];
