import type { BulkSpec } from '../common/bulk'
import { shippingAndPackingPlacement } from '../common/packingBulk'

/** Delhivery in Normal Bulk Claim. Its selects come from the registry's header fields. */
export const delhiveryBulk: BulkSpec = { columns: [], place: shippingAndPackingPlacement }
