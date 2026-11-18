import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * Reading a return's articles off AJIO so a person can pick the SKU.
 *
 * The claim flow refuses to choose an article when a return has several and no
 * SKU was given — guessing files the claim against the wrong item — so a row
 * without one cannot be filed at all. AJIO's return-order detail lists every
 * article, and this is the flattening that turns it into something choosable.
 *
 * The rules worth pinning are about what it must NOT do: invent a picture it
 * was not given, and lose an article it cannot fully read.
 */

const require_ = createRequire(import.meta.url)

interface Article {
  sellerSku: string
  sterlingSkuId: string
  itemCode: string
  eanCode: string
  scanCode: string
  productName: string
  imageUrl: string | null
  quantity: number | null
  returnItemId: string
  storable?: { value: string; field: string; unique: boolean } | null
}

const { toArticle, storableSku, IMAGE_FIELDS } = require_(
  '@trackvid/automation-core/platforms/ajio/claim-management/api-based-flow/returnArticles'
) as {
  toArticle: (item: unknown) => Article
  storableSku: (
    article: Article,
    articles: Article[]
  ) => { value: string; field: string; unique: boolean } | null
  IMAGE_FIELDS: string[]
}

describe('toArticle', () => {
  it('carries every identifier AJIO can put the seller SKU on', () => {
    // The claim flow matches against all five because AJIO returns the seller's
    // own SKU on a different one depending on the account. A picker showing
    // only sellerSkuId shows a blank row for those.
    const article = toArticle({
      returnItemId: 'RI-1',
      returnQuantity: 2,
      product: {
        sellerSkuId: 'Cargo-33-Grey-S',
        sterlingSkuId: 'STG1',
        itemCode: 'JIO1',
        eanCode: 'EAN1',
        scanCode: 'SCAN1',
        productName: 'Cargo Trousers'
      }
    })

    expect(article).toEqual({
      sellerSku: 'Cargo-33-Grey-S',
      sterlingSkuId: 'STG1',
      itemCode: 'JIO1',
      eanCode: 'EAN1',
      scanCode: 'SCAN1',
      productName: 'Cargo Trousers',
      imageUrl: null,
      quantity: 2,
      returnItemId: 'RI-1'
    })
  })

  it('reports no picture rather than inventing one', () => {
    // No capture of AJIO's detail response names an image field, so the picker
    // is built to work without one. A guessed URL would render a broken image
    // beside a real product and make the list less trustworthy, not more.
    expect(toArticle({ product: { sellerSkuId: 'A' } }).imageUrl).toBeNull()
    expect(toArticle({ product: { sellerSkuId: 'A', imageUrl: 'not-a-url' } }).imageUrl).toBeNull()
    expect(toArticle({ product: { sellerSkuId: 'A', imageUrl: '' } }).imageUrl).toBeNull()
  })

  it('shows a picture when the payload turns out to carry one', () => {
    for (const field of IMAGE_FIELDS) {
      expect(toArticle({ product: { [field]: 'https://x/img.jpg' } }).imageUrl).toBe(
        'https://x/img.jpg'
      )
    }

    // Some payloads hang it off the item rather than the product, so both are
    // probed — the product first, since that is what the picture is of.
    expect(toArticle({ imageUrl: 'https://x/item.jpg', product: {} }).imageUrl).toBe(
      'https://x/item.jpg'
    )
  })

  it('keeps an article it can only half read', () => {
    // An article with no seller SKU is still ON the return. Dropping it would
    // make the list silently short, and an operator counting three articles in
    // the AJIO UI against two here has no way to tell which is wrong.
    const article = toArticle({ product: { productName: 'Mystery item' } })

    expect(article.sellerSku).toBe('')
    expect(article.productName).toBe('Mystery item')
  })

  it('survives a payload with no product at all', () => {
    expect(() => toArticle({})).not.toThrow()
    expect(toArticle({}).sellerSku).toBe('')
    // A missing quantity is null, not 0: nobody returned zero of anything, and
    // "0" beside a product would read as a fact.
    expect(toArticle({}).quantity).toBeNull()
  })

  it('does not turn a non-numeric quantity into a number', () => {
    expect(toArticle({ returnQuantity: '2' }).quantity).toBeNull()
  })
})

describe('storableSku', () => {
  const article = (over: Partial<Article>): Article =>
    toArticle({
      product: {
        sellerSkuId: over.sellerSku,
        sterlingSkuId: over.sterlingSkuId,
        itemCode: over.itemCode,
        eanCode: over.eanCode,
        scanCode: over.scanCode,
        productName: over.productName
      }
    })

  it('prefers the seller SKU when AJIO returned one', () => {
    const only = article({ sellerSku: 'Cargo-33-Grey-S', sterlingSkuId: 'STG1' })

    expect(storableSku(only, [only])).toEqual({
      value: 'Cargo-33-Grey-S',
      field: 'sellerSkuId',
      unique: true
    })
  })

  it('falls back through the other four when it did not', () => {
    // The case that exposed this: return R2454715693AJI came back with
    // sellerSkuId empty and the article identified by its Sterling id, Jio
    // code, EAN and scan code. Refusing it left the ONLY article on the return
    // unselectable, and the claim unfileable.
    const only = article({
      productName: 'Men Mid-Wash Slim Jogger Jeans with Drawstring Waist',
      sterlingSkuId: '469172786006',
      itemCode: '469172786006',
      eanCode: '8907979291632',
      scanCode: '8907979291632'
    })

    expect(storableSku(only, [only])).toEqual({
      value: '469172786006',
      field: 'sterlingSkuId',
      unique: true
    })
  })

  it('skips an identifier another article on the return also carries', () => {
    // `selectReturnItem` takes the FIRST article a stored value matches, so a
    // shared EAN would file the claim against a sibling line. The size-specific
    // Sterling id is what tells them apart.
    const small = article({ sterlingSkuId: 'STG-S', eanCode: 'SHARED-EAN' })
    const large = article({ sterlingSkuId: 'STG-L', eanCode: 'SHARED-EAN' })

    expect(storableSku(small, [small, large])?.value).toBe('STG-S')
    expect(storableSku(large, [small, large])?.value).toBe('STG-L')
  })

  it('compares the way the claim does, so punctuation is not a difference', () => {
    // selectReturnItem's second pass strips every non-alphanumeric character,
    // so "Cargo-33" and "Cargo33" are the same value to it — and two articles
    // holding those are NOT distinguishable, however different they look.
    const a = article({ sellerSku: 'Cargo-33' })
    const b = article({ sellerSku: 'cargo 33' })

    expect(storableSku(a, [a, b])?.unique).toBe(false)
  })

  it('still offers an article whose every identifier is shared, and says so', () => {
    // Nothing distinguishes them, so no choice is safe — but refusing to store
    // anything leaves the row unfileable, which is worse than a warned guess.
    const a = article({ sellerSku: 'SAME' })
    const b = article({ sellerSku: 'SAME' })

    expect(storableSku(a, [a, b])).toEqual({ value: 'SAME', field: 'sellerSkuId', unique: false })
  })

  it('refuses an article AJIO gave no identifier at all', () => {
    const nameOnly = article({ productName: 'Mystery item' })

    expect(storableSku(nameOnly, [nameOnly])).toBeNull()
  })
})
