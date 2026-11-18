/**
 * The `browser-id` for this session, or "" when the jar does not carry one.
 *
 * @param {object|Array} jar  the stored cookie jar, in either shape this
 *   package uses: a `{ name: value }` map, or an array of `{ name, value }`.
 * @returns {string}
 */
export function browserId(jar: object | any[]): string;
/** The header, ready to spread — empty when there is nothing to send. */
export function browserIdHeader(jar: any): {
    "browser-id": string;
} | {
    "browser-id"?: undefined;
};
