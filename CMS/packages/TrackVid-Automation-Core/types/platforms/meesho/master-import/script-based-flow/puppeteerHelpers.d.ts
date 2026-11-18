export const TEMP_FILE_PATH: string;
/**
 * Remove all files from the meesho tempFiles directory.
 * Idempotent — guarded against re-entry.
 */
export function cleanupTempFiles(): Promise<void>;
export function setupCleanupOnInterrupt(): void;
export function removeOrphanFile(filePath: any): void;
import { enableStealthMode } from "../../common/browserHelpers";
import { handleDialog } from "../../common/browserHelpers";
/**
 * Close the post-login advertisement popup if it appears.
 */
export function handleAdvertisementPopup(page: any): Promise<void>;
export { enableStealthMode, handleDialog };
