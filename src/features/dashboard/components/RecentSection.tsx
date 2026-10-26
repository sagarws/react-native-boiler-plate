import React from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ResultListItem, type OcrResult } from '@/features/capture';
import { Card, EmptyState } from '@/shared/components';
import { useTheme } from '@/theme';

export interface RecentSectionProps {
  history: readonly OcrResult[];
  latest: OcrResult | null;
  historyEnabled: boolean;
  onOpen: (result: OcrResult, fromHistory: boolean) => void;
}

const RECENT_COUNT = 5;

/** Recent extractions, or the session's last capture when history is off. */
export function RecentSection({
  history,
  latest,
  historyEnabled,
  onOpen,
}: RecentSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const recent = history.slice(0, RECENT_COUNT);
  const showLatestOnly = !historyEnabled && latest != null;

  return (
    <>
      <Text
        style={[
          typography.overline,
          { color: colors.textSecondary, marginTop: spacing.sm },
        ]}
      >
        {showLatestOnly ? t('home.lastCapture') : t('home.recent')}
      </Text>
      {showLatestOnly && latest ? (
        <Card flat>
          <ResultListItem result={latest} onPress={r => onOpen(r, false)} />
        </Card>
      ) : recent.length > 0 && historyEnabled ? (
        <Card flat testID="recent-list">
          {recent.map((result, index) => (
            <ResultListItem
              key={result.id}
              result={result}
              divider={index > 0}
              onPress={r => onOpen(r, true)}
            />
          ))}
        </Card>
      ) : (
        <Card flat>
          <EmptyState
            compact
            testID="recent-empty"
            icon={historyEnabled ? 'history' : 'lock'}
            title={
              historyEnabled ? t('home.emptyTitle') : t('home.historyOffTitle')
            }
            message={
              historyEnabled ? t('home.emptyBody') : t('home.historyOffBody')
            }
          />
        </Card>
      )}
    </>
  );
}
