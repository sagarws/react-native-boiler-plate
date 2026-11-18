import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, type ColorPalette } from '@/theme';
import { codeText } from './codeText';

/** Highlighting builds one Text span per token; past this, plain text. */
const HIGHLIGHT_LIMIT = 30_000;
/** Rendering more than this in one Text is slow on mid-range phones. */
const DISPLAY_LIMIT = 200_000;

type Token = {
  text: string;
  kind: 'key' | 'string' | 'number' | 'literal' | 'plain';
};

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

/** Splits pretty-printed JSON into coloured tokens. */
export function tokenizeJson(source: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of source.matchAll(JSON_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) tokens.push({ text: source.slice(last, at), kind: 'plain' });
    if (match[1]) {
      tokens.push({ text: match[1], kind: match[2] ? 'key' : 'string' });
      if (match[2]) tokens.push({ text: match[2], kind: 'plain' });
    } else if (match[3]) {
      tokens.push({ text: match[3], kind: 'number' });
    } else {
      tokens.push({ text: match[0], kind: 'literal' });
    }
    last = at + match[0].length;
  }
  if (last < source.length)
    tokens.push({ text: source.slice(last), kind: 'plain' });
  return tokens;
}

function tokenColor(kind: Token['kind'], colors: ColorPalette): string {
  switch (kind) {
    case 'key':
      return colors.primaryText;
    case 'string':
      return colors.success;
    case 'number':
      return colors.warning;
    case 'literal':
      return colors.error;
    default:
      return colors.textPrimary;
  }
}

export interface CodeBlockProps {
  text: string;
  json?: boolean;
  testID?: string;
}

/** Monospace, selectable, horizontally scrollable code / payload view. */
export function CodeBlock({ text, json = false, testID }: CodeBlockProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const shown =
    text.length > DISPLAY_LIMIT ? text.slice(0, DISPLAY_LIMIT) : text;
  const tokens = useMemo(
    () =>
      json && shown.length <= HIGHLIGHT_LIMIT ? tokenizeJson(shown) : null,
    [json, shown],
  );
  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.lg,
        },
      ]}
    >
      <ScrollView horizontal nestedScrollEnabled>
        <Text
          selectable
          style={[
            codeText(typography),
            { color: colors.textPrimary, padding: spacing.md },
          ]}
          testID={testID}
        >
          {tokens
            ? tokens.map((token, i) =>
                token.kind === 'plain' ? (
                  token.text
                ) : (
                  <Text
                    key={i}
                    style={{ color: tokenColor(token.kind, colors) }}
                  >
                    {token.text}
                  </Text>
                ),
              )
            : shown}
        </Text>
      </ScrollView>
      {shown.length < text.length ? (
        <Text
          style={[
            typography.caption,
            styles.note,
            {
              color: colors.textSecondary,
              paddingHorizontal: spacing.md,
              paddingBottom: spacing.md,
            },
          ]}
        >
          {t('network.detail.displayTrimmed', {
            shown: Math.round(DISPLAY_LIMIT / 1000),
          })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  note: { paddingTop: 0 },
});
