import React from 'react';
import { useTranslation } from 'react-i18next';
import { Notice } from '@/shared/components';
import type { UseOverlayController } from '../hooks/useOverlayController';

export interface OverlayNoticeBannerProps {
  controller: UseOverlayController;
}

/**
 * Explains why the floating button is not running — permission missing or
 * revoked, consent declined, start failure — with the action that fixes it.
 */
export function OverlayNoticeBanner({ controller }: OverlayNoticeBannerProps) {
  const { t } = useTranslation();
  const { notice, status, openOverlaySettings, enable, dismissNotice } =
    controller;

  if (!status.supported) {
    return (
      <Notice
        tone="info"
        message={t('overlay.unsupported')}
        testID="overlay-unsupported"
      />
    );
  }

  switch (notice) {
    case 'overlay_permission':
    case 'revoked':
      return (
        <Notice
          tone="warning"
          testID={`overlay-notice-${notice}`}
          title={t(
            notice === 'revoked'
              ? 'overlay.revokedTitle'
              : 'overlay.permissionTitle',
          )}
          message={t(
            notice === 'revoked'
              ? 'overlay.revokedBody'
              : 'overlay.permissionBody',
          )}
          action={{
            label: t('overlay.permissionAction'),
            onPress: openOverlaySettings,
          }}
          onDismiss={dismissNotice}
        />
      );
    case 'cancelled':
      return (
        <Notice
          tone="info"
          testID="overlay-notice-cancelled"
          title={t('overlay.cancelledTitle')}
          message={t('overlay.cancelledBody')}
          action={{
            label: t('overlay.turnOn'),
            onPress: () => {
              void enable();
            },
          }}
          onDismiss={dismissNotice}
        />
      );
    case 'error':
      return (
        <Notice
          tone="error"
          testID="overlay-notice-error"
          message={t('overlay.errorBody')}
          action={{
            label: t('common.retry'),
            onPress: () => {
              void enable();
            },
          }}
          onDismiss={dismissNotice}
        />
      );
    default:
      return null;
  }
}
