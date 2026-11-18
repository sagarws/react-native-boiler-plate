import {
  type ICms,
  MYNTRA_INITIAL_CLAIM_DETAILS,
  NYKAA_INITIAL_CLAIM_DETAILS,
  OTHER_INITIAL_CLAIM_DETAILS
} from '@shared/types/cmsCreate'

/**
 * A claim with nothing in it — the form's starting values, and where every
 * Normal Bulk Claim row starts before its cells are applied. A FACTORY, so no
 * two claims ever share a bundle object.
 */
export const blankClaim = (): ICms => ({
  eCommercePlatform: '',
  AWBNumber: '',
  typeOfClaim: '',
  costOfMissingArticle: '',
  returnOrderId: '',
  skuName: '',
  pobId: '',
  customerOrderNumber: '',
  forwardAWB: '',
  remark: '',
  returnVideo: '',
  returnVideoLink: '',
  forwardVideo: '',
  forwardVideoLink: '',
  sideImages: '',
  returnProductImage: '',
  forwardSentProductImage: '',
  podProof: '',
  eitherVideoOrLink: '',
  additionalFieldTitle: '',
  additionalFieldValue: '',
  myntraClaimDetails: { ...MYNTRA_INITIAL_CLAIM_DETAILS },
  nykaaClaimDetails: { ...NYKAA_INITIAL_CLAIM_DETAILS },
  otherClaimDetails: { ...OTHER_INITIAL_CLAIM_DETAILS },
  // Account Username dropdown selections (Commit 1: AJIO / Meesho /
  // Snapdeal). Left blank on init so the auto-select on AWB change fires,
  // and the operator can still override / clear from the dropdown.
  ajio_account_email: '',
  meesho_account_email: '',
  snapdeal_account_username: '',
  // Meesho-only
  subOrderNumber: '',
  packetId: '',
  stateOfThePacket: '',
  barcodeImage: '',
  receivedProductImage_1: '',
  reverseWayBillImage: '',
  logisticsPartnerName: '',
  typeOfClaimName: '',
  // Snapdeal-only
  outerPackageImage_1: '',
  outerPackageImage_2: '',
  innerPackageImage_1: '',
  innerPackageImage_2: '',
  productImage_1: '',
  productImage_2: '',
  podImage_1: '',
  podImage_2: '',
})
