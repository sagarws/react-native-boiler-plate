// React Imports
import { useState } from 'react'

// MUI Imports
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import Divider from '@mui/material/Divider'
import Fade from '@mui/material/Fade'
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

// Third-party Imports
import classnames from 'classnames'
import { HexColorInput, HexColorPicker } from 'react-colorful'

// Shared Imports
import type { ThemeFont } from '@shared/types/appearance'
import { DEFAULT_THEME_SETTINGS } from '@shared/types/appearance'

// Component Imports
import { Button } from '@renderer/components/ui/Button'
import SkinDefault from '@core/svg/SkinDefault'
import SkinBordered from '@core/svg/SkinBordered'
import ContentCompact from '@core/svg/ContentCompact'
import ContentWide from '@core/svg/ContentWide'

// Config Imports
import primaryColorConfig from '@configs/primaryColorConfig'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

// Style Imports
import styles from '@core/components/customizer/styles.module.css'

/**
 * The theme customizer, ported from TrackVid-Monitor.
 *
 * REPLACES the old Theme and Colours panels. Those edited thirteen seeds of a
 * palette this app no longer renders from: the colours now come from Monitor's
 * theme object, so the thing worth exposing is the handful of decisions that
 * theme actually takes — the primary colour, the mode, the skin, how wide the
 * content runs — which is exactly what Monitor's own customizer offers.
 *
 * WHAT IS OURS. Monitor renders this as a drawer that slides in from the right
 * of every page. Here it is a card on the Settings screen, because that is
 * where an operator already goes to change how this machine behaves, and a
 * floating tab over six dense tables is one more thing to catch a stray click.
 * The markup and the styles inside each section are Monitor's.
 *
 * WHAT IS ADDED. A typeface, which Monitor has no equivalent for: a web app can
 * fetch any font and a packaged desktop app can only offer what shipped beside
 * it. Three, plus the machine's own — Geist leads because it is what the app
 * now ships in.
 *
 * WHAT IS DROPPED, with the reasons: RTL (one language, and it costs a runtime
 * stylis plugin), semi-dark (a web-template nav tint), and Layouts (this app
 * ships one shell — the rail's collapse is on the rail itself).
 */

const FONTS: readonly { id: ThemeFont; label: string; hint: string }[] = [
  { id: 'geist', label: 'Geist', hint: 'What the app ships in' },
  { id: 'public-sans', label: 'Public Sans', hint: 'What TrackVid Monitor uses' },
  { id: 'inter', label: 'Inter', hint: 'Slightly narrower, tighter numbers' },
  { id: 'system', label: 'System', hint: 'Whatever this machine uses' }
]

