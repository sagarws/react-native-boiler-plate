import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainStackParamList } from '@/navigation/types';
import type { IconName } from '@/shared/assets';
import {
  Button,
  EmptyState,
  Header,
  Icon,
  Notice,
  TabBar,
} from '@/shared/components';
import { formatTimestamp } from '@/shared/utils';
import { useTheme } from '@/theme';
import { MethodBadge, StatusText } from '../components/Badges';
import { CodeBlock } from '../components/CodeBlock';
import { KeyValueList } from '../components/KeyValueList';
import { useCallDetail, type CopyPart } from '../hooks/useCallDetail';
import { useFlash } from '../hooks/useFlash';
import {
  CANCEL_BROWSER_CLOSED,
  CANCEL_CAPTURE_OFF,
  CANCEL_PAGE_LEFT,
} from '../services/captureManager';
import { DETAIL_TABS, type CapturedBody, type DetailTab } from '../types';
import { bodyToText, formatBytes, formatDurationMs } from '../utils/filters';

const CANCEL_KEYS: Record<string, string> = {
  [CANCEL_PAGE_LEFT]: 'network.cancel.pageLeft',
  [CANCEL_BROWSER_CLOSED]: 'network.cancel.browserClosed',
  [CANCEL_CAPTURE_OFF]: 'network.cancel.captureOff',
};

/**
 * One captured call: overview, request/response headers and bodies, and the
 * cURL command, with copy actions. Copies follow the redaction setting; the
 * on-screen record shows what was captured.
 */
