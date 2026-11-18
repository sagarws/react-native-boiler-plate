import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { AppState, findNodeHandle, type View } from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';
import { networkRepository } from '../repository/network.repository';
import {
  CANCEL_BROWSER_CLOSED,
  CaptureManager,
} from '../services/captureManager';
import {
  buildCaptureScript,
  setActiveSnippet,
} from '../services/captureScript';
import { networkNative, type InjectionMode } from '../services/native.service';
import { networkSettingsStore } from '../store/networkSettings.store';
import type { CaptureSession } from '../types';
import { isUrlAllowed, toOriginRules } from '../utils/domainFilter';
import { randomToken } from '../utils/uuid';
import { useNetworkSettings } from './useNetworkSettings';

/** What the browser's capture bar shows for the current page. */
export type CaptureIndicator =
  | 'off'
  | 'noDomains'
  | 'notAllowed'
  | 'recording'
  | 'paused'
  | 'stopped';

export interface BrowserCapture {
  /** False until the capture script is in place; load the site only then. */
  ready: boolean;
  /** The script for page-start injection (iOS, or the Android fallback). */
  injectedScript: string | undefined;
  mode: InjectionMode | null;
  indicator: (pageUrl: string) => CaptureIndicator;
  session: CaptureSession;
  /** Calls recorded since this browser opened. */
  capturedCount: number;
  onMessage: (event: WebViewMessageEvent) => void;
  /** Call on each finished load so a paused session stays paused there. */
  onPageLoaded: () => void;
  /** Call once the placeholder page has loaded (the native view exists). */
  onHostReady: () => void;
  setSession: (session: CaptureSession) => void;
}

interface Injector {
  injectJavaScript: (script: string) => void;
}

/**
 * The in-app browser's capture lifecycle: one random session token, the
 * capture script (built once, from the settings at open time), its
 * registration on the WebView, the capture manager and clean-up on close.
 */
export function useBrowserCapture(
  hostRef: RefObject<View | null>,
  webRef: RefObject<Injector | null>,
): BrowserCapture {
  const settings = useNetworkSettings();
  const [setup] = useState(() => {
    const current = networkSettingsStore.read();
    const token = randomToken();
    const active = current.enabled && current.domains.length > 0;
    return {
      token,
      rules: current.domains,
      script: active
        ? buildCaptureScript({
            token,
            rules: current.domains,
            bodyLimitBytes: current.bodyLimitKb * 1024,
            pageCookies: !networkNative.canReadCookies(),
          })
        : null,
    };
  });
  const [mode, setMode] = useState<InjectionMode | null>(null);
  const [ready, setReady] = useState(setup.script === null);
  const [capturedCount, setCapturedCount] = useState(0);
  const managerRef = useRef<CaptureManager | null>(null);
  const attaching = useRef(false);

  // One manager per browser session.
  useEffect(() => {
    networkRepository.closeStalePending(CANCEL_BROWSER_CLOSED);
    const manager = new CaptureManager(setup.token, {
      settings: networkSettingsStore.read,
      persist: records => networkRepository.upsertMany(records),
      cookies: networkNative.canReadCookies()
        ? networkNative.cookies
        : undefined,
    });
    managerRef.current = manager;
    // Opening an allowed site with capture on starts recording.
    const current = networkSettingsStore.read();
    if (current.enabled && current.session === 'stopped') {
      networkSettingsStore.setSession('recording');
    }
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') manager.flush();
    });
    return () => {
      sub.remove();
      manager.dispose();
      managerRef.current = null;
    };
  }, [setup.token]);

  const onHostReady = useCallback(() => {
    if (ready || attaching.current || !setup.script) return;
    attaching.current = true;
    const tag = hostRef.current ? findNodeHandle(hostRef.current) : null;
    networkNative
      .attachScript(tag, setup.script, toOriginRules(setup.rules))
      .then(result => {
        setMode(result);
        setReady(true);
      });
  }, [hostRef, ready, setup.rules, setup.script]);

  useEffect(() => {
    if (!setup.script) return undefined;
    const host = hostRef;
    return () => {
      const tag = host.current ? findNodeHandle(host.current) : null;
      void networkNative.detachScript(tag);
    };
  }, [hostRef, setup.script]);

  // Pausing stops the page from even reading bodies (main frame); the
  // manager drops new requests either way.
  useEffect(() => {
    if (ready && setup.script) {
      webRef.current?.injectJavaScript(
        setActiveSnippet(settings.enabled && settings.session === 'recording'),
      );
    }
  }, [ready, settings.enabled, settings.session, setup.script, webRef]);

  const onPageLoaded = useCallback(() => {
    const current = networkSettingsStore.read();
    if (setup.script && !(current.enabled && current.session === 'recording')) {
      webRef.current?.injectJavaScript(setActiveSnippet(false));
    }
  }, [setup.script, webRef]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const manager = managerRef.current;
    if (!manager) return;
    if (manager.handleMessage(event.nativeEvent.data, event.nativeEvent.url)) {
      setCapturedCount(manager.recordedCount);
    }
  }, []);

  const indicator = useCallback(
    (pageUrl: string): CaptureIndicator => {
      if (!settings.enabled) return 'off';
      if (!settings.domains.length) return 'noDomains';
      if (!setup.script || !isUrlAllowed(pageUrl, setup.rules)) {
        return 'notAllowed';
      }
      return settings.session;
    },
    [
      settings.domains.length,
      settings.enabled,
      settings.session,
      setup.rules,
      setup.script,
    ],
  );

  return {
    ready,
    injectedScript:
      setup.script && mode !== 'documentStart' ? setup.script : undefined,
    mode,
    indicator,
    session: settings.session,
    capturedCount,
    onMessage,
    onPageLoaded,
    onHostReady,
    setSession: networkSettingsStore.setSession,
  };
}
