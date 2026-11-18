import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { createLocalId } from '@/shared/utils';
import {
  photoWidgetNative,
  PhotoWidgetError,
} from '../services/native.service';
import type { PhotoWidget } from '../types';

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error' }
  | { kind: 'unavailable' };

/**
 * The photo widget settings, reloaded whenever the screen comes into focus
 * or the app returns to the foreground (a widget may have been placed or
 * removed on the home screen meanwhile).
 */
export function usePhotoWidgets() {
  const focused = useIsFocused();
  const [widgets, setWidgets] = useState<PhotoWidget[]>([]);
  const [pinSupported, setPinSupported] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const reload = useCallback(async () => {
    if (!photoWidgetNative.available()) {
      setState({ kind: 'unavailable' });
      return;
    }
    try {
      const r = await photoWidgetNative.list();
      setWidgets(r.widgets);
      setPinSupported(r.pinSupported);
      setState({ kind: 'ready' });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    if (!focused) return undefined;
    void reload();
    const sub = AppState.addEventListener(
      'change',
      s => s === 'active' && reload(),
    );
    return () => sub.remove();
  }, [focused, reload]);

  return { widgets, pinSupported, state, reload };
}

/** A new setting for a freshly picked photo (fills the widget, centred). */
export function newWidget(
  img: { path: string; width: number; height: number },
  name: string,
): PhotoWidget {
  return {
    id: createLocalId(),
    name,
    image: img.path,
    imgW: img.width,
    imgH: img.height,
    mode: 'fill',
    frameW: 0,
    frameH: 0,
    focusX: 0.5,
    focusY: 0.5,
    zoom: 1,
    corner: 16,
    updatedAt: Date.now(),
    placed: 0,
  };
}

/** Picks a photo; null = cancelled. Throws a PhotoWidgetError code on failure. */
export async function pickPhoto() {
  try {
    return await photoWidgetNative.pickImage();
  } catch (error) {
    throw error instanceof PhotoWidgetError
      ? error
      : new PhotoWidgetError('failed');
  }
}

export const photoWidgetActions = {
  save: photoWidgetNative.save,
  remove: photoWidgetNative.remove,
  discardImage: photoWidgetNative.discardImage,
  requestPin: photoWidgetNative.requestPin,
};
