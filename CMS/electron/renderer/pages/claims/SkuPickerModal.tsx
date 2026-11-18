import { useEffect, useState } from 'react'

// MUI Imports
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Radio from '@mui/material/Radio'
import Typography from '@mui/material/Typography'

// Icon Imports — the shared Tabler set, bundled; see scripts/build-icon-subset.
import { Modal } from '@renderer/components/ui/Modal'
import { Button } from '@renderer/components/ui/Button'
import { lookupReturnArticles, applySellerSku } from '@renderer/services/skuLookup.service'
import { useToast } from '@renderer/hooks/useToast'
import type { CmsRow } from '@shared/types/cmsList'
import type { ReturnArticle } from '@shared/types/skuLookup'
import { classNames } from '@renderer/utils/format'

/**
 * Choosing a claim's seller SKU from the return's own articles.
 *
 * A claim cannot be filed without one — the AJIO flow refuses to pick an
 * article when the return has several and none was given, because guessing
 * files the claim against the wrong item. Master data supplies it when master
 * data has the row, and these are the rows it does not.
 *
 * So the app asks AJIO what is actually on the return and a PERSON picks. That
 * split is the whole design: the one decision an automation must not make is
 * the one a human settles at a glance from a product name.
 *
 * The picture is a nice-to-have and is treated as one. No capture of AJIO's
 * detail response names an image field, so the core probes the plausible names
 * and returns null when none is there — and this list is built to read
 * perfectly well without one.
 */

/** AJIO's field names, as the operator sees them in the list. */
const FIELD_LABEL: Record<string, string> = {
  sellerSkuId: 'Seller SKU',
  sterlingSkuId: 'Sterling ID',
  itemCode: 'Jio code',
  eanCode: 'EAN',
  scanCode: 'Scan code'
}

const Identifier = ({ label, value }: { label: string; value: string }) =>
  value ? (
    <Typography component="span" variant="caption" color="text.secondary">
      {label} <span className="select-text font-mono text-textPrimary">{value}</span>
    </Typography>
  ) : null

const Thumbnail = ({ article }: { article: ReturnArticle }) => {
  const [broken, setBroken] = useState(false)

  if (!article.imageUrl || broken) {
    return (
      <Paper
        variant="outlined"
        className="flex size-14 shrink-0 items-center justify-center bg-backgroundDefault text-textDisabled"
      >
        <i className="tabler-photo-off text-base" />
      </Paper>
    )
  }

  return (
    <img
      src={article.imageUrl}
      alt=""
      // Decorative: the product name beside it is the real label, and a broken
      // URL must degrade to the placeholder rather than to a broken-image icon
      // with alt text pretending to be content.
      onError={() => setBroken(true)}
      className="size-14 shrink-0 rounded-md bg-backgroundDefault object-cover"
    />
  )
}

