// Type Imports
import type { ThemeColor } from '@core/types'
import type { CustomAvatarProps } from '@core/components/mui/Avatar'

/**
 * PORTED FROM TrackVid-Monitor (src/types/pages/widgetTypes.ts), trimmed.
 *
 * Monitor's file describes every card-statistics variant it ships, and several
 * of those carry an ApexCharts series in their props. Copying it whole would
 * have made a charting library a dependency of a type file. What is here is the
 * variants this app renders.
 */

export type CardStatsHorizontalWithAvatarProps = {
  stats: string
  title: string
  avatarIcon: string
  avatarColor?: ThemeColor
  avatarVariant?: CustomAvatarProps['variant']
  avatarSkin?: CustomAvatarProps['skin']
  avatarSize?: number
}
