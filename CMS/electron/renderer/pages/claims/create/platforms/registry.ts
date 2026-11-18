import type { ComponentType } from 'react'
import {
  AMAZON_FULFILLMENT_CHANNEL_OPTIONS,
  DELHIVERY_DOMESTIC_OPTIONS,
  DELHIVERY_SHIPMENT_ISSUE,
  DELHIVERY_SUBCATEGORY_OPTIONS,
  FLIPKART_CLAIM_AREA_OPTIONS
} from '@shared/types/cmsCreate'

import type { Validator } from '../validation'
import {
  amazonValidation,
  commonValidation,
  delhiveryValidation,
  flipkartValidation,
  meeshoValidation,
  myntraValidation,
  nykaaValidation,
  snapdealValidation,
  tataCliqValidation,
  xbeesValidation
} from '../validation'
import {
  COMMON_CREATE_FIELDS,
  noUpdateFields,
  type UpdateBuilder
} from './common/payload'
import { ajioUpdate } from './ajio/payload'
import { amazonUpdate } from './amazon/payload'
import { delhiveryUpdate } from './delhivery/payload'
import { FLIPKART_CREATE_FIELDS, flipkartUpdate } from './flipkart/payload'
import { MEESHO_CREATE_FIELDS, meeshoUpdate } from './meesho/payload'
import { MYNTRA_CREATE_FIELDS, myntraUpdate } from './myntra/payload'
import { nykaaUpdate } from './nykaa/payload'
import { SNAPDEAL_CREATE_FIELDS, snapdealUpdate } from './snapdeal/payload'
import { tataCliqUpdate } from './tatacliq/payload'
import { xbeesUpdate } from './xbees/payload'
import { DEFAULT_BULK, type BulkSpec } from './common/bulk'
import { ajioBulk } from './ajio/bulk'
import { amazonBulk } from './amazon/bulk'
import { delhiveryBulk } from './delhivery/bulk'
import { flipkartBulk } from './flipkart/bulk'
import { meeshoBulk } from './meesho/bulk'
import { myntraBulk } from './myntra/bulk'
import { nykaaBulk } from './nykaa/bulk'
import { snapdealBulk } from './snapdeal/bulk'
import { tataCliqBulk } from './tatacliq/bulk'
import { xbeesBulk } from './xbees/bulk'

import AjioForm from './ajio/ClaimForm'
import AmazonForm from './amazon/ClaimForm'
import DelhiveryForm from './delhivery/ClaimForm'
import FlipkartForm from './flipkart/ClaimForm'
import MeeshoForm from './meesho/ClaimForm'
import MyntraForm from './myntra/ClaimForm'
import NykaaForm from './nykaa/ClaimForm'
import ShopifyForm from './shopify/ClaimForm'
import SnapdealForm from './snapdeal/ClaimForm'
import TataCliqForm from './tatacliq/ClaimForm'
import XbeesForm from './xbees/ClaimForm'

/**
 * The ONE platform → code map for Create Claim.
 *
 * Adding a marketplace is one folder under `platforms/` and one entry here.
 * Nothing else may branch on a platform name: a `switch` or an
 * `if (platform === 'nykaa')` in a shared file is a structural bug, and it is
 * the reason the page's extra header selects — Delhivery's freight lane,
 * Flipkart's claim area, Amazon's fulfilment channel — are DESCRIBED here as
 * data rather than rendered by a conditional on the page.
 *
 * The cascade labels work the same way. Four marketplaces ask the same two
 * questions in their own vocabulary ("Issue Area" / "Reason Of QC Failure" /
 * "Dispute Reason"), and storage is identical for all of them — parent into
 * `otherClaimDetails.parentSelection`, child into `typeOfClaim`. Only the words
 * differ, so only the words live here.
 */

export type PlatformKey =
  | 'ajio'
  | 'meesho'
  | 'myntra'
  | 'snapdeal'
  | 'nykaa'
  | 'amazon'
  | 'shopify'
  | 'flipkart'
  | 'tataCliq'
  | 'delhivery'
  | 'xbees'

