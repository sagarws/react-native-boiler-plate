/** "12.3 MB"; '' for 0 (folders and Google Docs report no size). */
export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Time today, else "12 Oct · 14:05"; '' when unknown. */
export function formatWhen(ms: number, now: Date = new Date()): string {
  if (!ms) return '';
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
  })} · ${time}`;
}

/** A broad kind for choosing an icon. */
export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'archive'
  | 'text'
  | 'doc'
  | 'other';

export function fileKind(mimeType: string, name: string): FileKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (/zip|compressed|tar|rar|7z/.test(mimeType)) return 'archive';
  if (/^text\/|json|xml|javascript/.test(mimeType)) return 'text';
  if (
    /vnd\.google-apps|officedocument|msword|ms-excel|opendocument/.test(
      mimeType,
    ) ||
    /\.(docx?|xlsx?|pptx?|odt|ods)$/i.test(name)
  ) {
    return 'doc';
  }
  return 'other';
}
