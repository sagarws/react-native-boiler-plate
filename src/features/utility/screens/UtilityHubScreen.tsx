import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import type { IconName } from '@/shared/assets';
import { Header, Icon } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import {
  utilityNative,
  type ArSupport,
  type CompassSupport,
} from '../services/native.service';

type Tool = {
  key: 'compass' | 'measure' | 'scanner' | 'documents' | 'water' | 'recorder';
  route:
    | typeof ROUTES.UTILITY_COMPASS
    | typeof ROUTES.UTILITY_MEASURE
    | typeof ROUTES.UTILITY_SCANNER
    | typeof ROUTES.UTILITY_DOCUMENTS
    | typeof ROUTES.UTILITY_WATER_EJECT
    | typeof ROUTES.UTILITY_RECORDER;
  icon: IconName;
  color: string;
};

const TOOLS: readonly Tool[] = [
  {
    key: 'scanner',
    route: ROUTES.UTILITY_SCANNER,
    icon: 'qrCode',
    color: 'violet',
  },
  {
    key: 'documents',
    route: ROUTES.UTILITY_DOCUMENTS,
    icon: 'fileText',
    color: 'blue',
  },
  {
    key: 'compass',
    route: ROUTES.UTILITY_COMPASS,
    icon: 'compass',
    color: 'teal',
  },
  {
    key: 'measure',
    route: ROUTES.UTILITY_MEASURE,
    icon: 'ruler',
    color: 'amber',
  },
  {
    key: 'water',
    route: ROUTES.UTILITY_WATER_EJECT,
    icon: 'droplets',
    color: 'indigo',
  },
  {
    key: 'recorder',
    route: ROUTES.UTILITY_RECORDER,
    icon: 'monitor',
    color: 'rose',
  },
];

/**
 * Utility hub: one card per tool with what it needs (camera, sensors) and
 * whether this phone supports it. Nothing starts — no camera, sensor or
 * sound — until a tool is opened and started.
 */
export default function UtilityHubScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const [compass, setCompass] = useState<CompassSupport | null>(null);
  const [ar, setAr] = useState<ArSupport | null>(null);
  const [docs, setDocs] = useState<boolean | null>(null);

  useEffect(() => {
    utilityNative.compassSupport().then(setCompass, () => setCompass('none'));
    utilityNative.arSupport().then(setAr, () => setAr('unknown'));
    utilityNative
      .documentScannerAvailable()
      .then(setDocs, () => setDocs(false));
  }, []);

  const statusOf = (key: Tool['key']): { text: string; warn: boolean } => {
    switch (key) {
      case 'compass':
        return compass === 'none'
          ? { text: t('utility.noSensor'), warn: true }
          : { text: t('utility.needsSensors'), warn: false };
      case 'measure':
        return ar === 'unsupported'
          ? { text: t('utility.arUnsupportedShort'), warn: true }
          : ar === 'install_required'
          ? { text: t('utility.arInstallShort'), warn: false }
          : { text: t('utility.needsCameraAr'), warn: false };
      case 'scanner':
        return { text: t('utility.needsCamera'), warn: false };
      case 'documents':
        return docs === false
          ? { text: t('utility.docsUnavailableShort'), warn: true }
          : { text: t('utility.noPermissionNeeded'), warn: false };
      case 'recorder':
        return { text: t('utility.needsCaptureConsent'), warn: false };
      default:
        return { text: t('utility.usesSpeaker'), warn: false };
    }
  };

  const columns = width >= 600 ? 3 : 2;
  const gap = spacing.md;
  const cardWidth = (width - spacing.lg * 2 - gap * (columns - 1)) / columns;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.title')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap,
        }}
      >
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {t('utility.intro')}
        </Text>
        <View style={[styles.grid, { gap }]}>
          {TOOLS.map(tool => {
            const status = statusOf(tool.key);
            return (
              <Pressable
                key={tool.key}
                testID={`tool-${tool.key}`}
                onPress={() => navigation.navigate(tool.route)}
                accessibilityRole="button"
                accessibilityLabel={`${t(`utility.tool_${tool.key}`)}. ${t(
                  `utility.toolDesc_${tool.key}`,
                )}`}
                style={({ pressed }) => [
                  styles.card,
                  {
                    width: cardWidth,
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: radius.lg,
                    padding: spacing.md,
                    gap: spacing.sm,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor: categoryColor(tool.color),
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  <Icon
                    name={tool.icon}
                    size={26}
                    color={colors.primaryForeground}
                  />
                </View>
                <Text
                  style={[typography.label, { color: colors.textPrimary }]}
                  numberOfLines={2}
                >
                  {t(`utility.tool_${tool.key}`)}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                  numberOfLines={3}
                >
                  {t(`utility.toolDesc_${tool.key}`)}
                </Text>
                <Text
                  style={[
                    typography.caption,
                    {
                      color: status.warn
                        ? colors.warning
                        : colors.textSecondary,
                    },
                  ]}
                  numberOfLines={2}
                >
                  {status.text}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { borderWidth: 1 },
  icon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
