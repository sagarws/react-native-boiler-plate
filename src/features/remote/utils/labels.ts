import type { TFunction } from 'i18next';
import type { ConnectState } from '../services/remote.service';
import type { HistoryEntry, RemotePlatform, SessionMinutes } from '../types';

/** The connect error, in the user's language. */
export const connectErrorText = (
  t: TFunction,
  connect: ConnectState,
): string => {
  const code = connect.errorCode ?? 'network';
  if (code === 'rate-limited')
    return t('remote.errors.rate-limited', {
      seconds: Math.max(1, Math.ceil(connect.retryAfterMs / 1000)),
    });
  if (code === 'network')
    return t('remote.errors.network', { detail: connect.errorDetail ?? '' });
  return t(`remote.errors.${code}` as 'remote.errors.rejected', {
    defaultValue: t('remote.errors.unreachable'),
  });
};

export const minutesLabel = (t: TFunction, minutes: SessionMinutes): string =>
  t(`remote.minutes.${minutes}` as 'remote.minutes.30');

export const platformIcon = (
  platform: RemotePlatform,
): 'smartphone' | 'monitor' =>
  platform === 'android' || platform === 'ios' ? 'smartphone' : 'monitor';

export const isPhone = (platform: RemotePlatform): boolean =>
  platform === 'android' || platform === 'ios';

/** The end reason the viewer shows: the phone's own wording, or the host's text. */
export const endReasonText = (t: TFunction, reason: string | null): string => {
  if (reason === 'you') return t('remote.viewer.endedYou');
  if (reason === 'lost') return t('remote.viewer.endedLost');
  return reason || t('remote.viewer.endedOther');
};

export const historyText = (t: TFunction, entry: HistoryEntry): string =>
  t(`remote.history.${entry.event}` as 'remote.history.connected');
