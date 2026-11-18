import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import {
  Button,
  Card,
  EmptyState,
  Header,
  Icon,
  Loader,
  Notice,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { PhotoPreview } from '../components/PhotoPreview';
import {
  newWidget,
  photoWidgetActions,
  pickPhoto,
  usePhotoWidgets,
} from '../hooks/usePhotoWidgets';
import { PhotoWidgetError } from '../services/native.service';

const THUMB = 72;

/**
 * Photo widgets: every photo set up for the home screen, how many placed
 * widgets show it, and a button to set up a new one.
 */
export default function PhotoWidgetsScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { widgets, state, reload } = usePhotoWidgets();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const create = async () => {
    if (busy) return;
    setProblem(null);
    setBusy(true);
    try {
      const img = await pickPhoto();
      if (!img) return;
      const w = newWidget(
        img,
        t('photoWidget.defaultName', { n: widgets.length + 1 }),
      );
      await photoWidgetActions.save(w);
      await reload();
      navigation.navigate(ROUTES.PHOTO_WIDGET_EDIT, { widgetId: w.id });
    } catch (error) {
      setProblem(error instanceof PhotoWidgetError ? error.code : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('photoWidget.title')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {t('photoWidget.intro')}
        </Text>
        {problem ? (
          <Notice
            tone="error"
            message={t(
              problem === 'import_failed'
                ? 'photoWidget.error_import'
                : 'photoWidget.error_generic',
            )}
            onDismiss={() => setProblem(null)}
            testID="photo-problem"
          />
        ) : null}
        {state.kind === 'unavailable' ? (
          <EmptyState
            icon="image"
            title={t('photoWidget.unavailableTitle')}
            message={t('photoWidget.unavailableBody')}
            testID="photo-unavailable"
          />
        ) : (
          <>
            <Button
              iconName="image"
              label={t('photoWidget.new')}
              onPress={() => {
                void create();
              }}
              loading={busy}
              testID="photo-new"
            />
            {state.kind === 'loading' ? <Loader /> : null}
            {state.kind === 'error' ? (
              <Notice
                tone="error"
                message={t('photoWidget.error_load')}
                action={{ label: t('photoWidget.retry'), onPress: reload }}
              />
            ) : null}
            {state.kind === 'ready' && widgets.length === 0 ? (
              <EmptyState
                icon="image"
                title={t('photoWidget.emptyTitle')}
                message={t('photoWidget.emptyBody')}
                testID="photo-empty"
              />
            ) : null}
            {widgets.map(w => (
              <Pressable
                key={w.id}
                onPress={() =>
                  navigation.navigate(ROUTES.PHOTO_WIDGET_EDIT, {
                    widgetId: w.id,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${w.name}, ${t(
                  `photoWidget.mode_${w.mode}`,
                )}`}
                testID={`photo-${w.id}`}
              >
                <Card>
                  <View style={[styles.row, { gap: spacing.md }]}>
                    <View
                      style={[
                        styles.thumb,
                        {
                          backgroundColor: colors.surfaceMuted,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <PhotoPreview widget={w} width={THUMB} height={THUMB} />
                    </View>
                    <View style={styles.flex}>
                      <Text
                        style={[
                          typography.label,
                          { color: colors.textPrimary },
                        ]}
                        numberOfLines={1}
                      >
                        {w.name}
                      </Text>
                      <Text
                        style={[
                          typography.caption,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {t(`photoWidget.mode_${w.mode}`)} ·{' '}
                        {w.frameW
                          ? t('photoWidget.shapeCells', {
                              w: w.frameW,
                              h: w.frameH,
                            })
                          : t('photoWidget.shapeAuto')}
                      </Text>
                      <Text
                        style={[
                          typography.caption,
                          {
                            color: w.placed
                              ? colors.success
                              : colors.textSecondary,
                          },
                        ]}
                      >
                        {t('photoWidget.placed', { count: w.placed })}
                      </Text>
                    </View>
                    <Icon
                      name="chevronRight"
                      size={18}
                      color={colors.textSecondary}
                    />
                  </View>
                </Card>
              </Pressable>
            ))}
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('photoWidget.howTo')}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  thumb: {
    width: THUMB,
    height: THUMB,
    overflow: 'hidden',
  },
});
