import { getSnapdealOrderInfo } from '../../api'
import { fillBlank, isBlank, keyOf, setIn, type BulkSpec } from '../common/bulk'

/** The form's eight slots, in the order its auto-fill fills them. */
const SLOTS = [
  'outerPackageImage_1',
  'outerPackageImage_2',
  'innerPackageImage_1',
  'innerPackageImage_2',
  'productImage_1',
  'productImage_2',
  'podImage_1',
  'podImage_2'
]

/** Snapdeal in Normal Bulk Claim: screenshots slot by slot, sub order from master data. */
export const snapdealBulk: BulkSpec = {
  refill: true,
  columns: [
    {
      header: 'Sub Order Number',
      path: 'subOrderNumber',
      hint: 'Optional — read from Snapdeal master data when blank.'
    }
  ],
  place: (values, screenshots) => {
    let next = values

    SLOTS.forEach((field, index) => {
      const url = screenshots[index]

      if (url) next = setIn(next, field, keyOf(url))
    })

    return { values: next, sideImages: [] }
  },
  enrich: async (values) => {
    if (!isBlank(values.subOrderNumber) && !isBlank(values.forwardAWB)) return values

    try {
      const response = await getSnapdealOrderInfo({ returnAwbNo: values.AWBNumber })
      const info = (response.data?.data ?? {}) as Record<string, string | undefined>

      return fillBlank(
        fillBlank(values, 'subOrderNumber', info.subOrderNo),
        'forwardAWB',
        info.forwardAwbNo
      )
    } catch {
      return values
    }
  }
}
