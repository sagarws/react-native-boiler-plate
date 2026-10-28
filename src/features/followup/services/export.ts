import type { FollowUpData } from '../types';

/** One CSV cell, quoted when needed (RFC 4180). */
const cell = (v: string | number | boolean) => {
  const s = String(v);
  // A leading = + - @ would run as a formula in a spreadsheet app.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const row = (values: (string | number | boolean)[]) =>
  values.map(cell).join(',');

/** Contacts as CSV (one row per contact, names for category and tags). */
export function contactsCsv(data: FollowUpData): string {
  const cat = new Map(data.categories.map(c => [c.id, c.name]));
  const tag = new Map(data.tags.map(t => [t.id, t.name]));
  const lines = [
    row([
      'name',
      'phone',
      'email',
      'organization',
      'location',
      'birth_date',
      'category',
      'tags',
      'active',
      'notes',
      'created_at',
    ]),
    ...data.contacts.map(c =>
      row([
        c.name,
        `+${c.e164}`,
        c.email,
        c.organization,
        c.location,
        c.birthDate,
        cat.get(c.categoryId) ?? '',
        c.tagIds
          .map(id => tag.get(id) ?? '')
          .filter(Boolean)
          .join('; '),
        c.isActive,
        c.notes,
        c.createdAt,
      ]),
    ),
  ];
  return lines.join('\r\n');
}

/** Follow-up history as CSV (one row per follow-up). */
export function activitiesCsv(data: FollowUpData): string {
  const names = new Map(data.contacts.map(c => [c.id, c.name]));
  const lines = [
    row([
      'contact',
      'date',
      'time',
      'type',
      'purpose',
      'status',
      'completed_at',
      'outcome',
      'completion_note',
    ]),
    ...data.activities.map(a =>
      row([
        names.get(a.contactId) ?? '',
        a.day,
        a.time,
        a.type,
        a.purpose,
        a.completedAt ? 'completed' : a.cancelled ? 'cancelled' : 'open',
        a.completedAt,
        a.outcome,
        a.completionNote,
      ]),
    ),
  ];
  return lines.join('\r\n');
}

/** Everything, as a JSON backup (attachments are referenced, not embedded). */
export function backupJson(data: FollowUpData, exportedAt: Date): string {
  const { contacts, activities, notes, events, categories, tags, settings } =
    data;
  return JSON.stringify(
    {
      app: 'akshar-followup',
      schema: 1,
      exportedAt: exportedAt.toISOString(),
      contacts,
      activities,
      notes,
      events,
      categories,
      tags,
      settings,
    },
    null,
    2,
  );
}
