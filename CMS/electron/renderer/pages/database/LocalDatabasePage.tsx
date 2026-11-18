// React Imports
import { useEffect, useMemo, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Typography from '@mui/material/Typography'

// Shared Imports
import type { LocalTable, LocalTablePage, LocalTableQuery, LocalTableRow } from '@shared/types/localDatabase'

// Component Imports
import CustomTextField from '@core/components/mui/TextField'
import { EmptyState, LoadingState } from '@renderer/components/data/StateBlocks'
import { Button } from '@renderer/components/ui/Button'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { Modal } from '@renderer/components/ui/Modal'
import { Switch } from '@renderer/components/ui/Switch'
import { Tooltip } from '@renderer/components/ui/Tooltip'

// Hook & Service Imports
import { useToast } from '@renderer/hooks/useToast'
import {
  deleteLocalRow,
  insertLocalRow,
  listLocalTables,
  readLocalTable,
  updateLocalRow
} from '@renderer/services/localDatabase.service'

// Style Imports
import tableStyles from '@core/styles/table.module.css'

/**
 * Local Database — every collection this machine keeps, as a table.
 *
 * Read-only until Edit mode is switched on, because these files ARE the app's
 * state: the claim queue, the schedule, saved sessions. An edit is checked
 * against the row as it was read, so a row that the app changed in the
 * meantime is refused rather than overwritten.
 */

const PAGE_SIZE = 50
const SEARCH_DELAY_MS = 300

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const sizeText = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

type Editor = { mode: 'edit'; row: LocalTableRow } | { mode: 'add' }

export const LocalDatabasePage = () => {
  const toast = useToast()

  const [tablesTick, setTablesTick] = useState(0)
  const [tables, setTables] = useState<{ tick: number; list: LocalTable[]; error?: string } | null>(null)

  const [picked, setPicked] = useState<string | null>(null)
  /**
   * Narrows the sidebar, not the rows.
   *
   * Separate from `searchText` below, and deliberately so: there are forty-odd
   * tables and fifteen of them are called `ajio-backup-…`, so finding one by
   * eye is the slow part. Typing "snapdeal" here has nothing to do with
   * searching inside a table, and sharing one box between the two would make
   * picking a table silently filter its contents.
   */
  const [tableFilter, setTableFilter] = useState('')
  const [page, setPage] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [rowsTick, setRowsTick] = useState(0)
  const [result, setResult] = useState<{ key: string; data?: LocalTablePage; error?: string } | null>(null)

  const [editMode, setEditMode] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<LocalTableRow | null>(null)

  useEffect(() => {
    let cancelled = false

    void listLocalTables().then(response => {
      if (cancelled) return
      setTables(
        response.success
          ? { tick: tablesTick, list: response.data }
          : { tick: tablesTick, list: [], error: response.error.message }
      )
    })

    return () => {
      cancelled = true
    }
  }, [tablesTick])

  const table = picked ?? tables?.list.find(item => item.rows !== null)?.name ?? null
  const tableInfo = tables?.list.find(item => item.name === table) ?? null

  /**
   * The sidebar's list.
   *
   * THE PICKED TABLE IS ALWAYS IN IT, whatever the filter says. Filtering it
   * out while its rows are still on screen leaves the list with nothing
   * highlighted and no way back to the row you are looking at except clearing
   * the box — the list and the table would be describing different things.
   */
  const visibleTables = useMemo(() => {
    const wanted = tableFilter.trim().toLowerCase()
    const all = tables?.list ?? []

    if (!wanted) return all

    return all.filter(item => item.name.toLowerCase().includes(wanted) || item.name === table)
  }, [tables, tableFilter, table])

  const query = useMemo<LocalTableQuery | null>(
    () => (table ? { table, page, pageSize: PAGE_SIZE, search } : null),
    [table, page, search]
  )
  const key = `${JSON.stringify(query)}#${rowsTick}`

  useEffect(() => {
    if (!query) return
    let cancelled = false

    void readLocalTable(query).then(response => {
      if (cancelled) return
      setResult(response.success ? { key, data: response.data } : { key, error: response.error.message })
    })

    return () => {
      cancelled = true
    }
  }, [query, key])

  // The search applies once typing pauses, not on every keystroke.
  useEffect(() => {
    const next = searchText.trim()
    if (next === search) return

    const timer = setTimeout(() => {
      setSearch(next)
      setPage(0)
    }, SEARCH_DELAY_MS)

    return () => clearTimeout(timer)
  }, [searchText, search])

  const loading = query !== null && result?.key !== key
  // The previous page stays on screen while the next one loads.
  const data = result?.data?.table === table ? result.data : undefined
  const error = result?.key === key ? result.error : undefined
  const columns = data ? (data.columns.length > 0 ? data.columns : ['value']) : []
  const primitiveRows = data ? data.columns.length === 0 : false

  const reload = () => {
    setRowsTick(n => n + 1)
    setTablesTick(n => n + 1)
  }

  const pickTable = (name: string) => {
    setPicked(name)
    setPage(0)
    setSearchText('')
    setSearch('')
  }

  const openEditor = (next: Editor) => {
    setEditor(next)
    setDraftError(null)
    setDraft(
      next.mode === 'edit'
        ? JSON.stringify(next.row.record, null, 2)
        : JSON.stringify(Object.fromEntries((data?.columns ?? []).map(column => [column, null])), null, 2)
    )
  }

  const saveEditor = async () => {
    if (!editor || !table) return

    let record: unknown
    try {
      record = JSON.parse(draft)
    } catch {
      setDraftError('This is not valid JSON.')
      return
    }

    setSaving(true)
    const response =
      editor.mode === 'edit'
        ? await updateLocalRow({ table, index: editor.row.index, expected: editor.row.record, record })
        : await insertLocalRow({ table, record })
    setSaving(false)

    if (!response.success) {
      setDraftError(response.error.message)
      return
    }

    toast.success(editor.mode === 'edit' ? `Row ${editor.row.index + 1} saved` : 'Row added')
    setEditor(null)
    reload()
  }

  const confirmDelete = async () => {
    if (!deleting || !table) return

    setSaving(true)
    const response = await deleteLocalRow({ table, index: deleting.index, expected: deleting.record })
    setSaving(false)
    setDeleting(null)

    if (!response.success) {
      toast.error(response.error.message)
      return
    }

    toast.success(`Row ${deleting.index + 1} deleted`)
    reload()
  }

  const lastPage = data ? Math.max(Math.ceil(data.matched / data.pageSize) - 1, 0) : 0
  const shownPage = data?.page ?? 0
  const editable = tableInfo?.rows !== null && tableInfo !== null

  return (
    <div className='ts-layout-content-height-fixed trackvid-table-fill flex flex-col gap-4'>
      <Modal
        open={editor !== null}
        size='lg'
        busy={saving}
        title={editor?.mode === 'edit' ? `Edit row ${editor.row.index + 1}` : 'Add row'}
        description={table ? `${table} · saved as JSON` : undefined}
        onClose={() => setEditor(null)}
        footer={
          <>
            <Button variant='secondary' disabled={saving} onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void saveEditor()}>
              Save
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-3'>
          {draftError && <Alert severity='error'>{draftError}</Alert>}
          <CustomTextField
            fullWidth
            multiline
            minRows={14}
            maxRows={28}
            value={draft}
            onChange={event => {
              setDraft(event.target.value)
              setDraftError(null)
            }}
            slotProps={{ htmlInput: { spellCheck: false, className: 'font-mono text-xs' } }}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        destructive
        busy={saving}
        title={deleting ? `Delete row ${deleting.index + 1}?` : 'Delete row?'}
        message={`The row is removed from ${table ?? 'this table'} on this machine. This cannot be undone.`}
        confirmLabel='Delete'
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />

      {/* THE TABLES ARE A SIDEBAR, NOT A DROPDOWN.
          Forty-odd collections, fifteen of them named `ajio-backup-…`, is a
          list you read rather than one you pick blind from — and a dropdown
          hides the row counts and sizes the moment it closes, which are the
          numbers that say which table is worth opening. On screen beside the
          rows, the whole shape of what this machine is holding is visible at
          once, and switching table is one click instead of three. */}
      <div className='trackvid-table-scroll-host flex flex-col gap-4 md:flex-row'>
        {/* `md:shrink-0` rather than `shrink-0`: side by side it must keep its
            width, but stacked — the row turns into a column below md — it has
            to be allowed to shrink, or forty table names push the rows off the
            bottom of the screen instead of scrolling inside the card. */}
        <Card className='flex flex-col md:is-80 md:shrink-0'>
          <div className='flex flex-col gap-3 p-3'>
            <div className='flex items-center justify-between gap-2'>
              <Typography variant='subtitle2'>Tables</Typography>
              <Typography variant='caption' color='text.secondary'>
                {tables ? `${tables.list.length}` : '—'}
              </Typography>
            </div>

            <CustomTextField
              size='small'
              placeholder='Filter tables'
              aria-label='Filter tables'
              value={tableFilter}
              disabled={!tables || tables.list.length === 0}
              onChange={event => setTableFilter(event.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <i className='tabler-search' />
                    </InputAdornment>
                  )
                }
              }}
            />
          </div>

          <Divider />

          {/* Its own scroll, so a long list never pushes the rows off screen. */}
          <div className='min-bs-0 flex-1 overflow-y-auto p-2'>
            {visibleTables.map(item => {
              const active = item.name === table

              return (
                <button
                  key={item.name}
                  type='button'
                  aria-current={active ? 'true' : undefined}
                  onClick={() => pickTable(item.name)}
                  className={`flex is-full flex-col items-start gap-0.5 rounded px-2 plb-2 text-left ${
                    active ? 'bg-actionSelected' : 'hover:bg-actionHover'
                  }`}
                >
                  <span
                    className={`is-full truncate text-sm text-textPrimary ${active ? 'font-medium' : ''}`}
                    title={item.name}
                  >
                    {item.name}
                  </span>
                  {/* The two numbers the dropdown used to hide once it closed:
                      an empty table and a 30 MB one are the two things worth
                      knowing before opening either. */}
                  <Typography variant='caption' color='text.secondary'>
                    {item.rows === null ? 'not a list' : `${item.rows} rows`} · {sizeText(item.bytes)}
                  </Typography>
                </button>
              )
            })}

            {tables !== null && tables.list.length > 0 && visibleTables.length === 0 && (
              <Typography variant='caption' color='text.secondary' className='block p-2'>
                No table matches that.
              </Typography>
            )}
          </div>
        </Card>

        <div className='trackvid-table-scroll-host flex min-is-0 flex-col gap-4'>
          <Card className='flex shrink-0 flex-col gap-3 p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              {/* The heading is the picked table now. The sidebar says what is
                  selected, but the rows need a title of their own — this card
                  is what somebody reads before editing anything in it. */}
              <div className='min-is-0'>
                <Typography variant='subtitle2' className='truncate' title={table ?? undefined}>
                  {table ?? 'No table selected'}
                </Typography>
                <Typography variant='caption' color='text.secondary'>
                  Kept under this machine's data folder. Some changes take effect after a restart.
                </Typography>
              </div>
              <div className='flex items-center gap-2'>
                <Switch compact checked={editMode} onChange={setEditMode} label='Edit mode' />
                <Button
                  size='sm'
                  variant='secondary'
                  icon={<i className='tabler-refresh' />}
                  loading={loading || (tables !== null && tables.tick !== tablesTick)}
                  onClick={reload}
                >
                  Refresh
                </Button>
              </div>
            </div>

            <Divider />

            <div className='flex flex-wrap items-center gap-2'>
              <CustomTextField
                size='small'
                label='Search rows'
                className='min-is-60'
                value={searchText}
                disabled={!editable}
                onChange={event => setSearchText(event.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position='start'>
                        <i className='tabler-search' />
                      </InputAdornment>
                    )
                  }
                }}
              />

              {editMode && editable && (
                <Button size='sm' icon={<i className='tabler-plus' />} onClick={() => openEditor({ mode: 'add' })}>
                  Add row
                </Button>
              )}

              {data && (
                <div className='mis-auto flex items-center gap-1'>
                  <Typography variant='body2' color='text.secondary'>
                    {data.matched === 0
                      ? '0 rows'
                      : `${shownPage * data.pageSize + 1}–${Math.min((shownPage + 1) * data.pageSize, data.matched)} of ${data.matched}`}
                    {data.matched !== data.total && ` (filtered from ${data.total})`}
                  </Typography>
                  <IconButton
                    size='small'
                    aria-label='Previous page'
                    disabled={shownPage === 0}
                    onClick={() => setPage(Math.max(shownPage - 1, 0))}
                  >
                    <i className='tabler-chevron-left' />
                  </IconButton>
                  <IconButton
                    size='small'
                    aria-label='Next page'
                    disabled={shownPage >= lastPage}
                    onClick={() => setPage(Math.min(shownPage + 1, lastPage))}
                  >
                    <i className='tabler-chevron-right' />
                  </IconButton>
                </div>
              )}
            </div>

            {tables?.error && <Alert severity='error'>{tables.error}</Alert>}
            {tableInfo && tableInfo.rows === null && (
              <Alert severity='warning'>
                {tableInfo.name} is not a list of records, so it cannot be shown as a table.
              </Alert>
            )}
            {error && <Alert severity='error'>{error}</Alert>}
          </Card>

          <Card className='trackvid-table-scroll'>
                {data && data.rows.length > 0 && (
              <div>
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      <th className='w-14'>#</th>
                      {columns.map(column => (
                        <th key={column}>{column}</th>
                      ))}
                      {editMode && <th className='w-24'>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(row => {
                      const record = row.record as Record<string, unknown>

                      return (
                        <tr
                          key={row.index}
                          className={editMode ? 'cursor-pointer hover:bg-actionHover' : undefined}
                          onDoubleClick={editMode ? () => openEditor({ mode: 'edit', row }) : undefined}
                        >
                          <td>
                            <Typography variant='body2' color='text.secondary'>
                              {row.index + 1}
                            </Typography>
                          </td>
                          {columns.map(column => {
                            const text = cellText(primitiveRows ? row.record : record[column])

                            return (
                              <td key={column}>
                                <span className='block max-is-80 truncate' title={text}>
                                  {text}
                                </span>
                              </td>
                            )
                          })}
                          {editMode && (
                            <td>
                              <div className='flex items-center gap-1'>
                                <Tooltip label='Edit row'>
                                  <IconButton size='small' onClick={() => openEditor({ mode: 'edit', row })}>
                                    <i className='tabler-edit' />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip label='Delete row'>
                                  <IconButton size='small' color='error' onClick={() => setDeleting(row)}>
                                    <i className='tabler-trash' />
                                  </IconButton>
                                </Tooltip>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {tables !== null && tables.list.length === 0 && !tables.error && (
              <EmptyState
                icon={<i className='tabler-database text-3xl' />}
                title='No local tables yet'
                message='Tables appear here once the app has saved something on this machine.'
              />
            )}

            {data && data.rows.length === 0 && (
              <EmptyState
                icon={<i className='tabler-database text-3xl' />}
                title={data.total === 0 ? 'This table is empty' : 'No row matches'}
                message={
                  data.total === 0
                    ? editMode
                      ? 'Use Add row to put a record in it.'
                      : 'Nothing has been saved in it yet.'
                    : 'No record contains that text. Clear the search to see every row.'
                }
              />
            )}

            {(tables === null || (loading && !data)) && <LoadingState label='Reading local tables…' />}
          </Card>
        </div>
      </div>
    </div>
  )
}