/** One extra control the page renders in its header row, before Type Of Claim. */
export interface HeaderField {
  /** Dotted path into the form's values. */
  path: string
  label: string
  placeholder: string
  /** A fixed set to choose from, or `undefined` for a read-only display field. */
  options?: readonly string[]
  /**
   * Options that depend on the seller account picked on the form, when it has
   * some — `null` falls back to `options`. Delhivery's Domestic is the only
   * one: each login has its own list, synced after its session update.
   */
  optionsForAccount?: (catalogue: { delhiveryDomestics: Record<string, string[]> }, username: string) => readonly string[] | null
  /**
   * Shown but not editable, and stamped onto the form on mount. Delhivery's
   * shipment issue is the only one: the value is fixed, and it is still
   * persisted so downstream automation has an explicit signal rather than
   * having to infer it from the platform name.
   */
  fixedValue?: string
  /**
   * Where this control sits in the header row.
   *
   * Before the cascade dropdowns by default. Delhivery's shipment issue and
   * subcategory come AFTER them, which is the order its own portal asks in and
   * the order the web form renders.
   */
  position?: 'before-cascade' | 'after-cascade'
}

/** How a platform words the two cascade dropdowns. */
export interface CascadeLabels {
  parentLabel: string
  parentPlaceholder: string
  childLabel: string
  childPlaceholder: string
}

const DEFAULT_CASCADE: CascadeLabels = {
  parentLabel: 'Issue Area of Affected Item',
  parentPlaceholder: 'Select Issue Area',
  childLabel: 'Type Of Claim',
  childPlaceholder: 'Select Type Of Claim'
}

export interface PlatformDescriptor {
  key: PlatformKey
  /** What the operator sees, and what the backend stores. */
  label: string
  /** The dot beside the name when no logo is available. */
  dot: string
  Form: ComponentType<any>
  /** Rendered before Type Of Claim, in order. */
  headerFields: readonly HeaderField[]
  /** Only when this platform words the cascade its own way. */
  cascade: CascadeLabels
  /**
   * Does the six-side grid become a PDF for this platform?
   *
   * False wherever the platform carries its evidence in its own slots instead —
   * Flipkart, Amazon, Tata CliQ, Delhivery and Xbees in `otherClaimDetails`,
   * Meesho and Snapdeal as named top-level images, Myntra in its own bundle.
   */
  requiresSixSidePdf: boolean
  /**
   * TEMPORARY. File the fixed placeholder as the six-side PDF instead of
   * building one from the grid: no image count, and no image is downloaded, so
   * a missing VMS screenshot cannot stop the claim. Meaningful only with
   * `requiresSixSidePdf`. See `placeholderSixSidePdf`.
   */
  sixSidePlaceholderPdf: boolean
  /** The rules a claim on this platform must satisfy before it can be saved. */
  validate: (skus: string[]) => Validator
  /** Which fields `/cms/createCMS` will accept from this platform. */
  createFields: ReadonlySet<string>
  /**
   * The JSON envelope this platform's extra fields travel in on create, if any.
   *
   * Nykaa and Myntra have one each; five marketplaces share `other`. A platform
   * with none — AJIO, Shopify, a company's own — sends flat fields only.
   */
  bundle: 'myntra' | 'nykaa' | 'other' | null
  /**
   * Where the seller account lives in the form's values.
   *
   * Null where the platform has no per-row account. `/cms/updateCMS` takes a
   * single `username` plus `eCommercePlatform` and routes it into the right
   * slot itself, so this is the one place that knows which slot that is.
   */
  accountPath: string | null
  /**
   * May the submit fill the account in when the company has exactly one?
   *
   * True nearly everywhere: one login means there is no ambiguity to resolve,
   * and settling it at payload-build time is what stops an effect from clearing
   * the account under a field that shows one. False for Nykaa — its runner
   * files every claim under the company's verified credential, so the field is
   * a record of what happened rather than an instruction.
   */
  autoSelectSoleAccount: boolean
  /** This platform's contribution to the update body. */
  buildUpdate: UpdateBuilder
  /** Is `pobId` meaningful here? AJIO alone. */
  sendsPobId: boolean
  /**
   * How a spreadsheet row becomes this platform's claim in Normal Bulk Claim —
   * its extra columns, where its VMS screenshots go, what else it looks up.
   */
  bulk: BulkSpec
}

const descriptor = (
  entry: Pick<PlatformDescriptor, 'key' | 'label' | 'dot' | 'Form'> &
    Partial<PlatformDescriptor>
): PlatformDescriptor => ({
  headerFields: [],
  cascade: DEFAULT_CASCADE,
  requiresSixSidePdf: true,
  sixSidePlaceholderPdf: false,
  validate: commonValidation,
  createFields: COMMON_CREATE_FIELDS,
  bundle: null,
  accountPath: 'otherClaimDetails.username',
  autoSelectSoleAccount: true,
  buildUpdate: noUpdateFields,
  sendsPobId: false,
  bulk: DEFAULT_BULK,
  ...entry
})

