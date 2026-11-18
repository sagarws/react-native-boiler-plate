import { useCallback, useEffect, useMemo, useState } from 'react'

import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import CustomTextField from '@core/components/mui/TextField'
import type { QueueEntry } from '@shared/vms/queue'
import { Badge, type BadgeTone } from '@renderer/components/ui/Badge'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { Modal } from '@renderer/components/ui/Modal'
import { EmptyState, LoadingState } from '@renderer/components/data/StateBlocks'
import { useToast } from '@renderer/hooks/useToast'

import { vmsClient } from '../services/vmsClient'
import { useVmsSession } from '../VmsSessionContext'
import { exportFailedUploadsPdf } from './exportFailedUploads'

/**
 * Recordings that could not be uploaded: look, retry, delete, export.
 * Ported from Argos Watch's FailedOrdersDialog onto the CMS dialog.
 *
 * Retry moves a row back to pending with fresh counters; the rail's counts
 * follow on their own (`vms:queue-counts-changed`). Delete is permanent — the
 * recording is gone — so it asks first.
 */
const SEARCH_DEBOUNCE_MS = 250

const typeTone = (orderType: string): BadgeTone =>
  orderType === 'Return' ? 'danger' : orderType === 'RTO' ? 'warning' : 'neutral'

export const FailedUploadsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const toast = useToast()
  const { session } = useVmsSession()
  const [rows, setRows] = useState<QueueEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<QueueEntry | null>(null)
  const [exporting, setExporting] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim().toLowerCase()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const fetchRows = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const response = await vmsClient.queueListFailed()
      if (response.success) setRows(response.data)
      else toast.error(response.error.message)
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [toast])

  useEffect(() => {
    if (!open) return
    // The state changes happen after the await inside `fetchRows`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRows()
  }, [open, fetchRows])

  const filtered = useMemo(
    () =>
      query
        ? rows.filter(
            (row) => row.trackingId.toLowerCase().includes(query) || row.orderType.toLowerCase().includes(query)
          )
        : rows,
    [rows, query]
  )

  const retry = async (row: QueueEntry): Promise<void> => {
    if (retrying) return
    setRetrying(row.uuid)
    try {
      const response = await vmsClient.queueRetry(row.uuid)
      if (!response.success) {
        toast.error(response.error.message)
        return
      }
      toast.success(`${row.trackingId} moved back to pending`)
      await fetchRows()
    } finally {
      setRetrying(null)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete || deleting) return
    const target = pendingDelete
    setDeleting(target.uuid)
    try {
      const response = await vmsClient.queueDeleteFailed(target.uuid)
      if (!response.success) {
        toast.error(response.error.message)
        return
      }
      toast.success(`Deleted ${target.trackingId}`)
      setPendingDelete(null)
      await fetchRows()
    } finally {
      setDeleting(null)
    }
  }

  const exportPdf = async (): Promise<void> => {
    setExporting(true)
    try {
      await exportFailedUploadsPdf(rows, {
        feedName: session.user?.feed?.feedName,
        operatorName: session.user?.displayName
      })
      toast.success('Failed uploads exported as PDF')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The PDF could not be made.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        title='Failed uploads'
        description={`${rows.length} recording${rows.length === 1 ? '' : 's'} could not be uploaded.`}
        onClose={onClose}
        size='lg'
        toolbar={
          <div className='flex items-center gap-2'>
            <CustomTextField
              size='small'
              fullWidth
              placeholder='Search by AWB or order type'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <i className='tabler-search text-lg' />
                    </InputAdornment>
                  )
                }
              }}
            />
            <Tooltip title='Refresh the list'>
              <span>
                <IconButton aria-label='Refresh the list' disabled={loading} onClick={() => void fetchRows()}>
                  {loading ? <CircularProgress size={18} /> : <i className='tabler-refresh text-xl' />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title='Export the list as PDF'>
              <span>
                <IconButton
                  aria-label='Export the list as PDF'
                  disabled={rows.length === 0 || exporting}
                  onClick={() => void exportPdf()}
                >
                  {exporting ? <CircularProgress size={18} /> : <i className='tabler-file-download text-xl' />}
                </IconButton>
              </span>
            </Tooltip>
          </div>
        }
      >
        {!loaded ? (
          <LoadingState label='Reading the upload queue…' />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<i className='tabler-cloud-check' />}
            title={rows.length === 0 ? 'Nothing failed' : 'No matches'}
            message={
              rows.length === 0
                ? 'Every recording so far has uploaded, or is still on its way.'
                : 'No failed upload matches that search.'
            }
          />
        ) : (
          <TableContainer>
            <Table size='small'>
              <TableHead>
                <TableRow>
                  <TableCell>AWB / Tracking ID</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align='right'>Attempts</TableCell>
                  <TableCell>Error</TableCell>
                  <TableCell align='right'>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((row) => {
                  const busy = retrying === row.uuid || deleting === row.uuid
                  return (
                    <TableRow key={row.uuid} hover>
                      <TableCell className='font-mono text-xs'>{row.trackingId}</TableCell>
                      <TableCell>
                        <Badge tone={typeTone(row.orderType)}>{row.orderType || '—'}</Badge>
                      </TableCell>
                      <TableCell align='right' className='tabular-nums'>
                        {row.retryCount}
                      </TableCell>
                      <TableCell sx={{ maxInlineSize: 280 }}>
                        <Tooltip title={row.errorMessage || ''}>
                          <Typography variant='caption' noWrap component='div' color='text.secondary'>
                            {row.errorMessage || '—'}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell align='right' className='whitespace-nowrap'>
                        <Tooltip title='Move back to pending'>
                          <span>
                            <IconButton
                              size='small'
                              color='primary'
                              aria-label={`Retry ${row.trackingId}`}
                              disabled={busy}
                              onClick={() => void retry(row)}
                            >
                              {retrying === row.uuid ? (
                                <CircularProgress size={16} />
                              ) : (
                                <i className='tabler-refresh text-lg' />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title='Delete the recording'>
                          <span>
                            <IconButton
                              size='small'
                              color='error'
                              aria-label={`Delete ${row.trackingId}`}
                              disabled={busy}
                              onClick={() => setPendingDelete(row)}
                            >
                              {deleting === row.uuid ? (
                                <CircularProgress size={16} />
                              ) : (
                                <i className='tabler-trash text-lg' />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title='Delete this failed upload?'
        message={`This permanently removes the recording queued for ${pendingDelete?.trackingId ?? ''}. It will not be uploaded and cannot be recovered.`}
        confirmLabel='Delete'
        destructive
        busy={deleting !== null}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
