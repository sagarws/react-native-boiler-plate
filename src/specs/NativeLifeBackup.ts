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
  /** "Save to…" for a text file (planner-only JSON export). */
  saveText(fileName: string, mimeType: string, content: string): Promise<boolean>;
  /** Opens a private app file (attachment) in a viewer app. */
  openFile(uri: string, mimeType: string): Promise<boolean>;
  /**
   * Full backup: writes [entriesJson] ([{path, text} | {path, file}]) plus
   * manifest.json (the given manifest + file sizes and SHA-256s) as a .zip
   * where the user chooses. Resolves false when cancelled.
   */
  saveZip(fileName: string, manifestJson: string, entriesJson: string): Promise<boolean>;
  /**
   * Validates and reads a picked .zip; attachments go to a staging folder.
   * JSON {stageId, manifest, texts, files, checksumErrors}. Rejects
   * not_zip / unsafe_entry / duplicate_entry / too_large / no_manifest / bad_manifest.
   */
  readZip(uri: string): Promise<string>;
  /** Keeps staged attachments; JSON {stagedUri: permanentUri}. */
  adoptStaged(stageId: string): Promise<string>;
  /**
   * Replaces the Long-Term Planner reminders (keys "plan:…") with the JSON
   * array [{key, at, title, body, link}]; Follow Up reminders are untouched.
   * Resolves how many were armed, or -1 when notifications are blocked.
   */
  syncPlannerReminders(json: string): Promise<number>;
  /** Deletes staged attachments (restore cancelled). */
  discardStaged(stageId: string): void;
}

export default TurboModuleRegistry.get<Spec>('LifeBackup');
