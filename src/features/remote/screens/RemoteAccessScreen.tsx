import React, { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import { Header, TabBar } from '@/shared/components';
import { useTheme } from '@/theme';
import { ActiveSessionRow, ConnectCard } from '../components/ConnectCard';
import { DeviceLists } from '../components/DeviceLists';
import { HistoryList } from '../components/HistoryList';
import { ThisPhoneTab } from '../components/ThisPhoneTab';
import { remoteActions, useRemoteState } from '../hooks/useRemote';

type Tab = 'connect' | 'phone' | 'history';

/**
 * Remote Access home: connect to a computer or phone by ID (or pick one on
 * this Wi-Fi / from saved devices), this phone's own ID and incoming access,
 * and the history. A granted session opens the full-screen viewer.
 */
export default function RemoteAccessScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, spacing } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'RemoteAccess'>>();
  const state = useRemoteState();
  const [tab, setTab] = useState<Tab>(params?.tab ?? 'connect');
  const [prefill, setPrefill] = useState<{
    target: string;
    password: boolean;
    nonce: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    remoteActions.start();
    remoteActions.refresh();
  }, []);

  useEffect(() => {
    if (params?.tab) setTab(params.tab);
  }, [params?.tab]);

  // A new session → straight to its screen.
  const shown = useRef<string | null>(null);
  const sessionId = state.viewer?.sessionId ?? null;
  const viewerLive = state.viewer !== null && state.viewer.state !== 'ended';
  useEffect(() => {
    if (sessionId && viewerLive && shown.current !== sessionId) {
      shown.current = sessionId;
      navigation.navigate(ROUTES.REMOTE_VIEWER);
    }
  }, [sessionId, viewerLive, navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    remoteActions.refresh();
    setTimeout(() => setRefreshing(false), 1200);
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('remote.title')} />
      <TabBar
        value={tab}
        onChange={setTab}
        accessibilityLabel={t('remote.tabs.label')}
        testID="remote-tab"
        tabs={[
          { value: 'connect', label: t('remote.tabs.connect') },
          { value: 'phone', label: t('remote.tabs.phone') },
          { value: 'history', label: t('remote.tabs.history') },
        ]}
      />
      <ScrollView
        key={tab}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          tab === 'history' ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          )
        }
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {tab === 'connect' ? (
          <>
            {viewerLive && state.viewer ? (
              <ActiveSessionRow
                name={state.viewer.host.name}
                onOpen={() => navigation.navigate(ROUTES.REMOTE_VIEWER)}
              />
            ) : null}
            <ConnectCard
              connect={state.connect}
              savedPasswordIds={state.savedPasswordIds}
              prefill={prefill}
            />
            <DeviceLists
              discovered={state.discovered}
              saved={state.saved}
              onConnect={id => {
                setPrefill({ target: id, password: false, nonce: Date.now() });
                void remoteActions.reconnect(id);
              }}
              onConnectWithPassword={id =>
                setPrefill({ target: id, password: true, nonce: Date.now() })
              }
            />
          </>
        ) : tab === 'phone' ? (
          <ThisPhoneTab
            state={state}
            onOpenSettings={() =>
              navigation.navigate(ROUTES.SETTINGS, { tab: 'remote' })
            }
          />
        ) : (
          <HistoryList
            history={state.history}
            savedPasswordIds={state.savedPasswordIds}
            onReconnect={id => {
              setTab('connect');
              setPrefill({ target: id, password: false, nonce: Date.now() });
              void remoteActions.reconnect(id);
            }}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
