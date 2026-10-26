import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useCaptureSettings,
  useHistory,
  useLatestResult,
  useOverlayController,
  type OcrResult,
} from '@/features/capture';
import { useDrawer } from '@/navigation/drawer';
import { ROUTES } from '@/navigation/routes';
import { Card, ListRow } from '@/shared/components';
import { useTheme } from '@/theme';
import { CaptureCard } from '../components/CaptureCard';
import { HomeTopBar } from '../components/HomeTopBar';
import { RecentSection } from '../components/RecentSection';
import { StepsGuide } from '../components/StepsGuide';

/** Home: switch the floating button on, see its status and recent captures. */
export default function DashboardScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, spacing } = useTheme();
  const navigation = useNavigation();
  const { openDrawer } = useDrawer();
  const controller = useOverlayController();
  const { settings } = useCaptureSettings();
  const history = useHistory();
  const latest = useLatestResult();

  const openSettings = useCallback(
    () => navigation.navigate(ROUTES.SETTINGS),
    [navigation],
  );
  const openResult = useCallback(
    (result: OcrResult, fromHistory: boolean) =>
      navigation.navigate(
        ROUTES.EXTRACTED_TEXT,
        fromHistory
          ? { source: 'history', id: result.id }
          : { source: 'latest' },
      ),
    [navigation],
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <HomeTopBar onMenu={openDrawer} onSettings={openSettings} />
      <ScrollView
        testID="home-scroll"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.lg,
        }}
      >
        <CaptureCard controller={controller} />

        <Card flat>
          <ListRow
            testID="home-language"
            icon="languages"
            title={t('home.languageRow')}
            subtitle={t(`ocrMode.${settings.ocrMode}`)}
            onPress={openSettings}
            accessibilityHint={t('home.change')}
          />
        </Card>

        <StepsGuide />

        <RecentSection
          history={history}
          latest={latest}
          historyEnabled={settings.saveHistory}
          onOpen={openResult}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
