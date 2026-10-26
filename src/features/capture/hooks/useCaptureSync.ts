import { useEffect } from 'react';
import { AppState } from 'react-native';
import { logger } from '@/shared/utils';
import { useTheme } from '@/theme';
import { syncCaptures } from '../services/captureSync.service';
import { screenOcrService } from '../services/screenOcr.service';
import { useCaptureSettings } from './useCaptureSettings';

function runSync() {
  syncCaptures().catch(error => logger.error('capture sync failed', error));
}

/**
 * App-level glue, mounted once under the theme provider:
 * - mirrors capture settings and the theme's brand colours to the native
 *   service, so the floating button follows changes immediately;
 * - pulls captures made in the background on launch, on return to the
 *   foreground and whenever the service reports a new one.
 */
export function useCaptureSync(): void {
  const { settings } = useCaptureSettings();
  const { colors } = useTheme();

  useEffect(() => {
    screenOcrService.pushConfig(settings, {
      background: colors.primary,
      icon: colors.primaryForeground,
      panel: colors.surface,
      panelText: colors.textPrimary,
    });
  }, [
    settings,
    colors.primary,
    colors.primaryForeground,
    colors.surface,
    colors.textPrimary,
  ]);

  useEffect(() => {
    runSync();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') runSync();
    });
    const unsubscribe = screenOcrService.onResult(runSync);
    return () => {
      appState.remove();
      unsubscribe();
    };
  }, []);
}
