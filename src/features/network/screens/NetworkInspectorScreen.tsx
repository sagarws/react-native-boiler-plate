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
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import {
  Button,
  Card,
  EmptyState,
  Header,
  Icon,
  ListRow,
  Notice,
  SegmentedControl,
  StatusPill,
  TextField,
  ToggleSwitch,
  type StatusTone,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { CaptureControls } from '../components/CaptureControls';
import { useCallSummaries } from '../hooks/useCapturedCalls';
import { useFlash } from '../hooks/useFlash';
import {
  networkActions,
  useNetworkSettings,
} from '../hooks/useNetworkSettings';
import { MAX_DOMAINS } from '../store/networkSettings.store';
import { BODY_LIMITS_KB, type BodyLimitKb, type CaptureScope } from '../types';
import { normalizeAddress } from '../utils/url';

const SESSION_TONE: Record<string, StatusTone> = {
  recording: 'error',
  paused: 'warning',
  stopped: 'neutral',
  off: 'neutral',
};

/**
 * Network Inspector home: the capture toggle and session controls, the
 * allowed domains, privacy limits, and the ways into the browser and the
 * captured calls.
 */
export default function NetworkInspectorScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const settings = useNetworkSettings();
  const calls = useCallSummaries();
  const { flash, show, dismiss } = useFlash();

  const [address, setAddress] = useState(settings.lastUrl);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [subdomains, setSubdomains] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);

  const state = settings.enabled ? settings.session : 'off';

  const openUrl = (url: string) => {
    networkActions.update({ lastUrl: url });
    navigation.navigate(ROUTES.NETWORK_BROWSER, { url });
  };

  const onOpen = () => {
    const url = normalizeAddress(address);
    if (!url) {
      setAddressError(t('network.hub.invalidAddress'));
      return;
    }
    setAddressError(null);
    openUrl(url);
  };

  const onAddDomain = () => {
    if (settings.domains.length >= MAX_DOMAINS) {
      setDomainError(t('network.hub.domainLimit', { max: MAX_DOMAINS }));
      return;
    }
    const rule = networkActions.addDomain(domain, subdomains);
    if (!rule) {
      setDomainError(t('network.hub.invalidDomain'));
      return;
    }
    setDomainError(null);
    setDomain('');
    setSubdomains(false);
  };

  const onClear = () => {
    Alert.alert(t('network.hub.clearTitle'), t('network.hub.clearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('network.hub.clear'),
        style: 'destructive',
        onPress: () => {
          const ok = networkActions.clearRecords();
          show(
            ok ? t('network.hub.cleared') : t('network.calls.actionFailed'),
            ok ? 'success' : 'error',
          );
        },
      },
    ]);
  };

  const sectionTitle = (label: string) => (
    <Text
      style={[
        typography.overline,
        { color: colors.textSecondary, marginBottom: spacing.sm },
      ]}
      accessibilityRole="header"
    >
      {label}
    </Text>
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('network.title')} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.lg,
        }}
        testID="net-hub"
      >
        {flash ? (
          <Notice
            tone={flash.tone}
            message={flash.message}
            onDismiss={dismiss}
          />
        ) : null}

        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {t('network.intro')}
        </Text>

        {/* Capture status + controls */}
        <Card>
          <View style={[styles.rowBetween, { gap: spacing.md }]}>
            <View style={[styles.flex, { gap: spacing.xs }]}>
              <Text style={[typography.title, { color: colors.textPrimary }]}>
                {t('network.hub.enable')}
              </Text>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t('network.hub.enableHint')}
              </Text>
            </View>
            <ToggleSwitch
              isOn={settings.enabled}
              onToggle={networkActions.setEnabled}
              accessibilityLabel={t('network.hub.enable')}
            />
          </View>
          <View
            style={[
              styles.rowBetween,
              { marginTop: spacing.lg, gap: spacing.sm },
            ]}
          >
            <StatusPill
              tone={SESSION_TONE[state]}
              label={t(`network.status.${state}`)}
              testID="net-state"
            />
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('network.hub.recordedCount', { count: calls.length })}
            </Text>
          </View>
          <Text
            style={[
              typography.caption,
              { color: colors.textSecondary, marginTop: spacing.sm },
            ]}
          >
            {t(`network.statusHint.${state}`)}
          </Text>
          {settings.enabled ? (
            <View style={{ marginTop: spacing.md }}>
              <CaptureControls
                session={settings.session}
                disabled={false}
                onChange={networkActions.setSession}
              />
            </View>
          ) : null}
        </Card>

        <Card flat>
          <ListRow
            title={t('network.hub.viewCalls')}
            subtitle={t('network.hub.recordedCount', { count: calls.length })}
            icon="listChecks"
            chevron
            onPress={() => navigation.navigate(ROUTES.NETWORK_CALLS)}
            testID="net-open-calls"
          />
        </Card>

        {/* Browser */}
        <View>
          {sectionTitle(t('network.hub.browserSection'))}
          <Card>
            <TextField
              label={t('network.hub.addressLabel')}
              placeholder={t('network.hub.addressPlaceholder')}
              value={address}
              onChangeText={text => {
                setAddress(text);
                if (addressError) setAddressError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={onOpen}
              error={addressError}
              testID="net-address"
            />
            <Button
              label={t('network.hub.open')}
              iconName="globe"
              onPress={onOpen}
              style={{ marginTop: spacing.md }}
              testID="net-open"
            />
            {settings.domains.length ? (
              <View
                style={[
                  styles.wrap,
                  { gap: spacing.sm, marginTop: spacing.md },
                ]}
              >
                {settings.domains.map(d => (
                  <Pressable
                    key={d.host}
                    onPress={() => openUrl(`https://${d.host}/`)}
                    accessibilityRole="button"
                    accessibilityLabel={t('network.hub.quickOpen', {
                      host: d.host,
                    })}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        gap: spacing.xs,
                        paddingHorizontal: spacing.md,
                        borderRadius: radius.pill,
                        backgroundColor: pressed
                          ? colors.primarySoft
                          : colors.surfaceMuted,
                      },
                    ]}
                    testID={`net-quick-${d.host}`}
                  >
                    <Icon name="globe" size={14} color={colors.primaryText} />
                    <Text
                      style={[
                        typography.caption,
                        { color: colors.textPrimary },
                      ]}
                    >
                      {d.host}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>
        </View>

        {/* Allowed domains */}
        <View>
          {sectionTitle(t('network.hub.domainsSection'))}
          <Card>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('network.hub.domainsHint')}
            </Text>
            {settings.domains.length ? (
              <View
                style={{ marginTop: spacing.md, gap: spacing.sm }}
                testID="net-domains"
              >
                {settings.domains.map(d => (
                  <View
                    key={d.host}
                    style={[
                      styles.rowBetween,
                      {
                        gap: spacing.sm,
                        padding: spacing.sm,
                        borderRadius: radius.md,
                        backgroundColor: colors.surfaceMuted,
                      },
                    ]}
                  >
                    <View style={styles.flex}>
                      <Text
                        style={[
                          typography.label,
                          { color: colors.textPrimary },
                        ]}
                      >
                        {d.host}
                      </Text>
                      <Text
                        style={[
                          typography.caption,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {d.includeSubdomains
                          ? t('network.hub.subdomainsOf', { host: d.host })
                          : t('network.hub.exactHost', { host: d.host })}
                      </Text>
                    </View>
                    <ToggleSwitch
                      isOn={d.includeSubdomains}
                      onToggle={on => networkActions.setSubdomains(d.host, on)}
                      accessibilityLabel={`${t(
                        'network.hub.includeSubdomains',
                      )}: ${d.host}`}
                    />
                    <Pressable
                      onPress={() => networkActions.removeDomain(d.host)}
                      accessibilityRole="button"
                      accessibilityLabel={t('network.hub.removeDomain', {
                        host: d.host,
                      })}
                      hitSlop={8}
                      style={styles.iconButton}
                      testID={`net-remove-${d.host}`}
                    >
                      <Icon name="trash2" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState
                icon="globe"
                title={t('network.hub.noDomains')}
                message={t('network.hub.noDomainsHint')}
                compact
              />
            )}
            <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
              <TextField
                label={t('network.hub.domainLabel')}
                placeholder={t('network.hub.domainPlaceholder')}
                value={domain}
                onChangeText={text => {
                  setDomain(text);
                  if (domainError) setDomainError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={onAddDomain}
                error={domainError}
                testID="net-domain-input"
              />
              <View style={[styles.rowBetween, { gap: spacing.md }]}>
                <Text
                  style={[
                    typography.body,
                    styles.flex,
                    { color: colors.textPrimary },
                  ]}
                >
                  {t('network.hub.includeSubdomains')}
                </Text>
                <ToggleSwitch
                  isOn={subdomains}
                  onToggle={setSubdomains}
                  accessibilityLabel={t('network.hub.includeSubdomains')}
                />
              </View>
              <Button
                label={t('network.hub.addDomain')}
                iconName="plus"
                variant="soft"
                onPress={onAddDomain}
                testID="net-add-domain"
              />
            </View>
          </Card>
        </View>

        {/* Privacy & limits */}
        <View>
          {sectionTitle(t('network.hub.privacySection'))}
          <Card>
            <View style={{ gap: spacing.sm }}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('network.hub.scope')}
              </Text>
              <SegmentedControl<CaptureScope>
                options={[
                  {
                    value: 'allowedOnly',
                    label: t('network.hub.scopeAllowedOnly'),
                  },
                  {
                    value: 'allFromPage',
                    label: t('network.hub.scopeAllFromPage'),
                  },
                ]}
                value={settings.scope}
                onChange={scope => networkActions.update({ scope })}
                accessibilityLabel={t('network.hub.scope')}
                testID="net-scope"
              />
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {settings.scope === 'allowedOnly'
                  ? t('network.hub.scopeAllowedOnlyHint')
                  : t('network.hub.scopeAllFromPageHint')}
              </Text>
            </View>
            <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('network.hub.bodyLimit')}
              </Text>
              <SegmentedControl<`${BodyLimitKb}`>
                options={BODY_LIMITS_KB.map(kb => ({
                  value: `${kb}` as const,
                  label: kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`,
                }))}
                value={`${settings.bodyLimitKb}`}
                onChange={value =>
                  networkActions.update({
                    bodyLimitKb: Number(value) as BodyLimitKb,
                  })
                }
                accessibilityLabel={t('network.hub.bodyLimit')}
                testID="net-body-limit"
              />
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t('network.hub.bodyLimitHint')}
              </Text>
            </View>
            <View
              style={[
                styles.rowBetween,
                { gap: spacing.md, marginTop: spacing.lg },
              ]}
            >
              <View style={[styles.flex, { gap: spacing.xs }]}>
                <Text style={[typography.label, { color: colors.textPrimary }]}>
                  {t('network.hub.includeSensitive')}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('network.hub.includeSensitiveHint')}
                </Text>
              </View>
              <ToggleSwitch
                isOn={settings.includeSensitive}
                onToggle={includeSensitive =>
                  networkActions.update({ includeSensitive })
                }
                accessibilityLabel={t('network.hub.includeSensitive')}
              />
            </View>
            <Button
              label={t('network.hub.clear')}
              iconName="trash2"
              variant="danger"
              disabled={!calls.length}
              onPress={onClear}
              style={{ marginTop: spacing.lg }}
              testID="net-clear"
            />
          </Card>
        </View>

        <Text
          style={[
            typography.caption,
            styles.center,
            { color: colors.textSecondary },
          ]}
        >
          {t('network.hub.privacyNote')}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
});
