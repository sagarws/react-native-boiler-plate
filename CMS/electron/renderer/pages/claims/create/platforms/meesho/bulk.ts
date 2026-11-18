import { getMeeshoOrderInfo } from '../../api'
import { fillBlank, isBlank, keyOf, setIn, type BulkSpec } from '../common/bulk'

const LOGISTICS_PARTNERS = ['Delhivery', 'Bluedart', 'Ecom', 'Xpressbees', 'Shadowfax', 'Valmo']

/** The form stores the packet state by id; the sheet asks for the word. */
const PACKET_STATES: Record<string, string> = { intact: '1', tampered: '2' }

/**
 * Meesho in Normal Bulk Claim.
 *
 * Screenshots land where the form's auto-fill puts them — first on the
 * barcode, the second on the received product, the last on the reverse
 * waybill — and the master lookup fills the sub order, forward AWB and courier
 * the form fills from the same call.
 */
export const meeshoBulk: BulkSpec = {
  columns: [
    {
      header: 'Sub Order Number',
      path: 'subOrderNumber',
      hint: 'Optional — read from Meesho master data when blank.'
    },
    { header: 'Packet ID', path: 'packetId' },
    {
      header: 'State Of The Packet',
      path: 'stateOfThePacket',
      required: true,
      options: ['Intact', 'Tampered'],
      toValue: (raw) => PACKET_STATES[raw.trim().toLowerCase()] ?? raw
    },
    { header: 'Logistics Partner', path: 'logisticsPartnerName', options: LOGISTICS_PARTNERS }
  ],
  place: (values, screenshots) => {
    const first = screenshots[0]
    const last = screenshots.length > 1 ? screenshots[screenshots.length - 1] : ''
    const middle = screenshots.length > 2 ? screenshots[1] : ''
    let next = values

    if (first) next = setIn(next, 'barcodeImage', keyOf(first))
    if (middle) next = setIn(next, 'receivedProductImage_1', keyOf(middle))
    if (last) next = setIn(next, 'reverseWayBillImage', keyOf(last))

    return { values: next, sideImages: [] }
  },
  enrich: async (values) => {
    if (!isBlank(values.subOrderNumber) && !isBlank(values.forwardAWB)) return values

    try {
      const response = await getMeeshoOrderInfo({ returnAwbNo: values.AWBNumber })
      const info = (response.data?.data ?? {}) as Record<string, string | undefined>
      let next = fillBlank(values, 'subOrderNumber', info.subOrderNo)

      next = fillBlank(next, 'forwardAWB', info.forwardAwbNo)
      if (info.courierPartner && LOGISTICS_PARTNERS.includes(info.courierPartner)) {
        next = fillBlank(next, 'logisticsPartnerName', info.courierPartner)
      }

      return next
    } catch {
      // No master data yet — the validator names whatever is still missing.
      return values
    }
  }
}
