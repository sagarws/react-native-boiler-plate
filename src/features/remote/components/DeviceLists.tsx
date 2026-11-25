import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, Icon, ListRow } from '@/shared/components';
import { formatRelative } from '@/shared/utils';
import { useTheme } from '@/theme';
import { displayDeviceId } from '../core/ids';
import { remoteActions } from '../hooks/useRemote';
import type { DiscoveredDevice, SavedDevice } from '../types';
import { platformIcon } from '../utils/labels';

export interface DeviceListsProps {
  discovered: DiscoveredDevice[];
  saved: SavedDevice[];
  /** Tap: connect now (or prefill the password when long-pressed → "with password"). */
  onConnect: (id: string) => void;
  onConnectWithPassword: (id: string) => void;
}

function SectionTitle({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      style={[
        styles.sectionTitle,
        { paddingHorizontal: spacing.xs, marginTop: spacing.sm },
      ]}
    >
      <Text style={[typography.overline, { color: colors.textSecondary }]}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** "On this network" (LAN discovery) and "Saved & recent". */
export function DeviceLists({
  discovered,
  saved,
  onConnect,
  onConnectWithPassword,
}: DeviceListsProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  const savedActions = (device: SavedDevice) => {
    Alert.alert(
      t('remote.connect.deviceActions', {
        name: device.name,
        id: displayDeviceId(device.id),
      }),
      undefined,
      [
        {
          text: t('remote.connect.connectWithPassword'),
          onPress: () => onConnectWithPassword(device.id),
        },
        {
          text: device.favorite
            ? t('remote.connect.unfavorite')
            : t('remote.connect.favorite'),
          onPress: () =>
            remoteActions.updateDevice(device.id, {
              favorite: !device.favorite,
            }),
        },
        {
          text: t('remote.connect.remove'),
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              t('remote.connect.remove'),
              t('remote.connect.removeHint'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('remote.connect.remove'),
                  style: 'destructive',
                  onPress: () => remoteActions.removeDevice(device.id),
                },
              ],
            ),
        },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  };

  const sortedSaved = [...saved].sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) ||
      (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0),
  );
  const online = new Set(discovered.map(d => d.id));

  return (
    <>
      <SectionTitle
        title={t('remote.connect.nearby')}
        right={
          <Pressable
            onPress={remoteActions.refresh}
            accessibilityRole="button"
            accessibilityLabel={t('remote.connect.refresh')}
            hitSlop={12}
            style={[styles.refresh, { gap: spacing.xs }]}
          >
            <Icon name="refreshCw" size={16} color={colors.primary} />
            <Text style={[typography.caption, { color: colors.primary }]}>
              {t('remote.connect.refresh')}
            </Text>
          </Pressable>
        }
      />
      <Card>
        {discovered.length === 0 ? (
          <EmptyState
            compact
            icon="search"
            title={t('remote.connect.nearbyEmpty')}
          />
        ) : (
          discovered.map((device, index) => (
            <ListRow
              key={device.id}
              title={device.name}
              subtitle={`${displayDeviceId(device.id)} · ${
                device.os || device.address
              }`}
              icon={platformIcon(device.platform)}
              chevron
              divider={index > 0}
              onPress={() => onConnect(device.id)}
              testID={`remote-nearby-${device.id}`}
            />
          ))
        )}
      </Card>

      <SectionTitle title={t('remote.connect.saved')} />
      <Card>
        {sortedSaved.length === 0 ? (
          <EmptyState
            compact
            icon="history"
            title={t('remote.connect.savedEmpty')}
          />
        ) : (
          sortedSaved.map((device, index) => (
            <Pressable
              key={device.id}
              onLongPress={() => savedActions(device)}
              delayLongPress={350}
              accessibilityHint={t('remote.connect.deviceActions', {
                name: device.name,
                id: device.id,
              })}
            >
              <ListRow
                title={`${device.favorite ? '★ ' : ''}${device.name}`}
                subtitle={[
                  displayDeviceId(device.id),
                  online.has(device.id) ? t('remote.connect.lan') : null,
                  device.lastConnectedAt
                    ? t('remote.connect.lastConnected', {
                        when: formatRelative(
                          new Date(device.lastConnectedAt).toISOString(),
                        ),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                icon={platformIcon(device.platform)}
                right={
                  <Pressable
                    onPress={() => savedActions(device)}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t('remote.connect.deviceActions', {
                      name: device.name,
                      id: device.id,
                    })}
                  >
                    <Icon
                      name="circleEllipsis"
                      size={20}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                }
                divider={index > 0}
                onPress={() => onConnect(device.id)}
                testID={`remote-saved-${device.id}`}
              />
            </Pressable>
          ))
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refresh: { flexDirection: 'row', alignItems: 'center' },
});
