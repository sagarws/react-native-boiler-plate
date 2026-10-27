import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  speechService,
  VOICE_LANGUAGE_ORDER,
  voicesFor,
  type SpeechInfo,
  type SpeechLanguage,
  type SpeechSettings,
  type UseVoicePreview,
} from '@/features/capture';
import {
  animateNextLayout,
  Button,
  Icon,
  Notice,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { TtsVoiceRow } from './TtsVoiceRow';

export interface TtsLanguageSectionProps {
  info: SpeechInfo;
  speech: SpeechSettings;
  preview: UseVoicePreview;
  /** Selecting a voice (or a language's default voice) sets the speech language too. */
  onSelect: (language: SpeechLanguage, voiceName: string) => void;
}

/**
 * Language-first voice picker: English, ગુજરાતી, हिन्दी — only these three —
 * each expanding (one at a time) to the voices the device's engine actually
 * reports for it. A language with no usable voice shows how to install one;
 * nothing is substituted.
 */
export function TtsLanguageSection({
  info,
  speech,
  preview,
  onSelect,
}: TtsLanguageSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const [open, setOpen] = useState<SpeechLanguage | null>(speech.language);

  const toggle = (language: SpeechLanguage) => {
    animateNextLayout();
    setOpen(current => (current === language ? null : language));
  };

  return (
    <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
      {VOICE_LANGUAGE_ORDER.map(language => {
        const status = info.languages[language];
        const voices = voicesFor(info, language);
        const usable = status === 'available' && voices.length > 0;
        const inUse = speech.language === language;
        const expanded = open === language;
        const name = t(`speech.lang_${language}_name`);
        const native = t(`speech.lang_${language}`);
        return (
          <View
            key={language}
            testID={`voice-language-${language}`}
            style={[
              styles.language,
              {
                borderRadius: radius.lg,
                borderColor: inUse ? colors.primary : colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <Pressable
              testID={`voice-language-${language}-header`}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ expanded, selected: inUse }}
              onPress={() => toggle(language)}
              style={({ pressed }) => [
                styles.header,
                { padding: spacing.md, gap: spacing.md },
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <View style={styles.flex}>
                <Text style={[typography.label, { color: colors.textPrimary }]}>
                  {language === 'en' ? name : `${native} · ${name}`}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {usable
                    ? t('speech.voiceCount', { count: voices.length })
                    : status === 'available'
                    ? t('speech.noVoiceInstalled')
                    : t(`speech.status_${status}`)}
                </Text>
              </View>
              {inUse ? (
                <StatusPill label={t('speech.inUse')} tone="primary" />
              ) : null}
              <Icon
                name="chevronRight"
                size={18}
                color={colors.placeholder}
                style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
              />
            </Pressable>

            {expanded ? (
              <View
                style={{
                  padding: spacing.md,
                  paddingTop: 0,
                  gap: spacing.sm,
                }}
              >
                {usable ? (
                  <>
                    <TtsVoiceRow
                      voice={null}
                      testID={`voice-${language}-default`}
                      title={t('speech.defaultVoice')}
                      description={t('speech.defaultVoiceDescription', {
                        language: name,
                      })}
                      selected={inUse && speech.voiceName === ''}
                      playing={false}
                      onSelect={() => onSelect(language, '')}
                    />
                    {voices.map(voice => (
                      <TtsVoiceRow
                        key={voice.name}
                        voice={voice}
                        testID={`voice-${voice.name}`}
                        title={voice.name}
                        description={[
                          voice.locale,
                          voice.networkRequired
                            ? t('speech.voiceNetwork')
                            : t('speech.voiceOffline'),
                          voice.installed
                            ? null
                            : t('speech.voiceNotInstalled'),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        selected={inUse && speech.voiceName === voice.name}
                        playing={preview.playing === voice.name}
                        onSelect={() => onSelect(language, voice.name)}
                        onPreview={() => preview.toggle(voice)}
                      />
                    ))}
                  </>
                ) : (
                  <View
                    style={{ gap: spacing.sm }}
                    testID={`voice-${language}-empty`}
                  >
                    <Text
                      style={[typography.body, { color: colors.textPrimary }]}
                    >
                      {t('speech.emptyVoices', { language: name })}
                    </Text>
                    <Text
                      style={[
                        typography.caption,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {t('speech.emptyVoicesHint')}
                    </Text>
                    <Button
                      size="sm"
                      variant="soft"
                      iconName="download"
                      label={t('speech.installVoices')}
                      onPress={speechService.installVoiceData}
                    />
                  </View>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
      {preview.problem ? (
        <Notice
          testID="voice-preview-problem"
          tone="warning"
          message={t(`speech.preview_${preview.problem}`)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  language: { borderWidth: 1.5, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  flex: { flex: 1 },
});
