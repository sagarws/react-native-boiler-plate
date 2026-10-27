import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ROUTES } from '@/navigation/routes';
import { Header } from '@/shared/components';
import { useTheme } from '@/theme';
import { DriveAccountCard } from '../components/DriveAccountCard';
import { FileShareCard } from '../components/FileShareCard';
import { useFileBrowser } from '../hooks/useFileBrowser';
import { useGoogleAccount } from '../hooks/useGoogleAccount';
import { useSharedDrive } from '../hooks/useSharedDrive';
import type { DriveSource } from '../types';

/**
 * File Management: two cards.
 * - Google Drive — connect the user's own Drive (signed in on the phone);
 *   otherwise the shared Drive set in Settings → File Management is used.
 * - File Share — folders, uploads, descriptions, share links and delete, in
 *   that Drive (an "Akshar" folder of the account, or the shared folder).
 */
export default function FileManagementScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();
  const google = useGoogleAccount();
  const shared = useSharedDrive();
  const email = google.account?.email;
  const folderId = shared.status.configured ? shared.status.folderId : '';
  // Your own Drive when connected, else the shared one (as on the website).
  const source = useMemo<DriveSource | null>(
    () =>
      email
        ? { kind: 'account', email }
        : folderId
        ? { kind: 'shared', folderId }
        : null,
    [email, folderId],
  );
  const browser = useFileBrowser(source, google.markDisconnected);

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('files.title')} />
      <ScrollView
        testID="files-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.lg,
        }}
      >
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {t('files.intro')}
        </Text>
        <DriveAccountCard
          google={google}
          shared={shared.status}
          rootFolderId={browser.path[0]?.id}
          onManageShared={() =>
            navigation.navigate(ROUTES.SETTINGS, { tab: 'files' })
          }
        />
        <FileShareCard source={source} browser={browser} />
        <Text
          style={[
            typography.caption,
            styles.center,
            { color: colors.textSecondary },
          ]}
        >
          {t('files.privacy')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { textAlign: 'center' },
});
