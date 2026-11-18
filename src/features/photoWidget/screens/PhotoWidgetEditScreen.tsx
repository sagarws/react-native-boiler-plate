import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FormField } from '@/features/life';
import type { MainStackParamList } from '@/navigation/types';
import {
  Button,
  EmptyState,
  Header,
  Icon,
  Loader,
  Notice,
  SegmentedControl,
  Slider,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { PhotoPreview } from '../components/PhotoPreview';
import {
  photoWidgetActions,
  pickPhoto,
  usePhotoWidgets,
} from '../hooks/usePhotoWidgets';
import { MAX_CELLS, PHOTO_MODES, type PhotoWidget } from '../types';

type Shape = 'auto' | 'custom';
const HANDLE = 32;

const clampCells = (n: number) =>
  Math.max(1, Math.min(MAX_CELLS, Math.round(n)));

/**
 * Edit one photo widget: a live preview (what the home screen shows),
 * its shape — drag the corner handle to set width × height in cells, or
 * let it match the widget — Fit / Fill / Crop (drag the photo and zoom to
 * crop), rounded corners, replace or remove the photo, and add it to the
 * home screen. On the home screen, long-press a widget and drag its
 * handles to resize it; the photo is redrawn at the new size.
 */
export default function PhotoWidgetEditScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'PhotoWidgetEdit'>>();
  const { widgets, pinSupported, state, reload } = usePhotoWidgets();
  const saved = widgets.find(w => w.id === params.widgetId);
  const [draft, setDraft] = useState<PhotoWidget | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error' | 'info';
    key: string;
  } | null>(null);

  // Start editing once the saved setting has loaded.
  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);

  // A replaced photo that was never saved is deleted on the way out.
  const savedImage = useRef<string | null>(null);
  savedImage.current = saved?.image ?? null;
  const draftImage = useRef<string | null>(null);
  draftImage.current = draft?.image ?? null;
  useEffect(
    () => () => {
      const d = draftImage.current;
      if (d && d !== savedImage.current) photoWidgetActions.discardImage(d);
    },
    [],
  );

  const cell = Math.floor(
    Math.min(screenW - spacing.lg * 2 - HANDLE, 360) / MAX_CELLS,
  );
  const set = (patch: Partial<PhotoWidget>) =>
    setDraft(d => (d ? { ...d, ...patch } : d));

  const latest = useRef({ draft, cell });
  latest.current = { draft, cell };
  const startSize = useRef({ w: 2, h: 2 });
  const resize = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          const d = latest.current.draft;
          startSize.current = { w: d?.frameW || 2, h: d?.frameH || 2 };
        },
        onPanResponderMove: (_, g) => {
          const c = latest.current.cell;
          const w = clampCells(startSize.current.w + g.dx / c);
          const h = clampCells(startSize.current.h + g.dy / c);
          setDraft(d =>
            d && (d.frameW !== w || d.frameH !== h)
              ? { ...d, frameW: w, frameH: h }
              : d,
          );
        },
      }),
    [],
  );

  if (state.kind === 'loading' && !draft) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('photoWidget.title')} />
        <Loader />
      </View>
    );
  }
  if (!draft) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('photoWidget.title')} />
        <EmptyState
          icon="triangleAlert"
          title={t('photoWidget.notFound')}
          testID="photo-missing"
        />
      </View>
    );
  }

  const shape: Shape = draft.frameW ? 'custom' : 'auto';
  const boxW = (draft.frameW || 2) * cell;
  const boxH = (draft.frameH || 2) * cell;

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await photoWidgetActions.save({
        ...draft,
        name: draft.name.trim() || saved?.name || '',
      });
      await reload();
      setMessage({ tone: 'success', key: 'photoWidget.saved' });
      return true;
    } catch {
      setMessage({ tone: 'error', key: 'photoWidget.error_generic' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const replace = async () => {
    try {
      const img = await pickPhoto();
      if (!img) return;
      // An earlier unsaved replacement is no longer needed.
      if (draft.image !== saved?.image)
        photoWidgetActions.discardImage(draft.image);
      set({
        image: img.path,
        imgW: img.width,
        imgH: img.height,
        focusX: 0.5,
        focusY: 0.5,
        zoom: 1,
      });
    } catch {
      setMessage({ tone: 'error', key: 'photoWidget.error_import' });
    }
  };

  const addToHome = async () => {
    if (!(await save())) return;
    const ok = await photoWidgetActions.requestPin(draft.id);
    setMessage(
      ok
        ? { tone: 'info', key: 'photoWidget.pinAsked' }
        : { tone: 'info', key: 'photoWidget.pinManual' },
    );
  };

  const confirmRemove = () =>
    Alert.alert(
      t('photoWidget.removeTitle', { name: draft.name }),
      saved?.placed
        ? t('photoWidget.removeBody', { count: saved.placed })
        : undefined,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('photoWidget.remove'),
          style: 'destructive',
          onPress: async () => {
            await photoWidgetActions.remove(draft.id);
            navigation.goBack();
          },
        },
      ],
    );

  const label = [typography.label, { color: colors.textPrimary }];
  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={draft.name || t('photoWidget.title')} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <View
          style={[
            styles.stage,
            {
              height: MAX_CELLS * cell + HANDLE,
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.lg,
            },
          ]}
        >
          <View style={{ width: boxW, height: boxH }}>
            <PhotoPreview
              widget={draft}
              width={boxW}
              height={boxH}
              onFocusChange={f => set({ focusX: f.x, focusY: f.y })}
              outline
              testID="photo-preview"
            />
            {shape === 'custom' ? (
              <View
                {...resize.panHandlers}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={t('photoWidget.resizeHandle', {
                  w: draft.frameW,
                  h: draft.frameH,
                })}
                accessibilityActions={[
                  { name: 'increment', label: t('photoWidget.bigger') },
                  { name: 'decrement', label: t('photoWidget.smaller') },
                ]}
                onAccessibilityAction={e => {
                  const step =
                    e.nativeEvent.actionName === 'increment' ? 1 : -1;
                  set({
                    frameW: clampCells(draft.frameW + step),
                    frameH: clampCells(draft.frameH + step),
                  });
                }}
                testID="photo-resize-handle"
                style={[
                  styles.handle,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Icon name="move" size={16} color={colors.primaryForeground} />
              </View>
            ) : null}
          </View>
        </View>
        <Text style={caption} testID="photo-size-label">
          {shape === 'custom'
            ? t('photoWidget.shapeCells', { w: draft.frameW, h: draft.frameH })
            : t('photoWidget.shapeAutoHint')}
          {draft.mode === 'crop' ? ` · ${t('photoWidget.dragToCrop')}` : ''}
        </Text>

        <Text style={label}>{t('photoWidget.shape')}</Text>
        <SegmentedControl
          options={[
            { value: 'auto', label: t('photoWidget.shapeAuto') },
            { value: 'custom', label: t('photoWidget.shapeCustom') },
          ]}
          value={shape}
          onChange={s =>
            set(
              s === 'auto'
                ? { frameW: 0, frameH: 0 }
                : { frameW: 2, frameH: 2 },
            )
          }
          accessibilityLabel={t('photoWidget.shape')}
          testID="photo-shape"
        />

        <Text style={label}>{t('photoWidget.display')}</Text>
        <SegmentedControl
          options={PHOTO_MODES.map(m => ({
            value: m,
            label: t(`photoWidget.mode_${m}`),
          }))}
          value={draft.mode}
          onChange={mode => set({ mode })}
          accessibilityLabel={t('photoWidget.display')}
          testID="photo-mode"
        />
        <Text style={caption}>{t(`photoWidget.modeHint_${draft.mode}`)}</Text>
        {draft.mode === 'crop' ? (
          <>
            <Text style={label}>
              {t('photoWidget.zoom', { value: draft.zoom.toFixed(1) })}
            </Text>
            <Slider
              value={draft.zoom}
              min={1}
              max={4}
              step={0.1}
              onChange={zoom => set({ zoom })}
              accessibilityLabel={t('photoWidget.zoomLabel')}
              testID="photo-zoom"
            />
          </>
        ) : null}
        <Text style={label}>
          {t('photoWidget.corners', { value: draft.corner })}
        </Text>
        <Slider
          value={draft.corner}
          min={0}
          max={32}
          step={4}
          onChange={corner => set({ corner })}
          accessibilityLabel={t('photoWidget.cornersLabel')}
          testID="photo-corners"
        />
        <FormField
          label={t('photoWidget.name')}
          value={draft.name}
          onChangeText={name => set({ name })}
          maxLength={40}
          testID="photo-name"
        />

        {message ? (
          <Notice
            tone={message.tone}
            message={t(message.key)}
            onDismiss={() => setMessage(null)}
            testID="photo-message"
          />
        ) : null}
        <Button
          label={t('photoWidget.save')}
          iconName="check"
          onPress={() => {
            save();
          }}
          loading={busy}
          testID="photo-save"
        />
        <Button
          variant="soft"
          iconName="smartphone"
          label={t('photoWidget.addToHome')}
          onPress={() => {
            addToHome();
          }}
          disabled={busy}
          testID="photo-pin"
        />
        {!pinSupported ? (
          <Text style={caption}>{t('photoWidget.pinManual')}</Text>
        ) : null}
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            variant="secondary"
            iconName="image"
            label={t('photoWidget.replace')}
            onPress={() => {
              replace();
            }}
            style={styles.flex}
            testID="photo-replace"
          />
          <Button
            variant="danger"
            label={t('photoWidget.remove')}
            onPress={confirmRemove}
            style={styles.flex}
            testID="photo-remove"
          />
        </View>
        <Text style={caption}>
          {t('photoWidget.placed', { count: saved?.placed ?? 0 })} ·{' '}
          {t('photoWidget.resizeOnHome')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  stage: { alignItems: 'center', justifyContent: 'center' },
  handle: {
    position: 'absolute',
    right: -HANDLE / 2,
    bottom: -HANDLE / 2,
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
