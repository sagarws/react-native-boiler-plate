/**
 * @param {Array<{name: string, value: string}>} jar
 * @returns {{ csrfToken?: string, error?: string }}
 */
export function fromJar(jar: Array<{
    name: string;
    value: string;
}>): {
    csrfToken?: string;
    error?: string;
};
export const CSRF_COOKIE_NAME: "XyZ7pQ9rS2T1uV8wA3bC6dE4fG0h";
export const CSRF_PATTERN: RegExp;
export declare let platform: string;
export declare let required: string[];
