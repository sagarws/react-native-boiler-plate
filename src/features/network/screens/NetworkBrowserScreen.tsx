import React, { useCallback, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import { Header, Icon, Loader, Notice } from '@/shared/components';
import type { IconName } from '@/shared/assets';
import { useTheme } from '@/theme';
import { CaptureControls } from '../components/CaptureControls';
import {
  useBrowserCapture,
  type CaptureIndicator,
} from '../hooks/useBrowserCapture';
import { networkActions } from '../hooks/useNetworkSettings';
import { normalizeAddress } from '../utils/url';

/** Only web pages load inside the inspector (no intent:, file:, javascript:). */
const ALLOWED_SCHEMES = /^(https?:|about:blank|about:srcdoc|blob:|data:)/i;
/** Placeholder loaded first, so the native view exists before the site. */
const PLACEHOLDER = { html: '<!doctype html><title></title>' };

/**
 * In-app browser with the network recorder. The site loads only after the
 * capture script is registered, so its first requests are seen too. A bar
 * under the address shows whether this page is being recorded.
 */
export default function NetworkBrowserScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } =
    useRoute<RouteProp<MainStackParamList, 'NetworkBrowser'>>();

  const hostRef = useRef<View>(null);
  const webRef = useRef<WebView>(null);
  const capture = useBrowserCapture(hostRef, webRef);

  const [target, setTarget] = useState(params.url);
  const [currentUrl, setCurrentUrl] = useState(params.url);
  const [address, setAddress] = useState(params.url);
  const [editing, setEditing] = useState(false);
  const [nav, setNav] = useState({ canGoBack: false, canGoForward: false });
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [placeholderLoaded, setPlaceholderLoaded] = useState(false);

  const showSite =
    capture.ready &&
    (placeholderLoaded || !capture.injectedScript || Platform.OS === 'ios');
  const indicator: CaptureIndicator = capture.indicator(currentUrl);

  const onNavigationStateChange = useCallback(
    (state: WebViewNavigation) => {
      if (
        !state.url ||
        state.url.startsWith('data:') ||
        state.url === 'about:blank'
      )
        return;
      setCurrentUrl(state.url);
      if (!editing) setAddress(state.url);
      setNav({ canGoBack: state.canGoBack, canGoForward: state.canGoForward });
    },
    [editing],
  );

  const onShouldStart = useCallback(
    (request: ShouldStartLoadRequest) => {
      if (ALLOWED_SCHEMES.test(request.url)) return true;
      setFailure(t('network.browser.blockedScheme'));
      return false;
    },
    [t],
  );

  const go = () => {
    const url = normalizeAddress(address);
    setEditing(false);
    if (!url) {
      setFailure(t('network.hub.invalidAddress'));
      return;
    }
    setFailure(null);
    networkActions.update({ lastUrl: url });
    if (url === target) webRef.current?.reload();
    else setTarget(url);
  };

  const toolbarButton = (
    icon: IconName,
    label: string,
    onPress: () => void,
    disabled = false,
    testID?: string,
  ) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={6}
      style={[
        styles.toolButton,
        disabled && styles.disabled,
        { borderRadius: radius.md },
      ]}
      testID={testID}
    >
      <Icon name={icon} size={20} color={colors.textPrimary} />
    </Pressable>
  );

  const indicatorColor =
    indicator === 'recording'
      ? colors.error
      : indicator === 'paused'
      ? colors.warning
      : colors.textSecondary;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header
        label={t('network.browser.title')}
        right={toolbarButton(
          'listChecks',
          t('network.browser.calls'),
          () => navigation.navigate(ROUTES.NETWORK_CALLS),
          false,
          'net-browser-calls',
        )}
      />

      {/* Address bar */}
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: spacing.sm,
            gap: spacing.xs,
            borderBottomColor: colors.border,
          },
          styles.bar,
        ]}
      >
        {toolbarButton(
          'chevronLeft',
          t('network.browser.back'),
          () => webRef.current?.goBack(),
          !nav.canGoBack,
          'net-back',
        )}
        {toolbarButton(
          'chevronRight',
          t('network.browser.forward'),
          () => webRef.current?.goForward(),
          !nav.canGoForward,
          'net-forward',
        )}
        <View
          style={[
            styles.addressBox,
            {
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
            },
          ]}
        >
          <Icon
            name={currentUrl.startsWith('https:') ? 'lock' : 'globe'}
            size={14}
            color={colors.textSecondary}
          />
          <TextInput
            value={address}
            onChangeText={setAddress}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onSubmitEditing={go}
            selectTextOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            accessibilityLabel={t('network.browser.address')}
            placeholderTextColor={colors.placeholder}
            style={[
              typography.caption,
              styles.addressInput,
              { color: colors.textPrimary, marginLeft: spacing.xs },
            ]}
            numberOfLines={1}
            testID="net-browser-address"
          />
        </View>
        {loading
          ? toolbarButton(
              'x',
              t('network.browser.stopLoading'),
              () => webRef.current?.stopLoading(),
              false,
              'net-stop',
            )
          : toolbarButton(
              'refreshCw',
              t('network.browser.reload'),
              () => webRef.current?.reload(),
              false,
              'net-reload',
            )}
      </View>
      {loading && showSite ? (
        <View
          style={[
            styles.progressTrack,
            { backgroundColor: colors.surfaceMuted },
          ]}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.max(5, progress * 100)}%`,
                backgroundColor: colors.primary,
              },
            ]}
            accessibilityRole="progressbar"
            accessibilityLabel={t('network.browser.loading')}
          />
        </View>
      ) : null}

      {/* Capture bar: always says whether this page is recorded. */}
      <View
        style={[
          styles.row,
          styles.bar,
          {
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            gap: spacing.sm,
            borderBottomColor: colors.border,
            backgroundColor:
              indicator === 'recording' ? colors.surface : colors.surfaceMuted,
          },
        ]}
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        testID="net-capture-bar"
      >
        <View
          style={[
            styles.dot,
            { backgroundColor: indicatorColor, borderRadius: radius.pill },
          ]}
        />
        <View style={styles.flex}>
          <Text
            style={[typography.label, { color: indicatorColor }]}
            numberOfLines={1}
            testID="net-indicator"
          >
            {t(`network.status.${indicator}`)}
          </Text>
          {indicator === 'recording' || indicator === 'paused' ? (
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('network.browser.capturedSession', {
                count: capture.capturedCount,
              })}
            </Text>
          ) : null}
        </View>
        {indicator === 'recording' ||
        indicator === 'paused' ||
        indicator === 'stopped' ? (
          <View style={styles.controls}>
            <CaptureControls
              session={capture.session}
              disabled={false}
              onChange={capture.setSession}
              size="sm"
              testID="net-browser-controls"
            />
          </View>
        ) : null}
      </View>

      {capture.mode === 'pageStart' ? (
        <View style={{ padding: spacing.sm }}>
          <Notice tone="warning" message={t('network.browser.lateInjection')} />
        </View>
      ) : null}
      {failure ? (
        <View style={{ padding: spacing.sm }}>
          <Notice
            tone="error"
            message={failure}
            onDismiss={() => setFailure(null)}
          />
        </View>
      ) : null}

      <View
        ref={hostRef}
        collapsable={false}
        style={[styles.flex, { paddingBottom: bottom }]}
      >
        <WebView
          ref={webRef}
          source={showSite ? { uri: target } : PLACEHOLDER}
          originWhitelist={[
            'http://*',
            'https://*',
            'about:*',
            'data:*',
            'blob:*',
          ]}
          onShouldStartLoadWithRequest={onShouldStart}
          onNavigationStateChange={onNavigationStateChange}
          onLoadStart={() => {
            setLoading(true);
            setProgress(0);
          }}
          onLoadProgress={e => setProgress(e.nativeEvent.progress)}
          onLoadEnd={() => {
            setLoading(false);
            if (!showSite) {
              setPlaceholderLoaded(true);
              capture.onHostReady();
            } else {
              capture.onPageLoaded();
            }
          }}
          onError={() => setFailure(t('network.browser.loadFailed'))}
          onRenderProcessGone={() => setFailure(t('network.browser.crashed'))}
          onContentProcessDidTerminate={() => webRef.current?.reload()}
          onMessage={capture.onMessage}
          injectedJavaScriptBeforeContentLoaded={capture.injectedScript}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          webviewDebuggingEnabled={__DEV__}
          startInLoadingState={!showSite}
          renderLoading={() => (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.center,
                { backgroundColor: colors.background },
              ]}
            >
              <Loader />
              <Text
                style={[
                  typography.caption,
                  { color: colors.textSecondary, marginTop: spacing.sm },
                ]}
              >
                {t('network.browser.preparing')}
              </Text>
            </View>
          )}
          style={{ backgroundColor: colors.background }}
          testID="net-webview"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  bar: { borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  toolButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  addressBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
  },
  addressInput: { flex: 1, paddingVertical: 0 },
  progressTrack: { height: 2 },
  progressFill: { height: 2 },
  dot: { width: 10, height: 10 },
  controls: { width: 200 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
