import {
  runAjioMasterImport,
  type MasterImportInput,
  type MasterImportOutcome
} from '../common/runImport'

/**
 * AJIO master import — API-based flow.
 *
 * Fetches each chunk by calling AJIO's download endpoint from INSIDE the
 * logged-in page, so Akamai sees the browser's own HttpOnly bff_session and
 * real TLS fingerprint. That is why this needs a browser despite being the
 * "API" flow — a plain HTTP client is turned away.
 */
export const runAjioMasterImportByApi = (
  input: MasterImportInput,
  onProgress?: (message: string) => void
): Promise<MasterImportOutcome[]> => runAjioMasterImport('api', input, onProgress)

export type { MasterImportInput, MasterImportOutcome }
