import { trimOrUndef, type UpdateBuilder } from '../common/payload'

export const MEESHO_CREATE_FIELDS: ReadonlySet<string> = new Set([
  'eCommercePlatform',
  'AWBNumber',
  'typeOfClaim',
  'typeOfClaimName',
  'costOfMissingArticle',
  'forwardAWB',
  'remark',
  'returnVideo',
  'returnVideoLink',
  'forwardVideo',
  'forwardVideoLink',
  'subOrderNumber',
  'packetId',
  'stateOfThePacket',
  'barcodeImage',
  'receivedProductImage_1',
  'reverseWayBillImage',
  'eitherVideoOrLink',
  'logisticsPartnerName'
])

export const meeshoUpdate: UpdateBuilder = ({ values, platformLabel }) => {
  const payload: Record<string, unknown> = {}

  const stateOfThePacket = trimOrUndef(values.stateOfThePacket)
  if (stateOfThePacket) payload.stateOfThePacket = stateOfThePacket

  const packetId = trimOrUndef(values.packetId)
  if (packetId) payload.packetId = packetId

  const logistics = trimOrUndef(values.logisticsPartnerName)
  if (logistics) payload.logisticsPartnerName = logistics

  // A number, and only a sane one: the field is free text on the form, and the
  // endpoint stores what it is given.
  const cost = values.costOfMissingArticle

  if (cost !== undefined && cost !== null && cost !== '') {
    const parsed = Number(cost)

    if (Number.isFinite(parsed) && parsed >= 0) payload.costOfMissingArticle = parsed
  }

  for (const field of ['barcodeImage', 'receivedProductImage_1', 'reverseWayBillImage'] as const) {
    const key = trimOrUndef(values[field])

    if (key) payload[field] = key
  }

  payload.eCommercePlatform = platformLabel

  return payload
}
