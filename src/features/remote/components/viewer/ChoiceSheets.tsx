import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Icon, ListRow } from '@/shared/components';
import { useTheme } from '@/theme';
import { QUALITY_PRESETS } from '../../store/remoteSettings.store';
import type { QualityPreset, RemoteDisplay } from '../../types';
import { Sheet } from './Sheet';

export interface ScreenSheetProps {
  visible: boolean;
  onClose: () => void;
  displays: RemoteDisplay[];
  current: string;
  onPick: (id: string) => void;
}

/** "Choose a screen" when the other computer has several monitors. */
export function ScreenSheet({
  visible,
  onClose,
  displays,
  current,
  onPick,
}: ScreenSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Sheet
      visible={visible}
      title={t('remote.viewer.chooseScreen')}
      onClose={onClose}
      testID="remote-screen-sheet"
    >
      <Card>
        {displays.map((d, index) => (
          <ListRow
            key={d.id}
            title={`${index + 1}. ${d.label}`}
            subtitle={[
              d.width && d.height
                ? t('remote.viewer.screenSize', {
                    width: d.width,
                    height: d.height,
                  })
                : null,
              d.primary ? t('remote.viewer.primary') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            icon="monitor"
            divider={index > 0}
            right={
              d.id === current ? (
                <Icon name="check" size={20} color={colors.primary} />
              ) : undefined
            }
            onPress={() => {
              onPick(d.id);
              onClose();
            }}
            testID={`remote-screen-${index}`}
          />
        ))}
      </Card>
    </Sheet>
  );
}

export interface QualitySheetProps {
  visible: boolean;
  onClose: () => void;
  value: QualityPreset;
  onPick: (preset: QualityPreset) => void;
}

export function QualitySheet({
  visible,
  onClose,
  value,
  onPick,
}: QualitySheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Sheet
      visible={visible}
      title={t('remote.viewer.quality')}
      onClose={onClose}
    >
      <Card>
        {QUALITY_PRESETS.map((preset, index) => (
          <ListRow
            key={preset}
            title={t(`remote.quality.${preset}`)}
            subtitle={t(
              `remote.quality.${preset}Hint` as 'remote.quality.autoHint',
            )}
            divider={index > 0}
            right={
              preset === value ? (
                <Icon name="check" size={20} color={colors.primary} />
              ) : undefined
            }
            onPress={() => {
              onPick(preset);
              onClose();
            }}
          />
        ))}
      </Card>
    </Sheet>
  );
}
