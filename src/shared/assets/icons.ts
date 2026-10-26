import type { ImageSourcePropType } from 'react-native';

/**
 * Interface icons — one family (Lucide, ISC licence, see
 * ./icons/LICENSE-lucide.txt), rendered white on transparent so `<Icon>` can
 * tint them from the active theme. To add one, render its SVG at 96px into
 * ./icons and add a row here.
 */
export const icons = {
  accessibility: require('./icons/accessibility.png'),
  arrowLeft: require('./icons/arrow-left.png'),
  audioLines: require('./icons/audio-lines.png'),
  bell: require('./icons/bell.png'),
  check: require('./icons/check.png'),
  chevronRight: require('./icons/chevron-right.png'),
  circleCheck: require('./icons/circle-check.png'),
  circleHelp: require('./icons/circle-help.png'),
  clipboardCheck: require('./icons/clipboard-check.png'),
  copy: require('./icons/copy.png'),
  download: require('./icons/download.png'),
  eye: require('./icons/eye.png'),
  gauge: require('./icons/gauge.png'),
  history: require('./icons/history.png'),
  info: require('./icons/info.png'),
  languages: require('./icons/languages.png'),
  layers: require('./icons/layers.png'),
  lock: require('./icons/lock.png'),
  menu: require('./icons/menu.png'),
  monitor: require('./icons/monitor.png'),
  moon: require('./icons/moon.png'),
  move: require('./icons/move.png'),
  palette: require('./icons/palette.png'),
  pencil: require('./icons/pencil.png'),
  play: require('./icons/play.png'),
  pointer: require('./icons/pointer.png'),
  power: require('./icons/power.png'),
  rotateCcw: require('./icons/rotate-ccw.png'),
  scanText: require('./icons/scan-text.png'),
  scrollText: require('./icons/scroll-text.png'),
  settings: require('./icons/settings.png'),
  share2: require('./icons/share-2.png'),
  shieldCheck: require('./icons/shield-check.png'),
  smartphone: require('./icons/smartphone.png'),
  sparkles: require('./icons/sparkles.png'),
  square: require('./icons/square.png'),
  sun: require('./icons/sun.png'),
  textSelect: require('./icons/text-select.png'),
  trash2: require('./icons/trash-2.png'),
  triangleAlert: require('./icons/triangle-alert.png'),
  type: require('./icons/type.png'),
  volume2: require('./icons/volume-2.png'),
  x: require('./icons/x.png'),
} satisfies Record<string, ImageSourcePropType>;

export type IconName = keyof typeof icons;
