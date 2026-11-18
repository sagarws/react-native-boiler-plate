export function isEnabled(): boolean;
export function saveClaimResource({ srcPath, companyId, companyName, awbNumber, filename }?: {}): Promise<string>;
export function saveReportResource({ srcPath, companyId, companyName, direction, filename }?: {}): Promise<string>;
export function resolveCompanyLabel({ companyId, companyName }?: {}): Promise<any>;
declare function sanitizePathSegment(value: any, fallback?: string): string;
declare function sanitizeFilename(value: any, fallback?: string): string;
declare function todayLocalDate(): string;
declare const ROOT_DIR: string;
export declare namespace _internals {
    export { sanitizePathSegment };
    export { sanitizeFilename };
    export { todayLocalDate };
    export { ROOT_DIR };
}
export {};
