import type { AlertConfig, Repeat } from '@/services/alarms';
import type { DayKey } from '@/shared/utils/dayKey';

export const CATEGORIES = [
  'birthday',
  'personal',
  'meeting',
  'important',
  'custom',
] as const;
export type ReminderCategory = (typeof CATEGORIES)[number];

/** Highlighted on the dashboard and calendar. */
export const HIGHLIGHT: readonly ReminderCategory[] = ['birthday', 'important'];

/** Theme category-palette key per category. */
export const CATEGORY_COLOR: Record<ReminderCategory, string> = {
  birthday: 'rose',
  personal: 'blue',
  meeting: 'teal',
  important: 'amber',
  custom: 'slate',
};

export const CATEGORY_ICON = {
  birthday: 'cake',
  personal: 'bell',
  meeting: 'users',
  important: 'triangleAlert',
  custom: 'tag',
} as const;

/** "HH:MM", 24-hour, local. */
export type TimeKey = string;

export interface Reminder {
  id: string;
  title: string;
  description: string;
  /** First (or only) date, local calendar day. */
  date: DayKey;
  time: TimeKey;
  category: ReminderCategory;
  /** The user's own label for 'custom'. */
  customLabel: string;
  repeat: Repeat;
  enabled: boolean;
  alert: AlertConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderInput {
  title: string;
  description: string;
  date: DayKey;
  time: TimeKey;
  category: ReminderCategory;
  customLabel: string;
  repeat: Repeat;
  alert: AlertConfig;
}

export type ReminderError =
  | 'title_required'
  | 'date_invalid'
  | 'time_invalid'
  | 'in_past'
  | 'not_found'
  | 'limit';
