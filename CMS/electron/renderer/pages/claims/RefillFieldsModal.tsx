import { useState } from 'react'
import Card from '@mui/material/Card'
import Typography from '@mui/material/Typography'
import type { RefillField } from '@shared/types/refill'
import { REFILL_LABELS, refillBlankFieldsFor } from '@shared/constants/refill'
import { Button } from '@renderer/components/ui/Button'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { Switch } from '@renderer/components/ui/Switch'
import { Modal } from '@renderer/components/ui/Modal'

/**
 * What to refill, asked BEFORE any rows are ticked.
 *
 * The order matters: the fields decide what the run costs and what it may
 * write, so they are chosen first and the table is then armed for the rows.
 * Asking afterwards would be asking permission for a run already described.
 *
 * Everything is ticked by default — the usual answer is "whatever is missing",
 * and un-ticking two is less work than ticking three. The list is per platform,
 * because a field no marketplace answers is not a choice, it is a false
 * promise: Myntra has a forward AWB, Meesho a sub-order number, Xbees neither.
 */

interface Props {
  open: boolean
  platform: string
  onStart: (fields: RefillField[], useApis: boolean) => void
  onClose: () => void
}

/**
 * The platforms whose refill is answered from THIS MACHINE, and can instead be
 * asked of the marketplace.
 *
 * AJIO alone: its account, POB, SKU and forward AWB are read out of the local
 * report backup, which is instant and needs no login — and only as complete as
 * the backup. Every other platform already asks the marketplace, so a toggle
 * there would offer a choice that does not exist.
 */
const OFFLINE_PLATFORMS = new Set(['ajio'])

export const RefillFieldsModal = ({ open, platform, onStart, onClose }: Props) => {
  // The blanks only. The claim status is its own button on the Claims page —
  // it asks about filed tickets, which are not the rows this run is for.
  const available = refillBlankFieldsFor(platform)
  const [picked, setPicked] = useState<Set<RefillField>>(new Set(available))
  const canUseApis = OFFLINE_PLATFORMS.has(platform.trim().toLowerCase())
  /**
   * Off by default, deliberately: the local answer is the right one whenever
   * the backup holds the row, and it costs no login and no minutes.
   */
  const [useApis, setUseApis] = useState(false)

  const toggle = (field: RefillField): void => {
    setPicked(current => {
      const next = new Set(current)

      if (next.has(field)) next.delete(field)
      else next.add(field)

      return next
    })
  }

  return (
    <Modal
      open={open}
      size="md"
      title={`Refill Data · ${platform}`}
      description="Pick what the marketplace should be asked for. You choose the rows next."
      onClose={onClose}
      footer={
        <>
          <Typography variant="caption" color="text.secondary" className="self-center">
            {picked.size} of {available.length} selected
          </Typography>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={picked.size === 0} onClick={() => onStart([...picked], canUseApis && useApis)}>
            Select rows
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {available.map(field => {
          const { label, description } = REFILL_LABELS[field]

          return (
            <Card
              key={field}
              variant="outlined"
              component="label"
              className="flex cursor-pointer items-start gap-3 p-3 hover:bg-actionHover"
            >
              <Checkbox
                ariaLabel={label}
                checked={picked.has(field)}
                onChange={() => toggle(field)}
              />
              <span className="min-w-0">
                <Typography variant="body2" color="text.primary" className="block font-medium" component="span">
                  {label}
                </Typography>
                <Typography variant="caption" color="text.secondary" className="block" component="span">
                  {description}
                </Typography>
              </span>
            </Card>
          )
        })}

        {/* AJIO ONLY, and it changes where the answers come from rather than
            which are asked for — so it sits apart from the field list, under a
            rule of its own. */}
        {canUseApis && (
          <Card variant="outlined" className="mbs-1 p-3">
            <Switch
              checked={useApis}
              onChange={setUseApis}
              label="Use APIs"
              description={
                useApis
                  ? 'Asks AJIO directly, POB by POB, over the last 12 months. Needs a signed-in ' +
                    'login and takes longer — but answers for rows the local backup has never held.'
                  : 'Answers from this machine’s AJIO report backup: instant, no login. It can ' +
                    'only fill rows the backup holds — turn this on for the ones it misses.'
              }
            />
          </Card>
        )}

        {/* Said here rather than discovered afterwards: an operator deciding
            what to run is exactly who needs to know what it will not touch. */}
        <Typography variant="caption" color="text.secondary" component="p" className="mbs-1">
          Existing values are kept — only blanks are filled. To refresh where a filed ticket
          stands, use Status Change instead.
        </Typography>
      </div>
    </Modal>
  )
}
