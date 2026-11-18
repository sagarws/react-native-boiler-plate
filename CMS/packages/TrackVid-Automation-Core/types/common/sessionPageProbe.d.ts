export namespace PAGE_PROBES {
    namespace tatacliq {
        function script(): string;
        function read(value: any): boolean;
    }
    namespace ajio {
        export function script_1(extras: any): string;
        export { script_1 as script };
        export function read_1(value: any): boolean;
        export { read_1 as read };
    }
}
/** Is there an in-page check for this platform? */
export function hasPageProbe(platform: any): boolean;
/**
 * The script to evaluate, or null when it cannot be built yet.
 *
 * @param {string} platform
 * @param {Record<string, unknown>} [extras] whatever the capture has read so far
 */
export function pageProbeScript(platform: string, extras?: Record<string, unknown>): any;
/**
 * Read what the script resolved to.
 *
 * @returns {true|false|null}
 */
export function readPageProbe(platform: any, value: any): true | false | null;
