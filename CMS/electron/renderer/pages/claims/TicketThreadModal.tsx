import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { useToast } from '@renderer/hooks/useToast'
import { openTicketThread, replyToTicketThread } from '@renderer/services/ticketThread.service'
import {
  TICKET_REPLY_MAX_CHARS,
  ticketReplyFileExtension,
  ticketReplyRules,
  type TicketReplyRules,
  type TicketThread,
  type TicketThreadTarget
} from '@shared/types/ticketThread'

/**
 * A filed claim's ticket, laid out as the marketplace's own ticket window is —
 * "Ticket <id> (Status: …)" over three sections: Details, Attach File and
 * Comments, with the comment box and Send at the bottom.
 *
 * A reply is a comment, files, or both: Send is enabled by either. Everything
 * shown came from the marketplace, so it is rendered as TEXT, and only https
 * links are made clickable (they open in the system browser).
 */

interface Props {
  /** The claim's ticket to show; null closes the dialog. */
  target: TicketThreadTarget | null
  onClose: () => void
}

type Section = 'details' | 'attach' | 'comments'

const mb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`

/** Nothing can be attached on a platform without rules — the window still reads. */
const NO_RULES: TicketReplyRules = {
  files: {},
  labels: [],
  videoExtensions: [],
  maxFileBytes: 0,
  maxVideoBytes: 0,
  maxFiles: 0,
  maxChars: TICKET_REPLY_MAX_CHARS,
  hint: ''
}

const when = (value: string | null): string => {
  if (!value) return ''

  // AJIO sends local times without a zone ("2026-10-22T17:03:15"), which Date reads as local.
  const date = new Date(value.replace(/(\.\d{3})\d+$/, '$1'))

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const isHttps = (value: string): boolean => /^https:\/\/\S+$/.test(value)

/** Text with its https links made clickable — everything else stays text. */
const Linked = ({ text }: { text: string }) => (
  <>
    {text.split(/(https:\/\/\S+)/g).map((part, index) =>
      isHttps(part) ? (
        <a key={index} href={part} target='_blank' rel='noreferrer' className='break-all text-primary'>
          {part}
        </a>
      ) : (
        <span key={index}>{part}</span>
      )
    )}
  </>
)

const SectionHeader = ({ title }: { title: string }) => (
  <Typography variant='h6' color='text.primary' className='font-medium'>
    {title}
  </Typography>
)

export const TicketThreadModal = ({ target, onClose }: Props) => {
  const toast = useToast()
  // What this marketplace's own ticket window takes — types, sizes, one video or none.
  const rules = (target && ticketReplyRules(target.platform)) ?? NO_RULES
  const accept = Object.keys(rules.files).map((extension) => `.${extension}`).join(',')
  const isVideo = (name: string): boolean => rules.videoExtensions.includes(ticketReplyFileExtension(name))
  // The parent remounts this per ticket (`key`), so state starts fresh for each.
  const [thread, setThread] = useState<TicketThread | null>(null)
  const [loading, setLoading] = useState(target !== null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Section | null>('comments')
  const [comment, setComment] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [sending, setSending] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const commentsEnd = useRef<HTMLDivElement | null>(null)
  // An answer for a request the dialog has since moved past is dropped.
  const seq = useRef(0)

  const fetchThread = useCallback((next: TicketThreadTarget) => {
    const mine = ++seq.current

    void openTicketThread(next).then((result) => {
      if (mine !== seq.current) return

      setLoading(false)

      if (result.success) {
        setThread(result.data)
        setError(null)
      } else {
        setError(result.error.message)
      }
    })
  }, [])

  /** Makes any answer still on its way stale — `seq` counts requests, it is not a DOM ref. */
  const dropPending = useCallback(() => {
    seq.current += 1
  }, [])

  useEffect(() => {
    if (target) fetchThread(target)

    return dropPending
  }, [target, fetchThread, dropPending])

  // The newest comment in view, as the portal opens its thread.
  useEffect(() => {
    if (open === 'comments') commentsEnd.current?.scrollIntoView({ block: 'end' })
  }, [thread, open])

  const reload = () => {
    if (!target) return

    setLoading(true)
    setError(null)
    fetchThread(target)
  }

  const addFiles = (picked: File[]) => {
    const accepted: File[] = []

    for (const file of picked) {
      const limit = isVideo(file.name) ? rules.maxVideoBytes : rules.maxFileBytes

      if (!rules.files[ticketReplyFileExtension(file.name)]) {
        toast.error(`${file.name} cannot be attached — use ${rules.labels.join(', ')}`)
      } else if (file.size > limit) {
        toast.error(`${file.name} is over ${mb(limit)}`)
      } else if (isVideo(file.name) && [...files, ...accepted].some((held) => isVideo(held.name))) {
        // Snapdeal carries one video per comment, as its "Attach video" does.
        toast.error('One video per comment — remove the other video first')
      } else {
        accepted.push(file)
      }
    }

    const next = [...files, ...accepted]

    if (next.length > rules.maxFiles) toast.error(`At most ${rules.maxFiles} files per send`)

    setFiles(next.slice(0, rules.maxFiles))
  }

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    // The same file picked twice in a row must still fire a change.
    event.target.value = ''
  }

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)

    if (!sending) addFiles(Array.from(event.dataTransfer.files))
  }

  const canSend =
    !sending && thread !== null && thread.canReply && (comment.trim().length > 0 || files.length > 0)

  const send = async () => {
    if (!target || !canSend) return

    setSending(true)

    const payload = await Promise.all(
      files.map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }))
    )
    const result = await replyToTicketThread({ ...target, text: comment, files: payload })

    setSending(false)

    if (!result.success) {
      toast.error(result.error.message)

      return
    }

    setThread(result.data)
    setComment('')
    setFiles([])
    setOpen('comments')
    toast.success(
      comment.trim() && payload.length > 0
        ? 'Comment and files sent'
        : payload.length > 0
          ? `${payload.length} file${payload.length === 1 ? '' : 's'} attached`
          : 'Comment sent'
    )
  }

  const toggle = (section: Section) => setOpen(open === section ? null : section)

  const title = `Ticket ${target?.ticket ?? ''}${thread?.status ? ` (Status: ${thread.status})` : ''}`

  return (
    <Modal
      open={target !== null}
      title={title}
      description={target ? `${target.platform} · ${target.username}` : undefined}
      onClose={onClose}
      busy={sending}
      size='lg'
      headerActions={
        <Tooltip label='Reload the ticket'>
          <span>
            <IconButton size='small' aria-label='Reload the ticket' disabled={loading || sending || !target} onClick={reload}>
              <i className='tabler-refresh text-lg' />
            </IconButton>
          </span>
        </Tooltip>
      }
    >
      {loading && !thread && (
        <div className='flex flex-col items-center justify-center gap-3 plb-16'>
          <CircularProgress size={28} />
          <Typography variant='body2' color='text.secondary'>
            Opening the ticket on the marketplace…
          </Typography>
        </div>
      )}

      {error && !loading && (
        <Alert
          severity='error'
          action={
            <Button variant='ghost' size='sm' onClick={reload}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {thread && (
        <div className='flex flex-col gap-3'>
          <Accordion expanded={open === 'details'} onChange={() => toggle('details')}>
            <AccordionSummary expandIcon={<i className='tabler-chevron-down' />}>
              <SectionHeader title='Details' />
            </AccordionSummary>
            <AccordionDetails className='flex flex-col gap-5'>
              {thread.title && (
                <Typography variant='subtitle1' color='text.primary' className='font-medium'>
                  {thread.title}
                </Typography>
              )}
              {thread.description && (
                <Typography variant='body2' color='text.primary' className='whitespace-pre-wrap break-words max-w-prose'>
                  <Linked text={thread.description} />
                </Typography>
              )}
              {thread.sections.map((section) => (
                <div key={section.title} className='flex flex-col gap-2'>
                  <Typography variant='subtitle2' color='text.secondary' className='uppercase'>
                    {section.title}
                  </Typography>
                  <dl className='grid gap-x-6 gap-y-3 m-0 sm:grid-cols-2'>
                    {section.fields.map((field) => (
                      <div key={`${section.title}-${field.label}`} className='flex flex-col gap-0.5 min-is-0'>
                        <Typography component='dt' variant='caption' color='text.secondary'>
                          {field.label}
                        </Typography>
                        <Typography component='dd' variant='body2' color='text.primary' className='m-0 break-words'>
                          <Linked text={field.value} />
                        </Typography>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </AccordionDetails>
          </Accordion>

          <Accordion expanded={open === 'attach'} onChange={() => toggle('attach')}>
            <AccordionSummary expandIcon={<i className='tabler-chevron-down' />}>
              <SectionHeader title={`Attach File${files.length > 0 ? ` (${files.length} ready to send)` : ''}`} />
            </AccordionSummary>
            <AccordionDetails className='flex flex-col gap-4'>
              <div className='flex flex-col gap-1'>
                <Typography variant='body2' color='text.primary' className='font-medium'>
                  File upload
                </Typography>
                <Typography variant='caption' color='text.secondary'>
                  {rules.hint} They go with the next Send — with or without a comment.
                </Typography>
                <div className='flex flex-wrap gap-2 mbs-2'>
                  {rules.labels.map((label) => (
                    <Badge key={label} tone='info'>
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>

              <div
                role='button'
                tabIndex={0}
                aria-label='Choose files to attach'
                onClick={() => !sending && fileInput.current?.click()}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && !sending) fileInput.current?.click()
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={dropFiles}
                className={`flex flex-col items-center justify-center gap-2 plb-8 rounded border-2 border-dashed cursor-pointer ${dragging ? 'border-primary bg-primaryLighter' : ''}`}
              >
                <i className='tabler-upload text-2xl text-primary' aria-hidden='true' />
                <Typography variant='body2' color='primary' className='font-medium text-center'>
                  Drop files here or click to choose
                  <br />
                  Max file size: {mb(rules.maxFileBytes)}
                  {rules.videoExtensions.length > 0 ? ` · video ${mb(rules.maxVideoBytes)}` : ''} · up to{' '}
                  {rules.maxFiles} per send
                </Typography>
              </div>
              <input ref={fileInput} type='file' accept={accept} multiple hidden onChange={pickFiles} />

              {files.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                  {files.map((file, index) => (
                    <Chip
                      key={`${file.name}-${index}`}
                      label={file.name}
                      icon={<i className={isVideo(file.name) ? 'tabler-video' : 'tabler-file'} />}
                      onDelete={sending ? undefined : () => setFiles(files.filter((_, at) => at !== index))}
                    />
                  ))}
                </div>
              )}

              {thread.attachments.length > 0 && (
                <div className='flex flex-col gap-2'>
                  <Typography variant='caption' color='text.secondary'>
                    Already on the ticket ({thread.attachments.length})
                  </Typography>
                  <div className='grid gap-2 sm:grid-cols-2'>
                    {thread.attachments.map((attachment, index) => (
                      <div key={`${attachment.name}-${index}`} className='flex items-center gap-2 min-is-0'>
                        <i className='tabler-circle-check text-xl text-success shrink-0' aria-hidden='true' />
                        {attachment.url ? (
                          <a href={attachment.url} target='_blank' rel='noreferrer' className='truncate text-primary' title={attachment.name}>
                            {attachment.name}
                          </a>
                        ) : (
                          <Typography variant='body2' className='truncate'>
                            {attachment.name}
                          </Typography>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </AccordionDetails>
          </Accordion>

          <Accordion expanded={open === 'comments'} onChange={() => toggle('comments')}>
            <AccordionSummary expandIcon={<i className='tabler-chevron-down' />}>
              <SectionHeader title={`Comments${thread.comments.length > 0 ? ` (${thread.comments.length})` : ''}`} />
            </AccordionSummary>
            <AccordionDetails className='flex flex-col gap-4'>
              <div className='flex flex-col gap-3 max-bs-96 overflow-y-auto pie-1'>
                {thread.comments.length === 0 && (
                  <Typography variant='body2' color='text.secondary' className='text-center plb-6'>
                    No comments yet.
                  </Typography>
                )}
                {thread.comments.map((entry, index) => (
                  <div key={`${entry.at ?? ''}-${index}`} className={`flex ${entry.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className='flex flex-col gap-1 max-is-md rounded-lg bg-actionHover p-3'>
                      <div className='flex items-center justify-between gap-4'>
                        <Typography variant='caption' color='text.secondary'>
                          {when(entry.at)}
                        </Typography>
                        <Typography variant='caption' color='text.secondary' className='font-medium'>
                          {entry.author}
                        </Typography>
                      </div>
                      <Typography variant='body2' color='text.primary' className='whitespace-pre-wrap break-words'>
                        <Linked text={entry.text} />
                      </Typography>
                    </div>
                  </div>
                ))}
                <div ref={commentsEnd} />
              </div>

              {!thread.canReply && (
                <Typography variant='body2' color='text.secondary' className='text-center'>
                  This ticket does not take replies on the marketplace.
                </Typography>
              )}
              <div className={thread.canReply ? 'flex items-end gap-3' : 'hidden'}>
                <TextField
                  multiline
                  maxRows={6}
                  fullWidth
                  size='small'
                  placeholder={files.length > 0 ? 'Comment… (optional — the files can go on their own)' : 'Comment…'}
                  aria-label='Comment'
                  value={comment}
                  disabled={sending}
                  slotProps={{ htmlInput: { maxLength: rules.maxChars } }}
                  onChange={(event) => setComment(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send()
                  }}
                />
                <Button
                  icon={<i className='tabler-send' />}
                  loading={sending}
                  disabled={!canSend}
                  onClick={() => void send()}
                >
                  Send{files.length > 0 ? ` (${files.length} file${files.length === 1 ? '' : 's'})` : ''}
                </Button>
              </div>
            </AccordionDetails>
          </Accordion>
        </div>
      )}
    </Modal>
  )
}
