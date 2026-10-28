import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '@/i18n';
import RootNavigator from '@/navigation/RootNavigator';
import { setAuthTokenProvider } from '@/services/api';
import { useCaptureSync } from '@/features/capture';
import { useReminderSync } from '@/features/followup';
import { useLifeWidgetSync } from '@/features/life';
import { sessionStore } from '@/features/session';
import { ThemeProvider, useTheme } from '@/theme';

// Registered at module scope as well as in the effect so any request fired
// before the first render still carries the bearer token. Inert while
// `FEATURES.auth` is off — the OCR app makes no network requests.
setAuthTokenProvider(() => sessionStore.read()?.accessToken);

/** Everything that needs the theme: status bar, capture/widget sync, navigation. */
function ThemedApp() {
  const { scheme, colors } = useTheme();
  useCaptureSync();
  useLifeWidgetSync();
  useReminderSync();

  return (
    <>
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      <RootNavigator />
    </>
  );
}

export default function App() {
  useEffect(() => {
    setAuthTokenProvider(() => sessionStore.read()?.accessToken);
    return () => setAuthTokenProvider(undefined);
  }, []);

  // Permissions are requested in onboarding, where the user sees why.
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedApp />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