export const PLATFORMS: readonly PlatformDescriptor[] = [
  descriptor({
    key: 'ajio',
    label: 'AJIO',
    dot: '#0088A3',
    Form: AjioForm,
    accountPath: 'ajio_account_email',
    buildUpdate: ajioUpdate,
    sendsPobId: true,
    bulk: ajioBulk
  }),
  descriptor({
    key: 'meesho',
    label: 'Meesho',
    dot: '#F43F5E',
    Form: MeeshoForm,
    requiresSixSidePdf: false,
    validate: () => meeshoValidation,
    createFields: MEESHO_CREATE_FIELDS,
    accountPath: 'meesho_account_email',
    buildUpdate: meeshoUpdate,
    bulk: meeshoBulk
  }),
  descriptor({
    key: 'myntra',
    label: 'Myntra',
    dot: '#D946EF',
    Form: MyntraForm,
    requiresSixSidePdf: false,
    validate: () => myntraValidation,
    createFields: MYNTRA_CREATE_FIELDS,
    bundle: 'myntra',
    accountPath: 'myntraClaimDetails.username',
    buildUpdate: myntraUpdate,
    bulk: myntraBulk
  }),
  descriptor({
    key: 'snapdeal',
    label: 'Snapdeal',
    dot: '#E11D48',
    Form: SnapdealForm,
    requiresSixSidePdf: false,
    validate: () => snapdealValidation,
    createFields: SNAPDEAL_CREATE_FIELDS,
    accountPath: 'snapdeal_account_username',
    buildUpdate: snapdealUpdate,
    bulk: snapdealBulk
  }),
  descriptor({
    key: 'nykaa',
    label: 'Nykaa Fashion',
    dot: '#EC4899',
    Form: NykaaForm,
    sixSidePlaceholderPdf: true,
    validate: nykaaValidation,
    bundle: 'nykaa',
    accountPath: 'nykaaClaimDetails.username',
    // The runner files every Nykaa claim under the company's verified
    // credential regardless, so the form records the account rather than
    // choosing it.
    autoSelectSoleAccount: false,
    buildUpdate: nykaaUpdate,
    bulk: nykaaBulk
  }),
  descriptor({
    key: 'amazon',
    label: 'Amazon',
    dot: '#F59E0B',
    Form: AmazonForm,
    requiresSixSidePdf: false,
    validate: amazonValidation,
    bundle: 'other',
    buildUpdate: amazonUpdate,
    bulk: amazonBulk,
    headerFields: [
      {
        path: 'otherClaimDetails.fulfillmentChannel',
        label: 'Select Fulfillment Channel',
        placeholder: 'Select Fulfillment Channel',
        options: AMAZON_FULFILLMENT_CHANNEL_OPTIONS
      }
    ],
    // Amazon inverts the label semantics: the parent dropdown is titled "Type
    // Of Claim" and the child becomes "Claim Sub-Reason". Storage is unchanged.
    cascade: {
      parentLabel: 'Type Of Claim',
      parentPlaceholder: 'Select Type Of Claim',
      childLabel: 'Claim Sub-Reason',
      childPlaceholder: 'Select Claim Sub-Reason'
    }
  }),
  descriptor({
    key: 'shopify',
    label: 'Shopify',
    dot: '#16A34A',
    Form: ShopifyForm,
    // No seller portal, so no account to file under.
    accountPath: null,
    autoSelectSoleAccount: false
  }),
  descriptor({
    key: 'flipkart',
    label: 'Flipkart',
    dot: '#2874F0',
    Form: FlipkartForm,
    requiresSixSidePdf: false,
    validate: flipkartValidation,
    createFields: FLIPKART_CREATE_FIELDS,
    bundle: 'other',
    buildUpdate: flipkartUpdate,
    bulk: flipkartBulk,
    headerFields: [
      {
        path: 'otherClaimDetails.claimArea',
        label: 'Claim Area',
        placeholder: 'Select Claim Area',
        options: FLIPKART_CLAIM_AREA_OPTIONS
      }
    ]
  }),
  descriptor({
    key: 'tataCliq',
    label: 'Tata CliQ',
    dot: '#663399',
    Form: TataCliqForm,
    requiresSixSidePdf: false,
    validate: tataCliqValidation,
    bundle: 'other',
    buildUpdate: tataCliqUpdate,
    bulk: tataCliqBulk,
    cascade: {
      parentLabel: 'Reason Of QC Failure',
      parentPlaceholder: 'Select Reason Of QC Failure',
      childLabel: 'Sub Reason Of Failure',
      childPlaceholder: 'Select Sub Reason Of Failure'
    }
  }),
  descriptor({
    key: 'delhivery',
    label: 'Delhivery',
    dot: '#E31E24',
    Form: DelhiveryForm,
    requiresSixSidePdf: false,
    validate: delhiveryValidation,
    bundle: 'other',
    buildUpdate: delhiveryUpdate,
    bulk: delhiveryBulk,
    headerFields: [
      {
        path: 'otherClaimDetails.domestic',
        label: 'Domestic',
        placeholder: 'Select Domestic',
        // Until the login's own list has been synced.
        options: DELHIVERY_DOMESTIC_OPTIONS,
        optionsForAccount: (catalogue, username) =>
          catalogue.delhiveryDomestics[username.trim().toLowerCase()] ?? null
      },
      {
        path: 'otherClaimDetails.shipmentIssue',
        label: 'Shipment Issue',
        placeholder: DELHIVERY_SHIPMENT_ISSUE,
        fixedValue: DELHIVERY_SHIPMENT_ISSUE,
        position: 'after-cascade'
      },
      {
        path: 'otherClaimDetails.subcategory',
        label: 'Select a subcategory',
        placeholder: 'Select a subcategory',
        options: DELHIVERY_SUBCATEGORY_OPTIONS,
        position: 'after-cascade'
      }
    ]
  }),
  descriptor({
    key: 'xbees',
    label: 'Xbees',
    dot: '#0E7C86',
    Form: XbeesForm,
    requiresSixSidePdf: false,
    validate: xbeesValidation,
    bundle: 'other',
    buildUpdate: xbeesUpdate,
    bulk: xbeesBulk,
    cascade: {
      parentLabel: 'Dispute Reason',
      parentPlaceholder: 'Select Dispute Reason',
      childLabel: 'Dispute Sub reason',
      childPlaceholder: 'Select Dispute Sub reason'
    }
  })
]

