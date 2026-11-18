// React Imports
import { useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import LinearProgress from '@mui/material/LinearProgress'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'

// Core Component Imports
import CustomAvatar from '@core/components/mui/Avatar'
import CustomChip from '@core/components/mui/Chip'
import CustomIconButton from '@core/components/mui/IconButton'
import CustomTextField from '@core/components/mui/TextField'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

// Type Imports
import type { Mode } from '@core/types'

import './preview.css'

/**
 * P1 ONLY. Proves the ported design system renders, and is deleted at P2.
 *
 * This is not a screen anybody navigates to — it is reached by putting
 * `#ui-preview` on the renderer's URL, so it cannot appear by accident and the
 * app it sits beside is untouched. What it has to show is narrow: that
 * Monitor's theme object, its Tailwind bridge, its fonts and its icons all
 * resolve inside Vite and Electron, in light and dark, with no network.
 *
 * Everything here is a MUI component with no props of ours, on purpose. If a
 * button here does not look like Monitor's button, the theme is wrong — not
 * this file.
 */
const SWATCHES = ['primary', 'secondary', 'success', 'error', 'warning', 'info'] as const

const ROWS = [
  { platform: 'Ajio', account: 'dv@mozafia.com', claims: 52, status: 'Saved' },
  { platform: 'Myntra', account: 'listing@mozafia.com', claims: 357, status: 'Rejected' },
  { platform: 'Nykaa', account: 'mozafia.london@gmail.com', claims: 32, status: 'Saved' }
]

export const UiPreview = () => {
  const { settings, updateSettings } = useSettings()
  const [checked, setChecked] = useState(true)

  const setMode = (mode: Mode): void => updateSettings({ mode }, { persist: false })

  return (
    <Box className='p-6' sx={{ minBlockSize: '100vh', backgroundColor: 'background.default' }}>
      <div className='flex items-center justify-between gap-4 mbe-6'>
        <div>
          <Typography variant='h4'>Ported design system</Typography>
          <Typography color='text.secondary'>
            Monitor&rsquo;s theme, fonts and icons, rendering inside the desktop app.
          </Typography>
        </div>
        <div className='flex items-center gap-2'>
          <Chip label={`mode: ${settings.mode}`} size='small' variant='tonal' color='primary' />
          {(['light', 'dark', 'system'] as const).map(mode => (
            <Button
              key={mode}
              size='small'
              variant={settings.mode === mode ? 'contained' : 'tonal'}
              onClick={() => setMode(mode)}
              startIcon={<i className={mode === 'dark' ? 'tabler-moon' : 'tabler-sun'} />}
            >
              {mode}
            </Button>
          ))}
        </div>
      </div>

      <Grid container spacing={6}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardHeader title='Buttons' subheader='Contained, tonal, outlined, text' />
            <CardContent className='flex flex-col gap-4'>
              {(['contained', 'tonal', 'outlined', 'text'] as const).map(variant => (
                <div key={variant} className='flex flex-wrap items-center gap-2'>
                  {SWATCHES.map(color => (
                    <Button key={color} variant={variant} color={color} size='small'>
                      {color}
                    </Button>
                  ))}
                </div>
              ))}
              <Divider />
              <div className='flex items-center gap-2'>
                <CustomIconButton variant='contained' color='primary' size='small'>
                  <i className='tabler-refresh' />
                </CustomIconButton>
                <CustomIconButton variant='tonal' color='success' size='small'>
                  <i className='tabler-check' />
                </CustomIconButton>
                <CustomIconButton variant='outlined' color='error' size='small'>
                  <i className='tabler-trash' />
                </CustomIconButton>
                <CustomAvatar color='primary' skin='light' size={34}>
                  HJ
                </CustomAvatar>
                <Switch checked={checked} onChange={event => setChecked(event.target.checked)} />
              </div>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardHeader title='Status and input' subheader='Chips, alerts, fields, progress' />
            <CardContent className='flex flex-col gap-4'>
              <div className='flex flex-wrap gap-2'>
                {SWATCHES.map(color => (
                  <CustomChip key={color} round='true' label={color} size='small' color={color} variant='tonal' />
                ))}
              </div>
              <Alert severity='warning' icon={<i className='tabler-alert-circle' />}>
                <AlertTitle>4 logins need updating</AlertTitle>
                Automations that sign in will fail until they are.
              </Alert>
              <CustomTextField label='Search' placeholder='AWB, ticket or order…' fullWidth />
              <LinearProgress value={62} variant='determinate' />
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Card>
            <CardHeader title='Table' subheader='The density the claim queue will use' />
            <Table size='small'>
              <TableHead>
                <TableRow>
                  <TableCell>Platform</TableCell>
                  <TableCell>Account</TableCell>
                  <TableCell align='right'>Claims</TableCell>
                  <TableCell>Login</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ROWS.map(row => (
                  <TableRow key={row.account}>
                    <TableCell>{row.platform}</TableCell>
                    <TableCell className='font-mono'>{row.account}</TableCell>
                    <TableCell align='right'>{row.claims}</TableCell>
                    <TableCell>
                      <CustomChip
                        round='true'
                        size='small'
                        variant='tonal'
                        label={row.status}
                        color={row.status === 'Saved' ? 'success' : 'error'}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
