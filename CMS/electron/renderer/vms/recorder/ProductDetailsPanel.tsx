import { useEffect, useState } from 'react'
import Avatar from '@mui/material/Avatar'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { Badge } from '@renderer/components/ui/Badge'
import { recorderClient, type ProductDetail } from './recorderClient'

/**
 * The product the scanned AWB maps to: SKU, quantity, colour, size, image —
 * from `vms:order-product-details`. Ported from Argos Watch's
 * ProductDetailsPanel into a Veylix glass card.
 *
 * Debounced 400 ms; the duplicate check runs on the same input at 250 ms, and
 * the two are deliberately staggered so their log lines can be told apart.
 */
interface Props {
  trackingId: string
  companyId: string
}

const DEBOUNCE_MS = 400

export const ProductDetailsPanel = ({ trackingId, companyId }: Props) => {
  const [items, setItems] = useState<ProductDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = trackingId.trim()

    if (!trimmed || !companyId) {
      // Deferred so the effect body does not set state synchronously.
      queueMicrotask(() => {
        setItems([])
        setError(null)
        setLoading(false)
      })

      return
    }

    let cancelled = false

    const timer = setTimeout(() => {
      setLoading(true)
      void recorderClient.productDetails(trimmed, companyId).then(response => {
        if (cancelled) return
        setLoading(false)

        if (response.success) {
          setItems(response.data)
          setError(response.data.length === 0 ? 'No matching SKU on file for this AWB.' : null)
        } else {
          setItems([])
          setError(response.error.message)
        }
      })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trackingId, companyId])

  return (
    <section className='veylix-glass flex min-bs-0 flex-col gap-3 p-5' aria-label='Product details'>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='veylix-card-title'>
          {items.length === 0 ? 'No Product Details' : `Product Details (${items.length})`}
        </h2>
        {loading && <CircularProgress size={14} aria-label='Looking up the product' />}
      </div>

      {items.length === 0 ? (
        <div className='veylix-note flex flex-col items-center justify-center gap-2 p-4 text-center'>
          <i className='tabler-package text-3xl' aria-hidden='true' style={{ color: 'var(--veylix-empty-icon)' }} />
          <Typography variant='caption' sx={{ color: 'inherit' }}>
            {error ?? 'Scan an AWB to look up the product SKU and quantity.'}
          </Typography>
        </div>
      ) : (
        <div className='flex max-h-80 flex-col gap-2 overflow-auto'>
          {items.map((item, index) => (
            <div key={`${item.sellerSkuCode}-${index}`} className='veylix-tile flex gap-3 p-2.5'>
              <Avatar
                variant='rounded'
                {...(item.imageLink ? { src: item.imageLink } : {})}
                alt={item.sellerSkuCode || 'SKU'}
                sx={{ inlineSize: 52, blockSize: 52, borderRadius: '9px' }}
              >
                <i className='tabler-package' />
              </Avatar>
              <div className='flex min-is-0 flex-1 flex-col gap-1'>
                <Typography variant='body2' noWrap sx={{ fontWeight: 700, color: 'text.primary' }}>
                  {item.sellerSkuCode || 'Unknown SKU'}
                </Typography>
                <div className='flex flex-wrap gap-1'>
                  {item.size && <Badge>{item.size}</Badge>}
                  {item.color && <Badge>{item.color}</Badge>}
                  <Badge tone='info'>{`Qty ${item.quantity}`}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
