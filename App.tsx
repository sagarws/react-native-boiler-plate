import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '@/i18n';
import RootNavigator from '@/navigation/RootNavigator';
import { setAuthTokenProvider } from '@/services/api';
import { sessionStore } from '@/features/session';
import { requestStartupPermissions } from '@/shared/utils';
import { useTheme } from '@/theme';

// Registered at module scope as well as in the effect so any request fired
// before the first render still carries the bearer token.
setAuthTokenProvider(() => sessionStore.read()?.accessToken);

export default function App() {
  const { scheme } = useTheme();

  useEffect(() => {
    setAuthTokenProvider(() => sessionStore.read()?.accessToken);
    return () => setAuthTokenProvider(undefined);
  }, []);

  useEffect(() => {
    void requestStartupPermissions();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
