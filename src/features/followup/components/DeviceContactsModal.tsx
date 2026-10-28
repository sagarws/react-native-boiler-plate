import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  EmptyState,
  Header,
  Icon,
  Loader,
  Notice,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { useDeviceContacts } from '../hooks/useDeviceContacts';
import { useFollowUpData } from '../hooks/useFollowUp';
import { searchContacts, type DeviceContact } from '../services/deviceContacts';
import { parsePhone } from '../utils/phone';
import { ContactAvatar } from './ContactCard';

/**
 * The phone's contacts, searchable by name or number. Choosing one (and,
 * when it has several, one of its numbers) hands it to [onSelect]; nothing
 * else from the address book is kept.
 */
export function DeviceContactsModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (contact: DeviceContact, phone: string) => void;
}) {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const data = useFollowUpData();
  const { state, load, pickWithSystem, openSettings } = useDeviceContacts();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setExpanded(null);
      void load();
    }
  }, [visible, load]);

  const contacts = useMemo(
    () => (state.kind === 'ready' ? state.contacts : []),
    [state],
  );
  const results = useMemo(
    () => searchContacts(contacts, query),
    [contacts, query],
  );
  const saved = useMemo(
    () => new Set(data.contacts.map(c => c.e164)),
    [data.contacts],
  );
  const isSaved = (phone: string) => {
    const parsed = parsePhone(phone, data.settings.defaultDial);
    return parsed.ok && saved.has(parsed.value.e164);
  };

  const choose = (contact: DeviceContact, phone: string) => {
    onSelect(contact, phone);
    onClose();
  };

  const pickOneWithSystem = async () => {
    const picked = await pickWithSystem();
    if (picked) choose(picked, picked.phones[0]);
  };

  if (!visible) return null;

  const caption = [typography.caption, { color: colors.textSecondary }];

  const body = () => {
    switch (state.kind) {
      case 'idle':
      case 'loading':
        return <Loader />;
      case 'denied':
      case 'blocked':
        return (
          <View style={{ gap: spacing.md, padding: spacing.lg }}>
            <Notice
              tone="warning"
              title={t('followUp.contactsAccessTitle')}
              message={t(
                state.kind === 'blocked'
                  ? 'followUp.contactsBlocked'
                  : 'followUp.contactsDenied',
              )}
              action={
                state.kind === 'blocked'
                  ? { label: t('followUp.openSettings'), onPress: openSettings }
                  : {
                      label: t('followUp.allowContacts'),
                      onPress: () => {
                        void load();
                      },
                    }
              }
              testID="contacts-permission"
            />
            <Button
              variant="soft"
              iconName="bookUser"
              label={t('followUp.useSystemPicker')}
              onPress={() => {
                void pickOneWithSystem();
              }}
              testID="contacts-system-picker"
            />
          </View>
        );
      case 'error':
        return (
          <EmptyState
            icon="triangleAlert"
            title={t('followUp.contactsError')}
            action={{
              label: t('followUp.useSystemPicker'),
              onPress: () => {
                void pickOneWithSystem();
              },
            }}
          />
        );
      default:
        return (
          <FlatList
            testID="contacts-list"
            data={results}
            keyExtractor={c => c.id}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingBottom: bottom + spacing.xl,
            }}
            ListEmptyComponent={
              <EmptyState
                compact
                icon="search"
                title={
                  contacts.length
                    ? t('followUp.contactsNoMatch')
                    : t('followUp.contactsEmpty')
                }
              />
            }
            renderItem={({ item }) => {
              const multiple = item.phones.length > 1;
              const open = expanded === item.id;
              return (
                <View
                  style={[
                    styles.item,
                    {
                      borderBottomColor: colors.border,
                      paddingVertical: spacing.sm,
                    },
                  ]}
                >
                  <Pressable
                    testID={`device-contact-${item.id}`}
                    onPress={() =>
                      multiple
                        ? setExpanded(open ? null : item.id)
                        : choose(item, item.phones[0])
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}, ${item.phones.join(
                      ', ',
                    )}`}
                    style={[styles.row, { gap: spacing.md }]}
                  >
                    <ContactAvatar
                      name={item.name || '#'}
                      photoUri=""
                      color={colors.primary}
                      size={40}
                    />
                    <View style={styles.flex}>
                      <Text
                        style={[
                          typography.label,
                          { color: colors.textPrimary },
                        ]}
                        numberOfLines={1}
                      >
                        {item.name || item.phones[0]}
                      </Text>
                      <Text style={caption} numberOfLines={1}>
                        {multiple
                          ? t('followUp.contactNumbers', {
                              first: item.phones[0],
                              count: item.phones.length - 1,
                            })
                          : item.phones[0]}
                      </Text>
                    </View>
                    {item.phones.some(isSaved) ? (
                      <Text
                        style={[typography.caption, { color: colors.success }]}
                      >
                        {t('followUp.alreadyAdded')}
                      </Text>
                    ) : null}
                    {multiple ? (
                      <Icon
                        name="chevronRight"
                        size={18}
                        color={colors.textSecondary}
                        style={open ? styles.rotated : undefined}
                      />
                    ) : null}
                  </Pressable>
                  {open ? (
                    <View
                      style={[
                        styles.numbers,
                        { gap: spacing.xs, paddingTop: spacing.xs },
                      ]}
                    >
                      <Text style={caption}>{t('followUp.chooseNumber')}</Text>
                      {item.phones.map(phone => (
                        <Pressable
                          key={phone}
                          onPress={() => choose(item, phone)}
                          accessibilityRole="button"
                          accessibilityLabel={phone}
                          style={[
                            styles.row,
                            {
                              gap: spacing.sm,
                              padding: spacing.sm,
                              borderRadius: radius.md,
                              backgroundColor: colors.surfaceMuted,
                            },
                          ]}
                        >
                          <Icon
                            name="phone"
                            size={16}
                            color={colors.primaryText}
                          />
                          <Text
                            style={[
                              typography.body,
                              styles.flex,
                              { color: colors.textPrimary },
                            ]}
                          >
                            {phone}
                          </Text>
                          {isSaved(phone) ? (
                            <Text
                              style={[
                                typography.caption,
                                { color: colors.success },
                              ]}
                            >
                              {t('followUp.alreadyAdded')}
                            </Text>
                          ) : null}
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            }}
          />
        );
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('followUp.pickFromContacts')} onBackPress={onClose} />
        {state.kind === 'ready' ? (
          <View style={{ padding: spacing.lg, gap: spacing.xs }}>
            <View
              style={[
                styles.row,
                styles.search,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  gap: spacing.sm,
                },
              ]}
            >
              <Icon name="search" size={18} color={colors.textSecondary} />
              <TextInput
                testID="contacts-search"
                value={query}
                onChangeText={setQuery}
                autoFocus
                placeholder={t('followUp.searchPlaceholder')}
                placeholderTextColor={colors.placeholder}
                accessibilityLabel={t('followUp.searchPlaceholder')}
                style={[
                  typography.body,
                  styles.flex,
                  { color: colors.textPrimary },
                ]}
              />
            </View>
            <Text style={caption}>
              {t('followUp.contactsCount', { count: results.length })} ·{' '}
              {t('followUp.contactsPrivacy')}
            </Text>
          </View>
        ) : null}
        {body()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  search: { borderWidth: 1, minHeight: 48 },
  item: { borderBottomWidth: StyleSheet.hairlineWidth },
  rotated: { transform: [{ rotate: '90deg' }] },
  numbers: { paddingLeft: 56 },
});
