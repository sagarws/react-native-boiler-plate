import { DEFAULT_BULK, type BulkSpec } from '../common/bulk'

/** Nykaa in Normal Bulk Claim: the default layout plus its three order fields. */
export const nykaaBulk: BulkSpec = {
  ...DEFAULT_BULK,
  columns: [
    { header: 'Vendor Code', path: 'nykaaClaimDetails.vendorCode', required: true },
    { header: 'SKU ID', path: 'nykaaClaimDetails.skuId', required: true },
    {
      header: 'Return Type',
      path: 'nykaaClaimDetails.returnType',
      required: true,
      options: ['RTO', 'DTO', 'REPL'],
      toValue: (raw) => raw.toUpperCase()
    }
  ]
}