/**
 * A company's own platform — D2C, a marketplace someone added on Integrations.
 *
 * It files through the default form, because that is the layout every platform
 * without a dedicated one uses. It does NOT inherit AJIO's payload rules, which
 * is the whole reason this is separate from the AJIO entry: a custom platform
 * has no POB, no `ajio_account_email` slot, and a claim that posted one would
 * be a claim carrying a field its create branch has never seen.
 */
const CUSTOM: PlatformDescriptor = descriptor({
  key: 'ajio',
  label: 'Custom',
  dot: '#8B5CF6',
  Form: AjioForm,
  accountPath: null,
  autoSelectSoleAccount: false
})

/**
 * LOWER-CASED, both maps.
 *
 * `tataCliq` is the only key with a capital in it, and looking it up by a
 * lower-cased needle missed — so Tata CliQ resolved to the custom fallback:
 * the default form instead of its QC form, no bundle, and an update that sent
 * none of the fields the marketplace acts on. Nothing errored.
 */
const BY_KEY = new Map<string, PlatformDescriptor>(
  PLATFORMS.map((entry) => [entry.key.toLowerCase(), entry])
)
const BY_LABEL = new Map<string, PlatformDescriptor>(
  PLATFORMS.map((entry) => [entry.label.toLowerCase(), entry])
)

/**
 * The descriptor for a platform named either way — by key or by label.
 *
 * Falls back to `CUSTOM` — the default form with none of AJIO's payload rules
 * — so a company's own platform renders and files without borrowing fields
 * that belong to a marketplace it is not.
 */
export const platformDescriptor = (name: string | undefined): PlatformDescriptor => {
  const needle = (name ?? '').trim().toLowerCase()

  return BY_KEY.get(needle) ?? BY_LABEL.get(needle) ?? CUSTOM
}

/**
 * What to call a platform on screen.
 *
 * The registry's label where the name is one we know — which is how "Nykaa"
 * reaches an operator as "Nykaa Fashion", the name the seller portal uses — and
 * the stored name unchanged where it is not. A company's own platform is
 * called whatever the company called it.
 */
export const platformDisplayName = (name: string | null | undefined): string => {
  const raw = (name ?? '').trim()

  if (!raw) return ''

  const needle = raw.toLowerCase()

  return (BY_KEY.get(needle) ?? BY_LABEL.get(needle))?.label ?? raw
}

export const resolvePlatformKey = (label: string | undefined): PlatformKey => {
  const needle = (label ?? '').trim().toLowerCase()
  const found = BY_KEY.get(needle) ?? BY_LABEL.get(needle)

  return found?.key ?? 'ajio'
}
