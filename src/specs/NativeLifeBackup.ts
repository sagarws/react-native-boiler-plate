import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Manage Life backup module
 * (android/app/src/main/java/com/rnboilerplate/lifebackup/LifeBackupModule.kt).
 *
 * Only the life feature's service layer may import this file. Android only:
 * on iOS (and under Jest) the module is absent and `get` returns null.
 * Sheets JSON: `[{name, rows: [[cell…]…]}]`, cells string | number | null.
 */
export interface Spec extends TurboModule {
  /**
   * Asks where to save (system "Save to" screen) and writes the sheets as an
   * .xlsx workbook. Resolves true when written, false when cancelled.
   */
  saveWorkbook(fileName: string, sheetsJson: string): Promise<boolean>;
  /**
   * Reads a private copy of a picked .xlsx (then deletes the copy) and
   * resolves its sheets JSON. Rejects `not_xlsx` / `too_large`.
   */
  readWorkbook(uri: string): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('LifeBackup');
