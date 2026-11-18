// React Imports
import { useCallback, useEffect, useMemo, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardHeader from '@mui/material/CardHeader'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'

// Shared Imports
import { IMPORT_SCHEDULE_CHANNELS } from '@shared/constants/channels'
import type { MasterImportRow, MasterResyncResult } from '@shared/types/masterImport'
import { relativeTime } from '@shared/utils/sessionHealth'

// Hook & Service Imports
import { useToast } from '@renderer/hooks/useToast'
import { invoke } from '@renderer/services/ipcClient'
import { registerPageRefresh } from '@renderer/services/refreshRegistry'

/**
 * Master data, one row per credential.
 *
 * One table rather than a card per platform: the question an operator actually
 * has is "which of my accounts is stale?", and that is a comparison across
 * platforms, not within one.
 *
 * Resync runs wherever the company's routing says — this machine when
 * `desktopExecution.<platform>.masterImport` is on and a desktop runner exists,
 * the automation server otherwise. The button is the same either way; the
 * routing is not a choice made here.
 */

export const MasterImportTable = (): React.JSX.Element => {
  const toast = useToast()
  const [rows, setRows] = useState<MasterImportRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [resyncingAll, setResyncingAll] = useState(false)
  const [loading, setLoading] = useState(true)
  // Kept separate from "no rows". A failed read and a company with no
  // master-import platform are different facts, and showing the second when the
  // first happened states something untrue.
  const [error, setError] = useState<string | null>(null)

  const keyOf = (row: MasterImportRow): string => `${row.platform}:${row.credentialId}`

  const load = useCallback(async () => {
    const response = await invoke<MasterImportRow[]>(IMPORT_SCHEDULE_CHANNELS.rows)

    setLoading(false)

    if (response.success) {
      setRows(response.data)
      setError(null)
    } else {
      setError(response.error.message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const response = await invoke<MasterImportRow[]>(IMPORT_SCHEDULE_CHANNELS.rows)

      if (cancelled) return
      setLoading(false)

      if (response.success) {
        setRows(response.data)
        setError(null)
      } else {
        setError(response.error.message)
      }
    })()

    // Sync's page tier reloads this table while the Dashboard is open.
    const unregister = registerPageRefresh(load)

    return () => {
      cancelled = true
      unregister()
    }
  }, [load])

  const run = useCallback(
    async (targets: MasterImportRow[]) => {
      if (targets.length === 0) return

      const keys = targets.map(keyOf)

      setBusy((current) => new Set([...current, ...keys]))

      const response = await invoke<MasterResyncResult[]>(IMPORT_SCHEDULE_CHANNELS.resync, {
        rows: targets.map((row) => ({
          platform: row.platform,
          credentialId: row.credentialId,
          // Carried so a desktop run can fetch this credential's password; the
          // server path ignores it and keys on the id.
          username: row.username
        }))
      })

      setBusy((current) => {
        const next = new Set(current)

        for (const key of keys) next.delete(key)

        return next
      })

      if (!response.success) {
        toast.error(response.error.message)

        return
      }

      const failed = response.data.filter((result) => !result.ok)

      // Named, not counted: "2 failed" tells an operator nothing they can act
      // on, and the reason differs per account.
      for (const failure of failed) {
        toast.error(`${failure.platform}: ${failure.message ?? 'resync failed'}`)
      }

      if (failed.length === 0) {
        toast.success(targets.length === 1 ? 'Resync started' : `Resync started for ${targets.length} accounts`)
      }

      await load()
    },
    [load, toast]
  )

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(keyOf(row))),
    [rows, selected]
  )

  const toggle = (row: MasterImportRow): void =>
    setSelected((current) => {
      const next = new Set(current)
      const key = keyOf(row)

      if (next.has(key)) next.delete(key)
      else next.add(key)

      return next
    })

  const allSelected = rows.length > 0 && selected.size === rows.length

  const resyncAll = useCallback(async () => {
    setResyncingAll(true)
    await run(selectedRows)
    setResyncingAll(false)
    setSelected(new Set())
  }, [run, selectedRows])

  return (
    <Card>
      <CardHeader
        title='Master data'
        subheader='Times are set per platform in Settings.'
        action={
          <Button
            variant='contained'
            size='small'
            // Nothing selected means nothing to do — a "resync all" that
            // silently resynced everything would be a very expensive misread.
            disabled={selectedRows.length === 0 || resyncingAll}
            startIcon={
              resyncingAll ? (
                <CircularProgress size={14} color='inherit' />
              ) : (
                <i className='tabler-refresh' />
              )
            }
            onClick={() => void resyncAll()}
          >
            Master resync{selectedRows.length > 0 ? ` (${selectedRows.length})` : ''}
          </Button>
        }
      />

      {loading ? (
        <CardContent className='flex items-center gap-3'>
          <CircularProgress size={18} />
          <Typography color='text.secondary'>Loading…</Typography>
        </CardContent>
      ) : error ? (
        <CardContent>
          <Alert severity='error' icon={<i className='tabler-alert-circle' />}>
            {error}
          </Alert>
        </CardContent>
      ) : rows.length === 0 ? (
        <CardContent>
          <Typography color='text.disabled'>
            No platform on this company has a master import.
          </Typography>
        </CardContent>
      ) : (
        <TableContainer>
          <Table size='small'>
            <TableHead>
              <TableRow>
                <TableCell padding='checkbox'>
                  <Checkbox
                    inputProps={{ 'aria-label': 'Select every account' }}
                    checked={allSelected}
                    indeterminate={selected.size > 0 && !allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(rows.map(keyOf)))
                    }
                  />
                </TableCell>
                <TableCell>Platform</TableCell>
                <TableCell>Account</TableCell>
                <TableCell>Sync time</TableCell>
                <TableCell>Last sync</TableCell>
                <TableCell align='right' />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(row => {
                const key = keyOf(row)
                const running = busy.has(key)

                return (
                  <TableRow key={key} hover>
                    <TableCell padding='checkbox'>
                      <Checkbox
                        inputProps={{ 'aria-label': `Select ${row.platformLabel} ${row.username}` }}
                        checked={selected.has(key)}
                        onChange={() => toggle(row)}
                      />
                    </TableCell>
                    <TableCell className='font-medium'>{row.platformLabel}</TableCell>
                    <TableCell title={row.username}>
                      <Typography variant='body2' color='text.secondary' className='truncate'>
                        {row.username}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {row.syncTime ?? (
                        <Typography variant='body2' color='text.disabled'>
                          not scheduled
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.lastSyncAt ? (
                        <Typography variant='body2' color='text.secondary'>
                          {relativeTime(new Date(row.lastSyncAt).toISOString())}
                        </Typography>
                      ) : (
                        <Typography variant='body2' color='text.disabled'>
                          never
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align='right'>
                      <Button
                        variant='tonal'
                        size='small'
                        disabled={running}
                        startIcon={running ? <CircularProgress size={14} color='inherit' /> : null}
                        onClick={() => void run([row])}
                      >
                        Resync
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Card>
  )
}
