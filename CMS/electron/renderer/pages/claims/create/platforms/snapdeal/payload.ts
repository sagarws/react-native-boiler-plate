import { trimOrUndef, type UpdateBuilder } from '../common/payload'

/** Snapdeal's eight named photographs, in the order its claim form asks for them. */
const IMAGE_SLOTS = [
  'outerPackageImage_1',
  'outerPackageImage_2',
  'innerPackageImage_1',
  'innerPackageImage_2',
  'productImage_1',
  'productImage_2',
  'podImage_1',
  'podImage_2'
] as const

export const SNAPDEAL_CREATE_FIELDS: ReadonlySet<string> = new Set([
  'eCommercePlatform',
  'AWBNumber',
  'typeOfClaim',
  'forwardAWB',
  'remark',
  'returnVideo',
  'returnVideoLink',
  'forwardVideo',
  'forwardVideoLink',
  'subOrderNumber',
  'skuName',
  'costOfMissingArticle',
  ...IMAGE_SLOTS,
  'eitherVideoOrLink'
])

export const snapdealUpdate: UpdateBuilder = ({ values, platformLabel }) => {
  const payload: Record<string, unknown> = {}

  for (const slot of IMAGE_SLOTS) {
    const key = trimOrUndef(values[slot])

    if (key) payload[slot] = key
  }

  payload.eCommercePlatform = platformLabel

  return payload
}
