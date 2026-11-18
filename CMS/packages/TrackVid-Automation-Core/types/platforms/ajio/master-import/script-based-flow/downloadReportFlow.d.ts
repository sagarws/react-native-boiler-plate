export function waitForDownload(downloadPath: any, timeout?: number): Promise<any>;
/**
 * Download ONE date-chunk's report: set dates → click View (with retry on AJIO's
 * intermittent server-side "Request Timed out") → click Export → wait for the file.
 *
 * Shared by the production runScript AND the local test harness so both exercise
 * the exact same View-retry + download logic. Does NOT upload — the caller decides
 * what to do with the downloaded file (prod uploads to TrackVid; test keeps it).
 *
 * @returns {Promise<string|null>} the downloaded filename, or null if the chunk has no data.
 * @throws if AJIO's report generation keeps timing out after MAX_VIEW_RETRIES.
 */
export function downloadReportChunk(page: any, client: any, chunk: any, userLogger: any, { downloadPath }?: {}): Promise<string | null>;
