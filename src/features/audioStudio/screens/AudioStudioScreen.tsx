import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header, TabBar } from '@/shared/components';
import { useTheme } from '@/theme';
import { LibraryView } from '../components/LibraryView';
import { MiniPlayer, NowPlaying, QueueView } from '../components/PlayerViews';
import { EqualizerPanel, StudioControls } from '../components/StudioControls';
import { SystemAudioPanel } from '../components/SystemAudioPanel';
import { IconButton } from '../components/ui';
import { useAudioStudioInit } from '../hooks/useAudioStudio';

type Tab = 'player' | 'library' | 'studio' | 'eq' | 'system';
const TABS: Tab[] = ['library', 'player', 'studio', 'eq', 'system'];

/**
 * 8D Audio Studio: a music player whose every sample runs through the native
 * spatial engine (HRTF binaural rendering, virtual 8-speaker surround, reverb,
 * EQ, dynamics), plus best-effort enhancement of other apps' audio.
 */
export default function AudioStudioScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, spacing } = useTheme();
  const [tab, setTab] = useState<Tab>('library');
  const [queueOpen, setQueueOpen] = useState(false);
  useAudioStudioInit();

  const scroll = (children: React.ReactNode) => (
    <ScrollView
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: spacing.xl * 2,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );

  return (
    <View
      style={[
        styles.flex,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('audioStudio.title')} />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={TABS.map(v => ({ value: v, label: t(`audioStudio.tabs.${v}`) }))}
        accessibilityLabel={t('audioStudio.title')}
        testID="studio-tab"
        scrollable
      />
      <View style={styles.flex}>
        {tab === 'library' ? <LibraryView /> : null}
        {tab === 'player' ? (
          <NowPlaying
            onQueue={() => setQueueOpen(true)}
            onStudio={() => setTab('studio')}
          />
        ) : null}
        {tab === 'studio' ? scroll(<StudioControls visible />) : null}
        {tab === 'eq' ? scroll(<EqualizerPanel />) : null}
        {tab === 'system' ? scroll(<SystemAudioPanel />) : null}
      </View>
      {tab !== 'player' ? (
        <View style={{ paddingBottom: bottom }}>
          <MiniPlayer onOpen={() => setTab('player')} />
        </View>
      ) : (
        <View style={{ height: bottom }} />
      )}

      <Modal
        visible={queueOpen}
        animationType="slide"
        onRequestClose={() => setQueueOpen(false)}
      >
        <View
          style={[
            styles.flex,
            {
              backgroundColor: colors.background,
              paddingTop: top,
              paddingBottom: bottom,
            },
          ]}
        >
          <View style={[styles.row, { paddingHorizontal: spacing.sm }]}>
            <IconButton
              icon="chevronLeft"
              label={t('audioStudio.common.back')}
              onPress={() => setQueueOpen(false)}
            />
          </View>
          <QueueView />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