export const ThemeCustomizerCard = () => {
  const { settings, updateSettings, isSettingsChanged, resetSettings } = useSettings()
  const [pickerOpen, setPickerOpen] = useState(false)
  /*
   * The swatch the picker hangs off, held in STATE rather than in a ref.
   *
   * Monitor reads `anchorRef.current` while rendering, which React now warns
   * about — a ref's contents are not a render input, and the first render reads
   * null. A callback ref into state gives the popper a real element and
   * re-renders once when it arrives.
   */
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)

  const isPreset = primaryColorConfig.some(entry => entry.main === settings.primaryColor)

  return (
    <Card>
      <CardHeader
        title='Theme'
        subheader='Applies straight away and is remembered on this computer, including after an update.'
        action={
          <Button
            variant='ghost'
            size='sm'
            icon={<i className='tabler-refresh' />}
            // Nothing to undo is a button that should say so rather than one
            // that looks pressable and does nothing.
            disabled={!isSettingsChanged}
            onClick={() => resetSettings()}
          >
            Reset
          </Button>
        }
      />
      <CardContent className='flex flex-col gap-6'>
        {/* ---------------------------------------------------------------
         * Primary colour
         * ------------------------------------------------------------- */}
        <div className='flex flex-col gap-2'>
          <Typography className='font-medium'>Primary Color</Typography>
          <div className='flex items-center gap-3'>
            {primaryColorConfig.map(entry => (
              <div
                key={entry.main}
                role='button'
                tabIndex={0}
                aria-label={entry.name}
                aria-pressed={settings.primaryColor === entry.main}
                className={classnames(styles.primaryColorWrapper, {
                  [styles.active as string]: settings.primaryColor === entry.main
                })}
                onClick={() => updateSettings({ primaryColor: entry.main })}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    updateSettings({ primaryColor: entry.main })
                  }
                }}
              >
                <div className={styles.primaryColor} style={{ backgroundColor: entry.main }} />
              </div>
            ))}

            {/* Anything else the operator wants. Monitor's own popper. */}
            <div
              ref={setAnchor}
              role='button'
              tabIndex={0}
              aria-label='Pick a custom primary colour'
              aria-expanded={pickerOpen}
              className={classnames(styles.primaryColorWrapper, {
                [styles.active as string]: !isPreset
              })}
              onClick={() => setPickerOpen(open => !open)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setPickerOpen(open => !open)
                }
              }}
            >
              <div
                className={classnames(styles.primaryColor, 'flex items-center justify-center')}
                style={{
                  backgroundColor: isPreset
                    ? 'var(--mui-palette-action-selected)'
                    : settings.primaryColor,
                  color: isPreset
                    ? 'var(--mui-palette-text-textPrimary)'
                    : 'var(--mui-palette-primary-contrastText)'
                }}
              >
                <i className='tabler-color-picker text-xl' />
              </div>
            </div>

            <Popper
              transition
              open={pickerOpen}
              disablePortal
              anchorEl={anchor}
              placement='bottom-start'
              className='z-[var(--z-dropdown)]'
            >
              {({ TransitionProps }) => (
                <Fade {...TransitionProps} style={{ transformOrigin: 'left top' }}>
                  <Paper elevation={6} className={styles.colorPopup}>
                    <ClickAwayListener onClickAway={() => setPickerOpen(false)}>
                      <div className='flex flex-col gap-4'>
                        <HexColorPicker
                          color={settings.primaryColor ?? DEFAULT_THEME_SETTINGS.primaryColor}
                          onChange={color => updateSettings({ primaryColor: color })}
                        />
                        <HexColorInput
                          className={styles.colorInput}
                          color={settings.primaryColor ?? DEFAULT_THEME_SETTINGS.primaryColor}
                          onChange={color => updateSettings({ primaryColor: color })}
                          prefixed
                        />
                      </div>
                    </ClickAwayListener>
                  </Paper>
                </Fade>
              )}
            </Popper>
          </div>
        </div>

        <Divider />

        {/* ---------------------------------------------------------------
         * Mode — Light, Dark, System
         * ------------------------------------------------------------- */}
        <div className='flex flex-col gap-2'>
          <Typography className='font-medium'>Mode</Typography>
          <div className='flex items-start gap-6'>
            {(
              [
                { id: 'light', label: 'Light', icon: 'tabler-sun' },
                { id: 'dark', label: 'Dark', icon: 'tabler-moon-stars' },
                { id: 'system', label: 'System', icon: 'tabler-device-laptop' }
              ] as const
            ).map(mode => (
              <div key={mode.id} className='flex flex-col items-start gap-0.5'>
                <div
                  role='button'
                  tabIndex={0}
                  aria-pressed={settings.mode === mode.id}
                  aria-label={mode.label}
                  className={classnames(styles.itemWrapper, styles.modeWrapper, {
                    [styles.active as string]: settings.mode === mode.id
                  })}
                  onClick={() => updateSettings({ mode: mode.id })}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      updateSettings({ mode: mode.id })
                    }
                  }}
                >
                  {/* Sized through `sx`: an arbitrary Tailwind value here
                      would have to weaken the token check that still guards
                      the screens waiting to be migrated. */}
                  <Box component='i' className={mode.icon} sx={{ fontSize: 30 }} />
                </div>
                <Typography
                  className={styles.itemLabel}
                  onClick={() => updateSettings({ mode: mode.id })}
                >
                  {mode.label}
                </Typography>
              </div>
            ))}
          </div>
        </div>

        <Divider />

        {/* ---------------------------------------------------------------
         * Skin
         * ------------------------------------------------------------- */}
        <div className='flex flex-col gap-2'>
          <Typography className='font-medium'>Skin</Typography>
          <div className='flex items-start gap-6'>
            {(
              [
                { id: 'default', label: 'Default', Icon: SkinDefault },
                { id: 'bordered', label: 'Bordered', Icon: SkinBordered }
              ] as const
            ).map(skin => (
              <div key={skin.id} className='flex flex-col items-start gap-0.5'>
                <div
                  role='button'
                  tabIndex={0}
                  aria-pressed={settings.skin === skin.id}
                  aria-label={skin.label}
                  className={classnames(styles.itemWrapper, {
                    [styles.active as string]: settings.skin === skin.id
                  })}
                  onClick={() => updateSettings({ skin: skin.id })}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      updateSettings({ skin: skin.id })
                    }
                  }}
                >
                  <skin.Icon />
                </div>
                <Typography
                  className={styles.itemLabel}
                  onClick={() => updateSettings({ skin: skin.id })}
                >
                  {skin.label}
                </Typography>
              </div>
            ))}
          </div>
        </div>

        <Divider />

        {/* ---------------------------------------------------------------
         * Typeface — ours, not Monitor's
         * ------------------------------------------------------------- */}
        <div className='flex flex-col gap-2'>
          <Typography className='font-medium'>Typeface</Typography>
          <Typography variant='body2' color='text.secondary'>
            Every one of these ships with the app — nothing is downloaded, so the screen looks the
            same on a machine with no network.
          </Typography>
          <div className='flex flex-wrap items-start gap-3 mbs-1'>
            {FONTS.map(font => (
              <div
                key={font.id}
                role='button'
                tabIndex={0}
                aria-pressed={(settings.font ?? 'geist') === font.id}
                className={classnames(styles.itemWrapper, 'bs-auto plb-3 pli-4', {
                  [styles.active as string]: (settings.font ?? 'geist') === font.id
                })}
                style={{ inlineSize: 180 }}
                onClick={() => updateSettings({ font: font.id })}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    updateSettings({ font: font.id })
                  }
                }}
              >
                <div className='flex flex-col items-start gap-0.5 is-full'>
                  <Typography className='font-medium'>{font.label}</Typography>
                  <Typography variant='body2' color='text.secondary'>
                    {font.hint}
                  </Typography>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Divider />

        {/* ---------------------------------------------------------------
         * Content width
         * ------------------------------------------------------------- */}
        <div className='flex flex-col gap-2'>
          <Typography className='font-medium'>Content width</Typography>
          <div className='flex items-start gap-6'>
            {(
              [
                { id: 'compact', label: 'Compact', Icon: ContentCompact },
                { id: 'wide', label: 'Wide', Icon: ContentWide }
              ] as const
            ).map(width => (
              <div key={width.id} className='flex flex-col items-start gap-0.5'>
                <div
                  role='button'
                  tabIndex={0}
                  aria-pressed={settings.contentWidth === width.id}
                  aria-label={width.label}
                  className={classnames(styles.itemWrapper, {
                    [styles.active as string]: settings.contentWidth === width.id
                  })}
                  onClick={() => updateSettings({ contentWidth: width.id })}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      updateSettings({ contentWidth: width.id })
                    }
                  }}
                >
                  <width.Icon />
                </div>
                <Typography
                  className={styles.itemLabel}
                  onClick={() => updateSettings({ contentWidth: width.id })}
                >
                  {width.label}
                </Typography>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