export default function NetworkCallDetailScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'NetworkCall'>>();
  const { record, shareable, includeSensitive, copy, remove } = useCallDetail(
    params.callId,
  );
  const [tab, setTab] = useState<DetailTab>('overview');
  const { flash, show, dismiss } = useFlash();

  const onCopy = async (part: CopyPart) => {
    const ok = await copy(part);
    show(
      ok ? t('network.detail.copied') : t('network.detail.copyFailed'),
      ok ? 'success' : 'error',
    );
  };

  const onDelete = () => {
    Alert.alert(
      t('network.calls.deleteTitle', { count: 1 }),
      t('network.calls.deleteBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            if (remove()) navigation.goBack();
            else show(t('network.calls.actionFailed'), 'error');
          },
        },
      ],
    );
  };

  if (!record || !shareable) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('network.detail.title')} />
        <EmptyState
          icon="search"
          title={t('network.detail.missing')}
          message={t('network.detail.missingHint')}
          testID="net-detail-missing"
        />
      </View>
    );
  }

  const na = t('network.detail.notAvailable');
  const errorText = record.error
    ? CANCEL_KEYS[record.error]
      ? t(CANCEL_KEYS[record.error])
      : record.error
    : null;

  const bodyNotes = (body: CapturedBody | null) => {
    if (!body) return null;
    const size = formatBytes(body.sizeBytes);
    if (body.kind === 'binary') {
      return body.value
        ? t('network.detail.binaryBody', { size: size || na })
        : t('network.detail.binaryTooLarge', { size: size || na });
    }
    if (body.truncated) {
      return size
        ? t('network.detail.truncated', { size })
        : t('network.detail.truncatedUnknown');
    }
    return null;
  };

  const renderBody = (
    body: CapturedBody | null,
    empty: string,
    testID: string,
  ) => {
    if (!body) {
      return (
        <EmptyState
          icon="fileText"
          title={t('network.detail.noBody')}
          message={empty}
          compact
        />
      );
    }
    const note = bodyNotes(body);
    const text = bodyToText(body);
    return (
      <View style={{ gap: spacing.sm }}>
        {note ? <Notice tone="info" message={note} /> : null}
        {text ? (
          <CodeBlock text={text} json={body.kind === 'json'} testID={testID} />
        ) : null}
      </View>
    );
  };

  const action = (
    icon: IconName,
    label: string,
    onPress: () => void,
    testID: string,
  ) => (
    <Pressable
      key={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.action,
        {
          gap: spacing.xs,
          paddingHorizontal: spacing.md,
          borderRadius: radius.pill,
          backgroundColor: pressed ? colors.primarySoft : colors.surfaceMuted,
        },
      ]}
      testID={testID}
    >
      <Icon name={icon} size={16} color={colors.primaryText} />
      <Text style={[typography.caption, { color: colors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );

  let content: React.ReactNode;
  switch (tab) {
    case 'overview':
      content = (
        <KeyValueList
          emptyTitle={na}
          entries={[
            [t('network.detail.url'), record.url],
            [t('network.detail.method'), record.method],
            [
              t('network.detail.status'),
              record.status === null
                ? na
                : `${record.status}${
                    record.statusText ? ` ${record.statusText}` : ''
                  }`,
            ],
            [
              t('network.detail.duration'),
              formatDurationMs(record.durationMs) || na,
            ],
            [
              t('network.detail.started'),
              formatTimestamp(Date.parse(record.startedAt)),
            ],
            [
              t('network.detail.completed'),
              record.completedAt
                ? formatTimestamp(Date.parse(record.completedAt))
                : na,
            ],
            [t('network.detail.resourceType'), record.resourceType],
            [t('network.detail.mimeType'), record.mimeType ?? na],
            [t('network.detail.page'), record.pageUrl],
            ...(record.frameId
              ? [[t('network.detail.frame'), record.frameId] as const]
              : []),
            ...(errorText
              ? [[t('network.detail.error'), errorText] as const]
              : []),
            [t('network.detail.requestId'), record.metadata.requestId],
          ]}
          testID="net-overview"
        />
      );
      break;
    case 'requestHeaders':
    case 'responseHeaders': {
      const headers =
        tab === 'requestHeaders'
          ? record.requestHeaders
          : record.responseHeaders;
      content = (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {tab === 'requestHeaders'
              ? t('network.detail.requestHeadersHint')
              : t('network.detail.responseHeadersHint')}
          </Text>
          <KeyValueList
            code
            entries={Object.entries(headers)}
            emptyTitle={t('network.detail.noHeaders')}
            testID={`net-${tab}`}
          />
        </View>
      );
      break;
    }
    case 'requestBody':
      content = renderBody(
        record.requestBody,
        t('network.detail.noRequestBody'),
        'net-request-body',
      );
      break;
    case 'responseBody':
      content = record.metadata.pending ? (
        <Notice tone="info" message={t('network.detail.pendingNote')} />
      ) : (
        renderBody(
          record.responseBody,
          t('network.detail.noResponseBody'),
          'net-response-body',
        )
      );
      break;
    case 'curl':
      content = <CodeBlock text={shareable.curl} testID="net-curl" />;
      break;
  }

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('network.detail.title')} />
      <View
        style={[
          styles.summary,
          {
            padding: spacing.lg,
            gap: spacing.md,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <MethodBadge method={record.method} />
        <Text
          style={[typography.label, styles.flex, { color: colors.textPrimary }]}
          numberOfLines={2}
          selectable
        >
          {record.metadata.normalizedEndpoint || record.url}
        </Text>
        <StatusText
          call={{
            status: record.status,
            error: record.error,
            pending: record.metadata.pending,
          }}
        />
      </View>
      <TabBar
        value={tab}
        onChange={setTab}
        scrollable
        accessibilityLabel={t('network.detail.tabsLabel')}
        testID="net-detail-tabs"
        tabs={DETAIL_TABS.map(value => ({
          value,
          label: t(`network.detail.tab.${value}`),
        }))}
      />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: bottom + spacing.xl,
        }}
      >
        {flash ? (
          <Notice
            tone={flash.tone}
            message={flash.message}
            onDismiss={dismiss}
          />
        ) : null}
        <View style={[styles.wrap, { gap: spacing.sm }]}>
          {action(
            'link',
            t('network.detail.copyUrl'),
            () => onCopy('url'),
            'net-copy-url',
          )}
          {record.requestBody
            ? action(
                'upload',
                t('network.detail.copyRequestBody'),
                () => onCopy('requestBody'),
                'net-copy-request',
              )
            : null}
          {record.responseBody
            ? action(
                'download',
                t('network.detail.copyResponse'),
                () => onCopy('responseBody'),
                'net-copy-response',
              )
            : null}
          {action(
            'copy',
            t('network.detail.copyCurl'),
            () => onCopy('curl'),
            'net-copy-curl',
          )}
        </View>
        {!includeSensitive ? (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('network.detail.redactionNote')}
          </Text>
        ) : null}
        {content}
        <Button
          label={t('network.detail.delete')}
          iconName="trash2"
          variant="danger"
          onPress={onDelete}
          testID="net-delete"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
});
