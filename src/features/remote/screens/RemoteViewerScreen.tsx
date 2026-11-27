import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { Button } from '@/shared/components';
import { useTheme } from '@/theme';
import { ScreenSheet, QualitySheet } from '../components/viewer/ChoiceSheets';
import { KeyChip } from '../components/viewer/KeyChip';
import { KeysSheet } from '../components/viewer/KeysSheet';
import { LockFrameView } from '../components/viewer/LockFrameView';
import { PcKeyboard } from '../components/viewer/PcKeyboard';
import { ScrollWheel } from '../components/viewer/ScrollWheel';
import { FloatingToolButton } from '../components/viewer/FloatingToolButton';
import { ToolButton, ViewerToolbar } from '../components/viewer/ViewerToolbar';
import { displayDeviceId, formatRemaining } from '../core/ids';
import {
  remoteActions,
  updateRemoteSettings,
  useNow,
  useRemoteSettings,
  useRemoteState,
} from '../hooks/useRemote';
import { useRemoteKeyboard } from '../hooks/useRemoteKeyboard';
import { useViewerGestures } from '../hooks/useViewerGestures';
import { remoteNative } from '../services/native.service';
import type { InputEvent } from '../types';
import { endReasonText, isPhone } from '../utils/labels';
import {
  MODIFIERS,
  PHONE_KEYS,
  QUICK_KEYS,
  modifierLabel,
} from '../utils/keys';

// The letterbox around a remote screen is black in either theme, like any video player.
const VIDEO_BACKDROP = '#000000';

/**
 * The remote device's screen, full screen: touch to control it, pinch to
 * zoom, the phone keyboard and a special-keys panel, a screen switcher for
 * computers with several monitors, quality, and Back/Home/Recents for phones.
 */
