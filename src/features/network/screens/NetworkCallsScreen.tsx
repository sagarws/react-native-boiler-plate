import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import {
  Button,
  EmptyState,
  Header,
  Loader,
  Notice,
  TabBar,
  TextField,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { CallRow } from '../components/CallRow';
import { useCapturedCalls } from '../hooks/useCapturedCalls';
import { useFlash } from '../hooks/useFlash';
import {
  useNetworkExport,
  type ExportOutcome,
} from '../hooks/useNetworkExport';
import { useNetworkSettings } from '../hooks/useNetworkSettings';
import { CALL_FILTERS, type CallSummary } from '../types';

/**
 * Captured Network Calls: every recorded request, newest first, with search,
 * method/status filters, paging, multi-select, delete and JSON export.
 */
export default function NetworkCallsScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();
  const calls = useCapturedCalls();
  const settings = useNetworkSettings();
  const exporter = useNetworkExport();
  const { flash, show, dismiss } = useFlash();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = useState(false);

  const filtered = calls.filter !== 'all' || calls.query.trim() !== '';

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const endSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const onPress = useCallback(
    (call: CallSummary) => {
      if (selecting) toggle(call.id);
      else navigation.navigate(ROUTES.NETWORK_CALL, { callId: call.id });
    },
    [navigation, selecting, toggle],
  );
  const onLongPress = useCallback(
    (call: CallSummary) => {
      setSelecting(true);
      toggle(call.id);
    },
    [toggle],
  );

  const confirmDelete = (ids: string[], onDone?: () => void) => {
    Alert.alert(
      t('network.calls.deleteTitle', { count: ids.length }),
      t('network.calls.deleteBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            const ok = calls.remove(ids);
            show(
              ok ? t('network.calls.deleted') : t('network.calls.actionFailed'),
              ok ? 'success' : 'error',
            );
            if (ok) onDone?.();
          },
        },
      ],
    );
  };

  const onClearAll = () => {
    Alert.alert(t('network.hub.clearTitle'), t('network.hub.clearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('network.calls.clearAll'),
        style: 'destructive',
        onPress: () => {
          const ok = calls.clearAll();
          endSelection();
          show(
            ok ? t('network.hub.cleared') : t('network.calls.actionFailed'),
            ok ? 'success' : 'error',
          );
        },
      },
    ]);
  };

  const report = (outcome: ExportOutcome, saved: boolean) => {
    if (outcome === 'done')
      show(saved ? t('network.calls.saved') : t('network.calls.exported'));
    else if (outcome === 'empty') show(t('network.calls.exportEmpty'), 'info');
    else if (outcome === 'failed')
      show(t('network.calls.exportFailed'), 'error');
  };

  const onExport = () => {
    const ids = selecting
      ? [...selected]
      : filtered
      ? calls.matchingIds()
      : null;
    const count = ids ? ids.length : calls.total;
    if (!count) {
      show(t('network.calls.exportEmpty'), 'info');
      return;
    }
    const message = t('network.calls.exportBody', {
      count,
      redaction: settings.includeSensitive
        ? t('network.calls.exportUnredacted')
        : t('network.calls.exportRedacted'),
    });
    const share = () => exporter.run(ids, 'share').then(o => report(o, false));
    const save = () => exporter.run(ids, 'save').then(o => report(o, true));
    Alert.alert(t('network.calls.exportTitle'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      ...(exporter.canSave
        ? [{ text: t('network.calls.save'), onPress: save }]
        : []),
      { text: t('network.calls.share'), onPress: share },
    ]);
  };

  const renderItem: ListRenderItem<CallSummary> = ({ item }) => (
    <CallRow
      call={item}
      selecting={selecting}
      selected={selected.has(item.id)}
      onPress={onPress}
      onLongPress={onLongPress}
    />
  );

  const exportLabel = selecting
    ? t('network.calls.exportSelected', { count: selected.size })
    : filtered
    ? t('network.calls.exportMatching', { count: calls.matching })
    : t('network.calls.exportAll', { count: calls.total });

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('network.calls.title')} />
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          gap: spacing.sm,
        }}
      >
        {flash ? (
          <Notice
            tone={flash.tone}
            message={flash.message}
            onDismiss={dismiss}
          />
        ) : null}
        <TextField
          label={t('network.calls.searchLabel')}
          placeholder={t('network.calls.searchPlaceholder')}
          value={calls.query}
          onChangeText={calls.setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          testID="net-search"
        />
      </View>
      <TabBar
        value={calls.filter}
        onChange={calls.setFilter}
        scrollable
        accessibilityLabel={t('network.calls.filtersLabel')}
        testID="net-filter"
        tabs={CALL_FILTERS.map(f => ({
          value: f,
          label: t(`network.filter.${f}`),
        }))}
      />
      <View
        style={[
          styles.toolbar,
          { paddingHorizontal: spacing.lg, gap: spacing.sm },
        ]}
      >
        {selecting ? (
          <>
            <Text
              style={[
                typography.label,
                styles.flex,
                { color: colors.textPrimary },
              ]}
            >
              {t('network.calls.selectedCount', { count: selected.size })}
            </Text>
            <Button
              label={t('network.calls.selectAll')}
              size="sm"
              variant="ghost"
              onPress={() => setSelected(new Set(calls.matchingIds()))}
              testID="net-select-all"
            />
            <Button
              label={t('common.delete')}
              iconName="trash2"
              size="sm"
              variant="danger"
              disabled={!selected.size}
              onPress={() => confirmDelete([...selected], endSelection)}
              testID="net-delete-selected"
            />
            <Button
              label={t('common.cancel')}
              size="sm"
              variant="ghost"
              accessibilityLabel={t('network.calls.cancelSelect')}
              onPress={endSelection}
              testID="net-cancel-select"
            />
          </>
        ) : (
          <>
            <Text
              style={[
                typography.caption,
                styles.flex,
                { color: colors.textSecondary },
              ]}
              testID="net-summary"
            >
              {t('network.calls.summary', {
                shown: calls.matching,
                total: calls.total,
              })}
            </Text>
            <Button
              label={t('network.calls.select')}
              size="sm"
              variant="ghost"
              disabled={!calls.matching}
              onPress={() => setSelecting(true)}
              testID="net-select"
            />
            <Button
              label={t('network.calls.clearAll')}
              size="sm"
              variant="ghost"
              disabled={!calls.total}
              onPress={onClearAll}
              testID="net-clear-all"
            />
          </>
        )}
      </View>
      <FlatList
        data={calls.items}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        extraData={selecting ? selected : null}
        onEndReached={calls.loadMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={15}
        windowSize={9}
        removeClippedSubviews
        onRefresh={calls.refresh}
        refreshing={false}
        contentContainerStyle={[
          styles.grow,
          { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
        ]}
        ListEmptyComponent={
          calls.total ? (
            <EmptyState
              icon="search"
              title={t('network.calls.noMatch')}
              message={t('network.calls.noMatchHint')}
              testID="net-no-match"
            />
          ) : (
            <EmptyState
              icon="globe"
              title={t('network.calls.empty')}
              message={t('network.calls.emptyHint')}
              action={{
                label: t('network.calls.openBrowser'),
                onPress: () => navigation.navigate(ROUTES.NETWORK_INSPECTOR),
              }}
              testID="net-empty"
            />
          )
        }
        ListFooterComponent={calls.hasMore ? <Loader /> : null}
        testID="net-list"
      />
      <View
        style={[
          styles.footer,
          {
            padding: spacing.lg,
            paddingBottom: bottom + spacing.md,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
          },
        ]}
      >
        {exporter.busy ? (
          <View style={[styles.toolbar, { gap: spacing.sm }]}>
            <Loader />
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('network.calls.exporting')}
            </Text>
          </View>
        ) : (
          <Button
            label={exportLabel}
            iconName="share2"
            disabled={selecting ? !selected.size : !calls.matching}
            onPress={onExport}
            testID="net-export"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
});