export const SkuPickerModal = ({
  row,
  onClose,
  onApplied
}: {
  /** Null when the picker is shut. */
  row: CmsRow | null
  onClose: () => void
  onApplied: () => void
}) => {
  const toast = useToast()
  // Both are stamped with the claim they belong to, and read back through it.
  //
  // That is what makes opening the picker on a second row show a spinner rather
  // than the first row's articles — and it does the clearing without a
  // synchronous write from the effect, which would re-render the modal twice
  // before the fetch had even started.
  const [answer, setAnswer] = useState<{
    cmsId: string
    articles: ReturnArticle[] | null
    error: string | null
  } | null>(null)
  const [picked, setPicked] = useState<{ cmsId: string; sellerSku: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const current = row && answer?.cmsId === row.id ? answer : null
  const articles = current?.articles ?? null
  const error = current?.error ?? null
  const chosen = row && picked?.cmsId === row.id ? picked.sellerSku : ''

  useEffect(() => {
    if (!row) return undefined

    const cmsId = row.id
    let cancelled = false

    void lookupReturnArticles({
      cmsId,
      platform: row.platform,
      awbNumber: row.returnAwb,
      pobId: row.pobId,
      username: row.username,
      accountType: row.accountType
    }).then(response => {
      if (cancelled) return

      if (!response.success) {
        setAnswer({ cmsId, articles: null, error: response.error.message })

        return
      }

      setAnswer({ cmsId, articles: response.data.articles, error: null })

      // A single-article return has nothing to choose between, so it is
      // pre-selected — the operator confirms rather than performs a decision
      // that has only one answer.
      const only = response.data.articles.length === 1 ? response.data.articles[0] : null

      if (only?.sellerSku) setPicked({ cmsId, sellerSku: only.sellerSku })
    })

    return () => {
      cancelled = true
    }
  }, [row])

  const save = async (): Promise<void> => {
    if (!row || !chosen) return

    setSaving(true)

    const response = await applySellerSku(row.id, chosen)

    setSaving(false)

    if (!response.success) {
      toast.error(response.error.message)

      return
    }

    // Naming what it replaced matters: correcting a SKU and setting one for the
    // first time look identical afterwards, and only one of them undid a
    // previous answer.
    toast.success(
      response.data.previous
        ? `SKU changed from ${response.data.previous} to ${response.data.sellerSku}`
        : `SKU set to ${response.data.sellerSku}`
    )

    onApplied()
    onClose()
  }

  return (
    <Modal
      size="lg"
      open={row !== null}
      title="Choose the seller SKU"
      description={
        row ? `Articles AJIO holds against return ${row.returnAwb}, POB ${row.pobId || '—'}` : ''
      }
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} loading={saving} disabled={!chosen}>
            Use this SKU
          </Button>
        </>
      }
    >
      {error && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}

      {!error && articles === null && (
        <Typography variant="body2" color="text.secondary" className="flex items-center gap-2 plb-6">
          <CircularProgress size={16} color="inherit" />
          Reading the return from AJIO — this opens a seller login, so give it a moment.
        </Typography>
      )}

      {articles?.length === 0 && (
        <Alert severity="info">
          AJIO returned no articles for this return. Nothing can be chosen.
        </Alert>
      )}

      {articles && articles.length > 0 && (
        <>
          {row?.sellerSku && (
            <Typography variant="body2" color="text.secondary" className="mbe-3">
              This claim currently says{' '}
              <span className="select-text font-mono text-textPrimary">{row.sellerSku}</span>. Choosing
              here replaces it.
            </Typography>
          )}

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {articles.map(article => {
              // Pickable when AJIO gave it ANY of the five identifiers the claim
              // matches on — not just a seller SKU. Real returns come back with
              // `sellerSkuId` empty and the article identified by its Sterling
              // id or EAN, and refusing those left the one article on the return
              // unselectable and the claim unfileable.
              const storable = article.storable
              const selectable = storable !== null
              const active = selectable && chosen === storable.value

              return (
                <li key={article.returnItemId || article.sellerSku || article.productName}>
                  <Paper
                    component="label"
                    variant="outlined"
                    className={classNames(
                      'flex gap-3 p-3 transition-colors',
                      selectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                      active ? 'bg-primaryLighter' : 'hover:bg-actionHover'
                    )}
                    sx={active ? { borderColor: 'primary.main' } : undefined}
                  >
                    <Radio
                      size="small"
                      name="sku"
                      className="shrink-0 self-start"
                      sx={{ p: 0 }}
                      checked={active}
                      disabled={!selectable}
                      onChange={() =>
                        storable && setPicked({ cmsId: row?.id ?? '', sellerSku: storable.value })
                      }
                    />

                    <Thumbnail article={article} />

                    <span className="min-w-0 flex-1">
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.primary"
                        className="block truncate font-medium"
                      >
                        {article.productName || 'Unnamed product'}
                      </Typography>

                      <span className="mbs-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        <Identifier label="SKU" value={article.sellerSku} />
                        <Identifier label="Sterling" value={article.sterlingSkuId} />
                        <Identifier label="Jio code" value={article.itemCode} />
                        <Identifier label="EAN" value={article.eanCode} />
                        <Identifier label="Scan" value={article.scanCode} />
                        {article.quantity !== null && (
                          <Typography component="span" variant="caption" color="text.secondary">
                            Qty <span className="tabular-nums text-textPrimary">{article.quantity}</span>
                          </Typography>
                        )}
                      </span>

                      {/* Say WHICH identifier will be stored whenever it is not
                          the seller SKU — the operator is about to save a value
                          that is not in the column they were looking at, and
                          finding that out afterwards is worse. */}
                      {storable && storable.field !== 'sellerSkuId' && (
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                          className="mbs-1 block"
                        >
                          AJIO returned no seller SKU here, so{' '}
                          <span className="font-mono text-textPrimary">{storable.value}</span> will be
                          stored ({FIELD_LABEL[storable.field] ?? storable.field}). The claim matches
                          on all of these, so it files the same either way.
                        </Typography>
                      )}

                      {storable && !storable.unique && (
                        <Typography
                          component="span"
                          variant="caption"
                          color="warning.main"
                          className="mbs-1 block"
                        >
                          Another article on this return carries the same identifier, so the claim
                          would pick whichever comes first. Check the product before saving.
                        </Typography>
                      )}

                      {!selectable && (
                        <Typography
                          component="span"
                          variant="caption"
                          color="warning.main"
                          className="mbs-1 block"
                        >
                          AJIO returned no identifier at all for this article, so nothing can be
                          stored against it.
                        </Typography>
                      )}
                    </span>
                  </Paper>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Modal>
  )
}
