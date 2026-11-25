import React from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ListRow } from '@/shared/components';
import { formatRelative } from '@/shared/utils';
import { displayDeviceId, parseDeviceId } from '../core/ids';
import { remoteActions } from '../hooks/useRemote';
import type { HistoryEntry } from '../types';
import { groupHistory } from '../utils/historyGroups';
import { historyText } from '../utils/labels';

/** Who connected to whom, and how it ended. */
export interface HistoryListProps {
  history: HistoryEntry[];
  /** Device IDs with a saved password. */
  savedPasswordIds: string[];
  /** Connect again (with the saved password when there is one). */
  onReconnect: (id: string) => void;
}

export function HistoryList({
  history,
  savedPasswordIds,
  onReconnect,
}: HistoryListProps) {
  const { t } = useTranslation();
  if (!history.length)
    return <EmptyState icon="history" title={t('remote.history.empty')} />;
  const onClear = () =>
    Alert.alert(t('remote.history.clear'), t('remote.history.clearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('remote.history.clear'),
        style: 'destructive',
        onPress: remoteActions.clearHistory,
      },
    ]);
  return (
    <>
      <Card>
        {groupHistory(history).map(({ latest: entry, count }, index) => {
          const id =
            entry.direction === 'outgoing' ? parseDeviceId(entry.peerId) : null;
          const saved = !!id && savedPasswordIds.includes(id);
          return (
            <ListRow
              key={`${entry.direction}-${entry.peerId}-${entry.peerName}`}
              title={entry.peerName || displayDeviceId(entry.peerId)}
              titleLines={1}
              subtitle={[
                historyText(t, entry),
                entry.direction === 'incoming'
                  ? t('remote.history.incoming')
                  : t('remote.history.outgoing'),
                formatRelative(new Date(entry.at).toISOString()),
                ...(count > 1 ? [t('remote.history.times', { count })] : []),
                ...(saved ? [t('remote.history.passwordSaved')] : []),
              ].join(' · ')}
              icon={entry.direction === 'incoming' ? 'arrowDown' : 'arrowUp'}
              right={
                id ? (
                  <Button
                    label={t('remote.history.reconnect')}
                    size="sm"
                    variant={saved ? 'primary' : 'secondary'}
                    onPress={() => onReconnect(id)}
                    accessibilityHint={t('remote.history.reconnectHint')}
                    testID={`remote-reconnect-${index}`}
                  />
                ) : undefined
              }
              divider={index > 0}
            />
          );
        })}
      </Card>
      <Button
        label={t('remote.history.clear')}
        variant="ghost"
        onPress={onClear}
      />
    </>
  );
}
