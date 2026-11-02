import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the YouTube Downloader module
 * (android/app/src/main/java/com/rnboilerplate/ytdownload/YouTubeDownloaderModule.kt).
 *
 * Only the utility feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 *
 * Event (DeviceEventEmitter): `YouTubeDownloadEvent` {type, body: JSON} —
 * progress | completed | failed | cancelled.
 * JSON shapes are parsed and validated in services/youtube.ts.
 */
export interface Spec extends TurboModule {
  /** JSON {id, url, title, author, durationSec, thumbnail, video: Option[], audio: Option[]}. Rejects with an error code. */
  getVideoInfo(url: string): Promise<string>;
  /** Starts the download in the background service; resolves the job id. Rejects `busy` while one runs. */
  startDownload(url: string, optionId: string): Promise<string>;
  cancelDownload(): void;
  /** JSON of the running download, or '' when idle. */
  getActiveDownload(): Promise<string>;
  /** JSON array of finished downloads, newest first. */
  listDownloads(): Promise<string>;
  /** Removes the entry; with deleteFile also deletes the saved file. */
  removeDownload(id: string, deleteFile: boolean): Promise<boolean>;
  /** Opens the file in a player app; false when none can open it. */
  openDownload(id: string): Promise<boolean>;
  shareDownload(id: string): Promise<boolean>;
}

export default TurboModuleRegistry.get<Spec>('YouTubeDownloader');