export default function RemoteViewerScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const { colors, typography, spacing, radius } = useTheme();
  const settings = useRemoteSettings();
  const { viewer: snap } = useRemoteState();
  const session = remoteActions.viewer();
  const now = useNow(!!snap?.expiresAt);
  const [container, setContainer] = useState({
    width: window.width,
    height: window.height,
  });
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [videoSize, setVideoSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [sheet, setSheet] = useState<'keys' | 'screens' | 'quality' | null>(
    null,
  );
  // The tools live behind the floating button: hidden until it is tapped,
  // folded away again once a tool is chosen.
  const [toolbar, setToolbar] = useState(false);
  const pick = (action: () => void) => () => {
    setToolbar(false);
    action();
  };
  // With the keyboard open the picture goes into the space left between the
  // toolbar and the quick-keys row, at its top (not centred behind the keyboard).
  const [toolbarBottom, setToolbarBottom] = useState(0);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  // Edge-to-edge Android does not resize the window for the keyboard, so the
  // quick-keys row is lifted by the keyboard's height (which excludes the
  // navigation bar). Where the window does resize (older Android), only the
  // part it did not absorb is added.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const fullHeight = useRef(0);
  const keyboardOpenRef = useRef<(open: boolean) => void>(() => undefined);
  // The whole screen's height (not the picture area, which shrinks with the
  // keyboard): tells whether the window itself resized for the keyboard.
  const [screenHeight, setScreenHeight] = useState(window.height);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      // Closed by Android (Back, swipe down): the quick-keys row and the
      // keyboard layout go with it.
      keyboardOpenRef.current(false);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const sendInput = useCallback(
    (event: InputEvent) => session?.sendInput(event),
    [session],
  );
  const sendMove = useCallback(
    (x: number, y: number) => session?.sendMove(x, y),
    [session],
  );
  const keyboard = useRemoteKeyboard(sendInput, !!snap?.locked);
  keyboardOpenRef.current = keyboard.setOpen;
  // The computer-keys panel (Esc, F1–F12, Enter, arrows, Ctrl/Alt/⌘…), shown
  // in place of the phone keyboard, like AnyDesk's key layout.
  const [pcKeys, setPcKeys] = useState(false);
  const openPcKeys = useCallback(() => {
    keyboard.hide();
    setPcKeys(true);
  }, [keyboard]);
  const openPhoneKeyboard = useCallback(() => {
    setPcKeys(false);
    keyboard.show();
  }, [keyboard]);
  const panelOpen = keyboard.open || pcKeys;
  // The mouse scroll wheel on the left edge (▲ / ▼ and a drag strip).
  const [scrollWheel, setScrollWheel] = useState(false);

  const host = snap?.host.platform ?? 'linux';
  const phoneHost = isPhone(host);
  const display = snap?.displays.find(d => d.id === snap.displayId);
  const video = videoSize ?? {
    width: display?.width || 16,
    height: display?.height || 9,
  };
  const canControl =
    !!snap &&
    snap.permission === 'control' &&
    snap.state === 'active' &&
    snap.media === 'connected';

  const gestures = useViewerGestures({
    container,
    origin,
    video,
    mode: settings.touchMode,
    phoneHost,
    enabled: canControl,
    alignTop: panelOpen,
    sendInput,
    sendMove,
  });

  // The picture area changed (keyboard or PC keys opened/closed): when zoomed
  // in, keep the spot being worked on visible instead of behind the keys.
  useEffect(() => {
    gestures.keepFocusInView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container.width, container.height]);

  // A new screen size (screen switch / rotation) → fit again.
  useEffect(() => {
    setVideoSize(null);
    gestures.resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.displayId]);

  useEffect(() => {
    if (!settings.keepAwake) return;
    remoteNative.setKeepScreenOn(true);
    return () => remoteNative.setKeepScreenOn(false);
  }, [settings.keepAwake]);

  useEffect(() => {
    if (!snap?.notice) return;
    const timer = setTimeout(() => session?.clearNotice(), 5000);
    return () => clearTimeout(timer);
  }, [snap?.notice, session]);

  // No session at all (e.g. restored navigation): back to the list.
  useEffect(() => {
    if (!snap) navigation.goBack();
  }, [snap, navigation]);

  const confirmClose = useCallback(() => {
    if (!snap || snap.state === 'ended') {
      remoteActions.dismissViewer();
      return;
    }
    Alert.alert(
      t('remote.viewer.disconnect'),
      t('remote.viewer.disconnectConfirm', { name: snap.host.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('remote.viewer.back'), onPress: () => navigation.goBack() },
        {
          text: t('remote.viewer.disconnect'),
          style: 'destructive',
          onPress: () => remoteActions.disconnect(),
        },
      ],
    );
  }, [snap, t, navigation]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pcKeys) {
        setPcKeys(false);
        return true;
      }
      if (keyboard.open) {
        keyboard.hide();
        return true;
      }
      confirmClose();
      return true;
    });
    return () => sub.remove();
  }, [keyboard, pcKeys, confirmClose]);

  if (!snap) return null;

  const statusParts = [
    // First, so it is never cut off: it is why the control tools are missing.
    snap.permission === 'view' ? t('remote.viewer.viewOnly') : null,
    `${displayDeviceId(snap.host.id)} · ${
      snap.via === 'lan' ? t('remote.connect.lan') : t('remote.connect.relay')
    }`,
    snap.rttMs !== null ? t('remote.viewer.rtt', { ms: snap.rttMs }) : null,
    snap.expiresAt
      ? t('remote.viewer.timeLeft', {
          time: formatRemaining(snap.expiresAt - now),
        })
      : null,
  ].filter(Boolean);
  const warn =
    snap.state === 'reconnecting' ||
    snap.media === 'interrupted' ||
    !!snap.inputProblem;
  const status =
    snap.state === 'reconnecting'
      ? t('remote.viewer.reconnecting')
      : snap.media === 'interrupted'
      ? t('remote.viewer.interrupted')
      : snap.inputProblem ?? statusParts.join(' · ');

  const noticeText = (() => {
    const n = snap.notice;
    if (!n) return null;
    if (n.kind === 'timer') return t('remote.viewer.noticeTimer');
    if (n.kind === 'warning')
      return t('remote.viewer.noticeWarning', { minutes: n.minutes });
    if (n.kind === 'permission')
      return n.permission === 'control'
        ? t('remote.viewer.noticeControl')
        : t('remote.viewer.noticeView');
    if (n.kind === 'reconnected') return t('remote.viewer.noticeReconnected');
    return n.text;
  })();

  const layout = gestures.layout;
  if (!keyboardHeight) fullHeight.current = screenHeight;
  const keyboardLift = keyboardHeight
    ? Math.max(
        0,
        keyboardHeight + insets.bottom - (fullHeight.current - screenHeight),
      )
    : 0;

  const ended = snap.state === 'ended';

  return (
    <View
      style={[styles.screen, { backgroundColor: VIDEO_BACKDROP }]}
      onLayout={e => setScreenHeight(e.nativeEvent.layout.height)}
    >
      <StatusBar hidden />
      <View
        style={
          panelOpen
            ? [
                styles.layer,
                {
                  left: 0,
                  right: 0,
                  top: toolbar ? toolbarBottom : insets.top,
                  bottom: (keyboard.open ? keyboardLift : 0) + bottomBarHeight,
                },
              ]
            : StyleSheet.absoluteFill
        }
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          setContainer({ width, height });
          e.currentTarget.measureInWindow((x, y) => setOrigin({ x, y }));
        }}
        {...gestures.panHandlers}
        testID="remote-viewer-surface"
      >
        {snap.streamURL ? (
          <RTCView
            streamURL={snap.streamURL}
            objectFit="contain"
            style={[
              styles.layer,
              {
                left: layout.left,
                top: layout.top,
                width: layout.width,
                height: layout.height,
              },
            ]}
            onDimensionsChange={e => {
              const { width, height } = e.nativeEvent;
              // Only a new shape re-fits the picture. Auto quality changes the
              // video's size (same shape) every few seconds at the start;
              // re-laying out the video view for each made it blink.
              if (
                width > 0 &&
                height > 0 &&
                Math.abs(width / height - video.width / video.height) >
                  0.01 * (video.width / video.height)
              )
                setVideoSize({ width, height });
            }}
          />
        ) : null}
        {snap.locked && snap.lockFrame ? (
          <LockFrameView
            uri={snap.lockFrame}
            style={{
              position: 'absolute',
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
              backgroundColor: VIDEO_BACKDROP,
            }}
          />
        ) : null}
        {settings.touchMode === 'trackpad' && canControl ? (
          <View
            pointerEvents="none"
            style={[
              styles.cursor,
              {
                left: layout.left + gestures.cursor.x * layout.width - 6,
                top: layout.top + gestures.cursor.y * layout.height - 6,
                borderColor: colors.primaryForeground,
                backgroundColor: colors.primary,
              },
            ]}
          />
        ) : null}
        {snap.media !== 'connected' && !ended ? (
          <View style={styles.center} pointerEvents="none">
            <ActivityIndicator color={colors.onPrimary} size="large" />
            <Text
              style={[
                typography.body,
                { color: colors.onPrimary, marginTop: spacing.md },
              ]}
            >
              {snap.state === 'reconnecting'
                ? t('remote.viewer.reconnecting')
                : t('remote.viewer.connecting')}
            </Text>
          </View>
        ) : null}
      </View>

      {toolbar && !ended ? (
        <View
          style={[styles.topLayer, { paddingTop: insets.top }]}
          onLayout={e => setToolbarBottom(e.nativeEvent.layout.height)}
        >
          <ViewerToolbar
            title={snap.host.name}
            status={status}
            statusTone={warn ? 'warn' : 'ok'}
            onClose={confirmClose}
          >
            {snap.displays.length > 1 ? (
              <ToolButton
                icon="monitor"
                label={t('remote.viewer.screens')}
                badge={`${
                  snap.displays.findIndex(d => d.id === snap.displayId) + 1
                }/${snap.displays.length}`}
                onPress={pick(() => setSheet('screens'))}
                testID="remote-tool-screens"
              />
            ) : null}
            {snap.permission === 'control' ? (
              <>
                <ToolButton
                  icon="type"
                  label={t('remote.viewer.keyboard')}
                  active={keyboard.open}
                  onPress={pick(keyboard.toggle)}
                  testID="remote-tool-keyboard"
                />
                <ToolButton
                  icon="menu"
                  label={t('remote.viewer.pcKeys')}
                  active={pcKeys}
                  onPress={pick(() =>
                    pcKeys ? setPcKeys(false) : openPcKeys(),
                  )}
                  testID="remote-tool-pc-keys"
                />
                <ToolButton
                  icon="arrowDown"
                  label={t('remote.viewer.scroll')}
                  active={scrollWheel}
                  onPress={pick(() => setScrollWheel(v => !v))}
                  testID="remote-tool-scroll"
                />
                <ToolButton
                  icon="layers"
                  label={t('remote.viewer.keys')}
                  onPress={pick(() => setSheet('keys'))}
                  testID="remote-tool-keys"
                />
                <ToolButton
                  icon={
                    settings.touchMode === 'direct'
                      ? 'pointer'
                      : 'mousePointerClick'
                  }
                  label={
                    settings.touchMode === 'direct'
                      ? t('remote.viewer.touchDirect')
                      : t('remote.viewer.touchTrackpad')
                  }
                  onPress={pick(() =>
                    updateRemoteSettings({
                      touchMode:
                        settings.touchMode === 'direct' ? 'trackpad' : 'direct',
                    }),
                  )}
                  testID="remote-tool-touch"
                />
              </>
            ) : null}
            <ToolButton
              icon="slidersHorizontal"
              label={t('remote.viewer.quality')}
              onPress={pick(() => setSheet('quality'))}
            />
            {gestures.zoom > 1.01 ? (
              <ToolButton
                icon="scanLine"
                label={t('remote.viewer.fit')}
                onPress={pick(gestures.resetView)}
              />
            ) : (
              <ToolButton
                icon="search"
                label={t('remote.viewer.zoom')}
                onPress={pick(() =>
                  gestures.zoomTo(
                    2.5,
                    settings.touchMode === 'trackpad'
                      ? gestures.cursor
                      : undefined,
                  ),
                )}
                testID="remote-tool-zoom"
              />
            )}
          </ViewerToolbar>
        </View>
      ) : null}
      {!ended ? (
        <FloatingToolButton
          active={toolbar}
          attention={warn}
          onPress={() => setToolbar(v => !v)}
          accessibilityLabel={t('remote.viewer.tools')}
        />
      ) : null}

      {scrollWheel && canControl && !ended ? (
        <ScrollWheel
          top={
            panelOpen
              ? insets.top + 8
              : Math.max(insets.top + 8, (screenHeight - 236) / 2)
          }
          onScroll={dy => sendInput({ k: 'wh', dx: 0, dy: Math.round(dy) })}
        />
      ) : null}

      {noticeText && !ended ? (
        <Pressable
          onPress={() => session?.clearNotice()}
          style={[
            styles.notice,
            {
              top: insets.top + 96,
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.md,
              marginHorizontal: spacing.lg,
            },
          ]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {noticeText}
          </Text>
        </Pressable>
      ) : null}

      {!ended && (panelOpen || (phoneHost && canControl)) ? (
        <View
          onLayout={e => setBottomBarHeight(e.nativeEvent.layout.height)}
          style={[
            styles.bottom,
            {
              bottom: keyboard.open ? keyboardLift : 0,
              paddingBottom: keyboard.open
                ? spacing.xs
                : insets.bottom + spacing.xs,
              // The computer-keys panel is solid, like a keyboard.
              ...(pcKeys && !keyboard.open
                ? { backgroundColor: colors.background }
                : null),
              backgroundColor: colors.overlay,
              paddingHorizontal: spacing.sm,
              paddingTop: spacing.xs,
              gap: spacing.xs,
            },
          ]}
        >
          {pcKeys && !keyboard.open ? (
            <PcKeyboard
              host={host}
              mods={keyboard.mods}
              onToggleModifier={keyboard.toggleModifier}
              onCombo={keyboard.combo}
              onAbc={openPhoneKeyboard}
              onClose={() => setPcKeys(false)}
            />
          ) : null}
          {keyboard.open ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={[styles.keyRow, { gap: spacing.xs }]}
            >
              <KeyChip
                compact
                active
                label="⌨ PC"
                accessibilityLabel={t('remote.viewer.pcKeys')}
                onPress={openPcKeys}
              />
              <KeyChip
                compact
                label="⏎"
                accessibilityLabel="Enter"
                onPress={() => keyboard.combo(['Enter'])}
              />
              {phoneHost
                ? null
                : MODIFIERS.map(m => (
                    <KeyChip
                      key={m}
                      compact
                      label={modifierLabel(m, host)}
                      active={keyboard.mods.includes(m)}
                      onPress={() => keyboard.toggleModifier(m)}
                    />
                  ))}
              {QUICK_KEYS.map(k => (
                <KeyChip
                  key={k.id}
                  compact
                  label={k.label}
                  onPress={() => keyboard.combo(k.codes)}
                />
              ))}
            </ScrollView>
          ) : null}
          {phoneHost && canControl ? (
            <View style={[styles.navRow, { gap: spacing.xl }]}>
              {PHONE_KEYS.map(k => (
                <Pressable
                  key={k.id}
                  onPress={() => keyboard.combo([k.code])}
                  accessibilityRole="button"
                  accessibilityLabel={t(`remote.viewer.${k.id}`)}
                  hitSlop={12}
                  style={{
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.xs,
                  }}
                >
                  <Text style={[typography.h2, { color: colors.onPrimary }]}>
                    {k.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* The remote keyboard: never visible, only receives the phone's keys. */}
      <TextInput
        ref={keyboard.inputRef}
        value={keyboard.value}
        onChangeText={keyboard.onChangeText}
        onSubmitEditing={keyboard.onSubmit}
        onBlur={() => keyboard.setOpen(false)}
        submitBehavior="submit"
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        keyboardType="visible-password"
        importantForAutofill="no"
        caretHidden
        style={styles.hiddenInput}
        accessibilityLabel={t('remote.viewer.keyboard')}
        testID="remote-keyboard-input"
      />

      {ended ? (
        <View
          style={[
            styles.center,
            StyleSheet.absoluteFill,
            { backgroundColor: colors.overlay, padding: spacing.xl },
          ]}
        >
          <View
            style={[
              styles.endCard,
              {
                backgroundColor: colors.surface,
                borderRadius: radius.xl,
                padding: spacing.xl,
                gap: spacing.md,
              },
            ]}
          >
            <Text style={[typography.title, { color: colors.textPrimary }]}>
              {t('remote.viewer.ended')}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {endReasonText(t, snap.endReason)}
            </Text>
            <Button
              label={t('remote.viewer.reconnect')}
              onPress={() => {
                // Dismissing the ended session navigates back (effect above).
                const id = snap.host.id;
                remoteActions.dismissViewer();
                // With a saved password: a locked computer cannot accept a request.
                void remoteActions.reconnect(id);
              }}
            />
            <Button
              label={t('remote.viewer.back')}
              variant="secondary"
              onPress={remoteActions.dismissViewer}
              testID="remote-viewer-back"
            />
          </View>
        </View>
      ) : null}

      <KeysSheet
        visible={sheet === 'keys'}
        onClose={() => setSheet(null)}
        host={host}
        mods={keyboard.mods}
        onToggleModifier={keyboard.toggleModifier}
        onCombo={keyboard.combo}
        locked={snap.locked}
        onCtrlAltDel={() => session?.sendCtrlAltDel()}
      />
      <ScreenSheet
        visible={sheet === 'screens'}
        onClose={() => setSheet(null)}
        displays={snap.displays}
        current={snap.displayId}
        onPick={id => session?.setDisplay(id)}
      />
      <QualitySheet
        visible={sheet === 'quality'}
        onClose={() => setSheet(null)}
        value={snap.quality}
        onPick={q => remoteActions.setQuality(q)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  layer: { position: 'absolute' },
  topLayer: { position: 'absolute', left: 0, right: 0, top: 0 },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  cursor: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  notice: { position: 'absolute', left: 0, right: 0 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  keyRow: { alignItems: 'center' },
  navRow: { flexDirection: 'row', justifyContent: 'center' },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -10,
    bottom: 0,
  },
  endCard: { width: '100%', maxWidth: 420 },
});
