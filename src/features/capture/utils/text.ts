export interface TextSelection {
  start: number;
  end: number;
}

/** The selected slice if the user selected something, otherwise the whole text. */
export function selectedOrAll(
  text: string,
  selection?: TextSelection | null,
): string {
  if (!selection) return text;
  const start = Math.max(0, Math.min(selection.start, selection.end));
  const end = Math.min(text.length, Math.max(selection.start, selection.end));
  return end > start ? text.slice(start, end) : text;
}

/** One-paragraph preview: whitespace collapsed, cut at a word boundary. */
export function previewText(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6
    ? cut.slice(0, lastSpace)
    : cut
  ).trimEnd()}…`;
}

export function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length;
}
