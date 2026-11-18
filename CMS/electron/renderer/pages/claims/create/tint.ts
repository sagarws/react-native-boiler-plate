/**
 * A theme colour at partial opacity, as a CSS value.
 *
 * WHY THIS EXISTS. The ported form is full of scrims and tints — a dark wash
 * behind a delete button on a photograph, a faint brand fill on a drop target
 * — and TrackVid-FE writes each as a literal `rgba(0,0,0,0.55)`. A literal is
 * the one thing a component here may not contain: it keeps its light-mode value
 * when the operator switches to dark, and it cannot follow the primary colour
 * they chose.
 *
 * The theme already publishes every palette entry as a CHANNEL — three numbers
 * with no alpha — precisely so a caller can supply its own. That is what the
 * ported design system does (`rgb(var(--mui-palette-primary-mainChannel) /
 * 0.7)` in `@core/styles`), and this says the same thing once instead of at
 * fifty call sites.
 *
 *   bgcolor: tint('common.black', 0.55)
 *   borderColor: tint('primary.main', 0.08)
 *
 * The alternative — an `sx` callback and MUI's `alpha()` at every site — is the
 * same value written in more places, and it resolves at render rather than
 * letting the browser re-resolve it when the scheme changes.
 */

/**
 * A palette path, dotted as MUI writes it.
 *
 * Only the ones this form uses. Naming them makes a typo a compile error rather
 * than a colour that silently resolves to nothing — which renders as fully
 * transparent, and looks exactly like a scrim that was never applied.
 */
export type TintablePalette =
  | 'common.black'
  | 'common.white'
  | 'primary.main'
  | 'primary.light'
  | 'primary.dark'
  | 'error.main'
  | 'success.main'
  | 'text.primary'

export const tint = (palette: TintablePalette, opacity: number): string => {
  const [group, shade] = palette.split('.')

  return `rgb(var(--mui-palette-${group}-${shade}Channel) / ${opacity})`
}
