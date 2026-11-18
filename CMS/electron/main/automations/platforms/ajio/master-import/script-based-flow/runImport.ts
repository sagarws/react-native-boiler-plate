import {
  runAjioMasterImport,
  type MasterImportInput,
  type MasterImportOutcome
} from '../common/runImport'

/**
 * AJIO master import — script-based flow.
 *
 * Fetches each chunk by clicking View → Export on the Reports page and watching
 * the download directory. This is what the API flow replaced in July 2026,
 * kept as a real second path so `apiBasedAutomation.ajio = false` means
 * something — and because a portal change that breaks one fetch rarely breaks
 * the other.
 */
export const runAjioMasterImportByScript = (
  input: MasterImportInput,
  onProgress?: (message: string) => void
): Promise<MasterImportOutcome[]> => runAjioMasterImport('script', input, onProgress)

export type { MasterImportInput, MasterImportOutcome }
