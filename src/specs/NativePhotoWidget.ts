import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Photo Widget module
 * (android/app/src/main/java/com/rnboilerplate/photowidget/PhotoWidgetModule.kt).
 *
 * Only the photoWidget feature's service layer may import this file.
 * Android only: on iOS (and under Jest) the module is absent and `get`
 * returns null.
 */
export interface Spec extends TurboModule {
  /**
   * Every photo widget setting as JSON `{widgets: [{id, name, image, imgW,
   * imgH, mode, frameW, frameH, focusX, focusY, zoom, corner, updatedAt,
   * placed}], pinSupported}` (placed = widgets on the home screen showing it).
   */
  list(): Promise<string>;
  /**
   * The system photo picker (no storage permission). The photo is copied
   * upright into private storage; resolves JSON `{path, width, height}`, or
   * '' when cancelled. Rejects `import_failed`.
   */
  pickImage(): Promise<string>;
  /** Creates or updates one setting and re-renders the widgets showing it. */
  save(configJson: string): Promise<boolean>;
  /** Deletes a setting and its photo; its placed widgets offer a new photo. */
  remove(id: string): Promise<boolean>;
  /** Deletes a picked photo that was never saved. */
  discardImage(path: string): void;
  /** Asks the launcher to place a widget showing [id]; false if unsupported. */
  requestPin(id: string): Promise<boolean>;
}

export default TurboModuleRegistry.get<Spec>('PhotoWidget');
