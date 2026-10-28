import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Loader,
  Notice,
  SegmentedControl,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { useDescribeTarget } from '../../hooks/useLife';
import { useRecommendations } from '../../hooks/useRecommendations';
import {
  dailyTrend,
  quantitiesByTask,
  reasonBreakdown,
  weeklyTrend,
} from '../../services/analytics';
import { nextPeriodStart } from '../../services/periods';
import type { Recommendation } from '../../types';
import { addDays, mondayOf } from '../../utils/dates';
import { formatDay, formatQty } from '../../utils/format';
import { BarChart, HBars, Heatmap, type HeatCell } from '../charts';
import { ProjectChips } from './ProjectChips';
import type { TabProps } from './shared';

type Range = '7' | '30' | '90';

/** Charts from persisted reports + AI recommendations on request. */
export function InsightsTab({ data, today, onTab }: TabProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const describe = useDescribeTarget();
  const [range, setRange] = useState<Range>('30');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ai = useRecommendations(today, projectId ?? undefined);
  const pid = projectId ?? undefined;
  const from = addDays(today, -Number(range));

  const weeks = weeklyTrend(data, 8, today, pid);
  const reasons = reasonBreakdown(data, from, today, pid);
  const quantities = quantitiesByTask(data, from, today, today, pid);
  const heatStart = addDays(mondayOf(today), -77);
  const days = dailyTrend(
    data,
    heatStart,
    addDays(mondayOf(today), 6),
    today,
    pid,
  );
  const heat: HeatCell[][] = [];
  for (let w = 0; w < 12; w++) {
    heat.push(
      days.slice(w * 7, w * 7 + 7).map(p => ({
        key: p.day,
        value: p.rate === null ? null : p.rate / 100,
        a11y: `${formatDay(p.day)}: ${
          p.rate === null ? t('life.noValue') : `${p.rate}%`
        }`,
        onPress: () => onTab('calendar'),
      })),
    );
  }

  const review = (rec: Recommendation) => {
    const task = data.tasks.find(x => x.id === rec.taskId);
    if (!task || !rec.proposedTarget) return;
    const current = task.targets[task.targets.length - 1];
    Alert.alert(
      t('life.reviewChangeTitle'),
      t('life.reviewChangeBody', {
        task: task.name,
        current: describe(current, task.unit),
        proposed: describe(rec.proposedTarget, task.unit),
        date: formatDay(nextPeriodStart(task, today)),
      }),
      [
        {
          text: t('life.reject'),
          style: 'cancel',
          onPress: () => setNotice(t('life.aiRejected')),
        },
        {
          text: t('life.accept'),
          onPress: () => {
            const date = ai.accept(rec);
            if (date)
              setNotice(t('life.aiAccepted', { date: formatDay(date) }));
          },
        },
      ],
    );
  };

  const title = [typography.title, { color: colors.textPrimary }];
  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <View style={{ gap: spacing.md }}>
      <ProjectChips
        projects={data.projects.filter(p => p.status === 'active')}
        value={projectId}
        onChange={setProjectId}
        testID="insights-project"
      />
      <SegmentedControl
        testID="insights-range"
        accessibilityLabel={t('life.insightsRange')}
        value={range}
        onChange={setRange}
        options={(['7', '30', '90'] as const).map(r => ({
          value: r,
          label: t(`life.range_${r}`),
        }))}
      />

      <Card testID="insights-ai">
        <Text style={title}>{t('life.aiTitle')}</Text>
        <Text style={[caption, { marginBottom: spacing.sm }]}>
          {t('life.aiPrivacy')}
        </Text>
        {notice ? (
          <Notice
            tone="success"
            message={notice}
            onDismiss={() => setNotice(null)}
          />
        ) : null}
        {!ai.enough ? (
          <Notice
            tone="info"
            message={t('life.aiNotEnough', {
              count: ai.history,
              needed: ai.needed,
            })}
            testID="ai-not-enough"
          />
        ) : (
          <Button
            iconName="sparkles"
            label={
              ai.cached ? t('life.aiRefresh') : t('life.getRecommendations')
            }
            onPress={() => {
              void ai.request();
            }}
            loading={ai.state === 'loading'}
            disabled={ai.state === 'loading'}
            testID="ai-request"
          />
        )}
        {ai.state === 'loading' ? (
          <View
            style={[styles.row, { gap: spacing.sm, marginTop: spacing.sm }]}
          >
            <Loader />
            <Text style={caption}>{t('life.aiLoading')}</Text>
          </View>
        ) : null}
        {ai.state === 'cooldown' ? (
          <Notice tone="info" message={t('life.aiCooldown')} />
        ) : null}
        {ai.state === 'error' && ai.error ? (
          <Notice
            tone="error"
            testID="ai-error"
            message={t('life.aiFailed', {
              reason: t(
                [
                  'no_key',
                  'no_internet',
                  'timeout',
                  'quota',
                  'invalid_key',
                  'api_disabled',
                  'model_not_found',
                  'bad_response',
                ].includes(ai.error)
                  ? `life.aiReason_${ai.error}`
                  : 'life.aiReason_other',
              ),
            })}
          />
        ) : null}

        {ai.cached ? (
          <View
            style={{ gap: spacing.md, marginTop: spacing.md }}
            testID="ai-results"
          >
            <Text style={caption}>
              {t('life.aiGenerated', {
                date: new Date(ai.cached.generatedAt).toLocaleString([], {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </Text>
            {ai.stale ? (
              <Notice tone="warning" message={t('life.aiStale')} />
            ) : null}
            {ai.cached.summary ? (
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                {ai.cached.summary}
              </Text>
            ) : null}
            {ai.cached.items.map((rec, i) => (
              <View
                key={`${rec.title}-${i}`}
                style={[
                  styles.rec,
                  {
                    borderTopColor: colors.divider,
                    paddingTop: spacing.sm,
                    gap: spacing.xs / 2,
                  },
                ]}
              >
                <Text style={caption}>
                  {t(`life.category_${rec.category}`)} ·{' '}
                  {t(`life.priority_${rec.priority}`)}
                </Text>
                <Text style={[typography.label, { color: colors.textPrimary }]}>
                  {rec.title}
                </Text>
                {rec.explanation ? (
                  <Text
                    style={[typography.body, { color: colors.textPrimary }]}
                  >
                    {rec.explanation}
                  </Text>
                ) : null}
                {rec.evidence ? (
                  <Text style={caption}>
                    {t('life.aiEvidence', { text: rec.evidence })}
                  </Text>
                ) : null}
                {rec.action ? (
                  <Text
                    style={[typography.body, { color: colors.textPrimary }]}
                  >
                    {t('life.aiAction', { text: rec.action })}
                  </Text>
                ) : null}
                {rec.proposedTarget && rec.taskId ? (
                  <>
                    <Text style={caption}>
                      {t('life.aiProposed', {
                        target: describe(
                          rec.proposedTarget,
                          data.tasks.find(x => x.id === rec.taskId)?.unit ?? '',
                        ),
                      })}
                    </Text>
                    <Button
                      size="sm"
                      variant="soft"
                      label={t('life.aiReview')}
                      onPress={() => review(rec)}
                      testID={`ai-review-${i}`}
                    />
                  </>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={title}>{t('life.localTitle')}</Text>
        <View
          style={{ gap: spacing.xs, marginTop: spacing.xs }}
          testID="insights-local"
        >
          {ai.insights.map((i, n) => (
            <Text
              key={n}
              style={[typography.body, { color: colors.textPrimary }]}
            >
              •{' '}
              {t(`life.local_${i.kind}`, {
                ...i.values,
                reason: i.values.reason
                  ? t(`life.reason_${i.values.reason}`)
                  : undefined,
              })}
            </Text>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={[title, { marginBottom: spacing.sm }]}>
          {t('life.weeklyTrendTitle')}
        </Text>
        <BarChart
          testID="insights-weekly"
          emptyText={t('life.noEndedPeriods')}
          points={weeks.map(w => ({
            label: formatDay(w.weekStart),
            value: w.rate,
            a11y: `${formatDay(w.weekStart)}: ${w.rate ?? t('life.noValue')}`,
          }))}
        />
      </Card>

      <Card>
        <Text style={[title, { marginBottom: spacing.sm }]}>
          {t('life.reasonsTitle')}
        </Text>
        <HBars
          testID="insights-reasons"
          emptyText={t('life.reasonsEmpty')}
          rows={reasons.map(r => ({
            label: t(`life.reason_${r.reason}`),
            value: r.count,
          }))}
        />
      </Card>

      <Card>
        <Text style={title}>{t('life.heatmapTitle')}</Text>
        <Text style={[caption, { marginBottom: spacing.sm }]}>
          {t('life.heatmapHint')}
        </Text>
        <Heatmap weeks={heat} testID="insights-heatmap" />
      </Card>

      <Card>
        <Text style={title}>{t('life.quantitiesTitle')}</Text>
        <Text style={[caption, { marginBottom: spacing.sm }]}>
          {t('life.quantitiesHint')}
        </Text>
        <HBars
          testID="insights-quantities"
          emptyText={t('life.noEndedPeriods')}
          rows={quantities
            .filter(q => q.target > 0)
            .map(q => ({
              label: `${q.task.name} (${formatQty(q.actual)} / ${formatQty(
                q.target,
              )} ${q.unit})`,
              value: Math.round((q.actual / q.target) * 100),
              suffix: '%',
            }))}
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rec: { borderTopWidth: StyleSheet.hairlineWidth },
});
