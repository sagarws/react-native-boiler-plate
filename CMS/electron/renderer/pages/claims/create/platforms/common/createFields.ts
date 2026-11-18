import type { PlatformDescriptor } from '../registry'
import type { ClaimValues } from './payload'

/**
 * A claim's values, as the flat text fields `/cms/createCMS` takes.
 *
 * ONE builder for the form's Save and for Normal Bulk Claim, so a claim filed
 * from a spreadsheet row carries exactly the fields a hand-filed one does.
 *
 * A WHITELIST, and not a courtesy one: `/cms/createCMS` is multipart, and
 * multer rejects the WHOLE request with `MulterError: Unexpected field` when it
 * meets a field it was not configured for. Sending Meesho's `typeOfClaimName`
 * on an AJIO claim does not add a field the server ignores — it loses the
 * claim. The list lives in the platform's folder; see `platforms/registry.ts`.
 *
 * The three bundles travel as JSON, and only on the platform that owns them.
 */
export const buildCreateFields = (
  values: ClaimValues,
  platform: Pick<PlatformDescriptor, 'createFields' | 'bundle' | 'sendsPobId'>
): [string, string][] => {
  const fields: [string, string][] = []
  const allowed = platform.createFields

  for (const [key, value] of Object.entries(values)) {
    if (key === 'myntraClaimDetails') {
      if (platform.bundle === 'myntra') fields.push([key, JSON.stringify(value)])
      continue
    }
    if (key === 'nykaaClaimDetails') {
      if (platform.bundle === 'nykaa') fields.push([key, JSON.stringify(value)])
      continue
    }
    if (key === 'otherClaimDetails') {
      if (platform.bundle === 'other') fields.push([key, JSON.stringify(value)])
      continue
    }
    // POB ID is an AJIO concept; posting it on, say, Flipkart ships a field
    // that platform's create branch has no slot for.
    if (key === 'pobId' && !platform.sendsPobId) continue
    if (!allowed.has(key)) continue
    if (value === '' || value === undefined || value === null) continue
    fields.push([
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean)
    ])
  }

  return fields
}

/**
 * The AWB alone, without the "(…)" the lookup dropdowns append.
 *
 * Master-data suggestions read "1234567890 (Some Brand)", and an operator
 * picking one puts the whole label in the field. The backend matches the
 * number exactly, so a claim filed with the label attached matches nothing.
 */
export const bareAwb = (value: string): string => value.split('(')[0] ?? ''
