/**
 * The extra fields a marketplace login carries, per platform — what the Add
 * login form asks for beside the username and password.
 *
 * MIRRORS the admin panel (TrackVid-FE, Integrations → EcommerceAccountsSettings
 * `PROVIDER_CONFIGS`), so a login added here is stored with the same fields as
 * one added there:
 *
 *   AJIO      account type   VMS | API
 *   Myntra    account type   FBM | SJIT | PPMP | MDIRECT
 *   Meesho    callback number — Meesho's ticket form refuses a claim without it
 *   Nykaa     vendor code
 *   Tata CliQ Cloudflare Access email — optional; the seller zone is sometimes
 *             behind Cloudflare Access, which mails a code to this inbox
 *
 * A platform with no entry needs nothing more. Every field shown is required
 * except the Cloudflare email (empty uses the default inbox), and the account
 * type is never pre-selected — see AddCredentialModal.
 */
export interface CredentialFieldSpec {
  accountTypes?: readonly { value: string; label: string }[]
  defaultAccountType?: string
  phoneNumber?: { label: string }
  vendorCode?: { label: string }
  /** An inbox, no password. Optional — empty means the automation's default inbox. */
  cloudflareEmail?: { label: string; placeholder: string }
}

export const CREDENTIAL_FIELDS: Record<string, CredentialFieldSpec> = {
  ajio: {
    accountTypes: [
      { value: 'VMS', label: 'VMS' },
      { value: 'API', label: 'API' }
    ],
    defaultAccountType: 'VMS'
  },
  myntra: {
    accountTypes: [
      { value: 'FBM', label: 'FBM' },
      { value: 'SJIT', label: 'SJIT (Seller Inv. in WH)' },
      { value: 'PPMP', label: 'PPMP' },
      { value: 'MDIRECT', label: 'MDIRECT' }
    ],
    defaultAccountType: 'FBM'
  },
  meesho: { phoneNumber: { label: 'Callback number' } },
  nykaa: { vendorCode: { label: 'Vendor code' } },
  tatacliq: { cloudflareEmail: { label: 'Cloudflare Access email', placeholder: 'jyothi@wrogn.com' } }
}

export const credentialFieldsFor = (platform: string): CredentialFieldSpec =>
  CREDENTIAL_FIELDS[platform.trim().toLowerCase()] ?? {}
