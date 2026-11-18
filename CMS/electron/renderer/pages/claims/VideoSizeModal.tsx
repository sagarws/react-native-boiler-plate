import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Typography from '@mui/material/Typography'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import type { VideoSizeChoice } from '@shared/types/claimResources'

/**
 * Asked before a Meesho claim's evidence is downloaded: does the video need to
 * fit the portal's upload limit, or should it come as it is?
 *
 * BOTH ANSWERS ARE RIGHT, for different jobs, which is why this is a question
 * and not a setting. A zip meant for filing the claim by hand needs a video the
 * portal will accept — Meesho refuses anything over 25MB with a bare HTTP 400,
 * and an operator discovers that at the form, after the upload has run. A zip
 * meant for anything else — a courier dispute, an internal review, an appeal —
 * wants the full-quality file, and re-encoding it there would be quality thrown
 * away for nothing.
 *
 * Only shown for a platform that has actually stated a cap. A video already
 * under it is untouched either way, so the answer costs nothing when it does
 * not matter.
 */

interface Props {
  /** The platform whose cap is in play; null closes the dialog. */
  platform: string | null
  /** Its cap, in bytes, for the copy to name honestly. */
  limitBytes: number | null
  onChoose: (choice: VideoSizeChoice) => void
  onClose: () => void
}

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(0)}MB`

export const VideoSizeModal = ({ platform, limitBytes, onChoose, onClose }: Props) => {
  const cap = limitBytes ? mb(limitBytes) : 'the portal limit'

  return (
    <Modal
      open={platform !== null}
      title="How should the video come?"
      description={`${platform ?? 'This marketplace'} refuses an attachment over ${cap}. A video already under it is untouched either way.`}
      onClose={onClose}
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Card variant="outlined">
          <CardActionArea onClick={() => onChoose('fit')} className="flex items-start justify-start gap-3 p-3 text-start">
            <i className="tabler-scissors text-base shrink-0 mt-0.5 text-textSecondary" aria-hidden="true" />
            <span className="flex flex-col gap-1">
              <Typography variant="body2" color="text.primary" className="font-medium">
                Shrink it to fit {cap}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Re-encoded to the largest size that still uploads — same footage, lower bitrate. A long
                clip takes a minute or two. This is the one to file the claim with.
              </Typography>
            </span>
          </CardActionArea>
        </Card>

        <Card variant="outlined">
          <CardActionArea onClick={() => onChoose('original')} className="flex items-start justify-start gap-3 p-3 text-start">
            <i className="tabler-video text-base shrink-0 mt-0.5 text-textSecondary" aria-hidden="true" />
            <span className="flex flex-col gap-1">
              <Typography variant="body2" color="text.primary" className="font-medium">
                Leave it as it is
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Full quality, exactly as the row holds it — and refused by the portal if it is over {cap}.
                Right for an appeal, a courier dispute, or anything that is not the claim form.
              </Typography>
            </span>
          </CardActionArea>
        </Card>

        <Typography variant="caption" color="text.secondary" className="flex items-center gap-2">
          <i className="tabler-download text-base shrink-0" aria-hidden="true" />
          The images and the form&apos;s text fields are the same either way.
        </Typography>
      </div>
    </Modal>
  )
}
