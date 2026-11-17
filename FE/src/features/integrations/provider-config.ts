import type { EcomPlatformCode, EcommerceProvider, WhatsAppProvider } from "@/types/integrations";

/** Marketplace settings per provider (TrackVid `EcommerceAccountsSettings` `PROVIDER_CONFIGS`). */
export interface AccountTypeOption {
  value: string;
  label: string;
}

export interface ProviderConfig {
  key: EcommerceProvider;
  label: string;
  /** Name `PlatformLogo` resolves. */
  logo: string;
  eComPlatform: EcomPlatformCode;
  usernameLabel: string;
  emptyText: string;
  showAccountType: boolean;
  accountTypeOptions?: AccountTypeOption[];
  defaultAccountType?: string;
  showVendorCode?: boolean;
  vendorCodeLabel?: string;
  /** Meesho files claims with a callback number and refuses a ticket without one. */
  showPhoneNumber?: boolean;
  phoneNumberLabel?: string;
  /** Tata CLiQ sits behind Cloudflare Access (an inbox, no password). */
  showCloudflareEmail?: boolean;
  cloudflareEmailLabel?: string;
  /** False when the automation never caches a login session for this provider. */
  supportsSession?: boolean;
  /** Card copy on /integrations. */
  cardTitle: string;
  cardDescription: string;
}

const marketplaceCopy = (label: string) =>
  `Configure your ${label} marketplace accounts to manage imports, order data, and claim workflows.`;

export const PROVIDER_CONFIGS: Record<EcommerceProvider, ProviderConfig> = {
  ajio: {
    key: "ajio",
    label: "AJIO",
    logo: "ajio",
    eComPlatform: "AJIO",
    usernameLabel: "AJIO Username/Email",
    emptyText: "No AJIO accounts yet. Click Add Account to connect one.",
    showAccountType: true,
    accountTypeOptions: [
      { value: "VMS", label: "VMS" },
      { value: "API", label: "API" },
    ],
    defaultAccountType: "VMS",
    cardTitle: "AJIO",
    cardDescription: "Configure your AJIO marketplace settings to manage imports, order data, and claim workflows.",
  },
  meesho: {
    key: "meesho",
    label: "Meesho",
    logo: "meesho",
    eComPlatform: "MEESHO",
    usernameLabel: "Meesho Account Email",
    emptyText: "No Meesho accounts yet. Click Add Account to connect one.",
    showAccountType: false,
    showPhoneNumber: true,
    phoneNumberLabel: "Callback Number",
    cardTitle: "Meesho",
    cardDescription: marketplaceCopy("Meesho"),
  },
  snapdeal: {
    key: "snapdeal",
    label: "Snapdeal",
    logo: "snapdeal",
    eComPlatform: "SNAPDEAL",
    usernameLabel: "Snapdeal Account Username",
    emptyText: "No Snapdeal accounts yet. Click Add Account to connect one.",
    showAccountType: false,
    cardTitle: "Snapdeal",
    cardDescription: marketplaceCopy("Snapdeal"),
  },
  myntra: {
    key: "myntra",
    label: "Myntra",
    logo: "myntra",
    eComPlatform: "MYNTRA",
    usernameLabel: "Myntra Account Username",
    emptyText: "No Myntra accounts yet. Click Add Account to connect one.",
    showAccountType: true,
    accountTypeOptions: [
      { value: "FBM", label: "FBM" },
      { value: "SJIT", label: "SJIT (Seller Inv. in WH)" },
      { value: "PPMP", label: "PPMP" },
      { value: "MDIRECT", label: "MDIRECT" },
    ],
    defaultAccountType: "FBM",
    cardTitle: "Myntra",
    cardDescription: marketplaceCopy("Myntra"),
  },
  nykaa: {
    key: "nykaa",
    label: "Nykaa Fashion",
    logo: "nykaa-fashion",
    eComPlatform: "NYKAA",
    usernameLabel: "Nykaa Fashion Account Email",
    emptyText: "No Nykaa Fashion accounts yet. Click Add Account to connect one.",
    showAccountType: false,
    showVendorCode: true,
    vendorCodeLabel: "Vendor Code",
    cardTitle: "Nykaa Fashion",
    cardDescription: marketplaceCopy("Nykaa Fashion"),
  },
  flipkart: {
    key: "flipkart",
    label: "Flipkart",
    logo: "flipkart",
    eComPlatform: "FLIPKART",
    usernameLabel: "Flipkart Seller Username",
    emptyText: "No Flipkart accounts yet. Click Add Account to connect one.",
    showAccountType: false,
    cardTitle: "Flipkart",
    cardDescription: marketplaceCopy("Flipkart"),
  },
  delhivery: {
    key: "delhivery",
    label: "Delhivery",
    logo: "delhivery",
    eComPlatform: "DELHIVERY",
    usernameLabel: "Delhivery Account Email",
    emptyText: "No Delhivery accounts yet. Click Add Account to connect one.",
    showAccountType: false,
    cardTitle: "Delhivery",
    cardDescription: "Configure your Delhivery courier account to enable auto-claim filing, dispute workflows, and evidence uploads.",
  },
  xbees: {
    key: "xbees",
    label: "Xbees",
    logo: "xbees",
    eComPlatform: "XBEES",
    usernameLabel: "Xbees Account Username",
    emptyText: "No Xbees accounts yet. Click Add Account to connect one.",
    showAccountType: false,
    cardTitle: "Xbees",
    cardDescription: "Configure your Xbees seller account to manage disputes, evidence uploads, and claim workflows.",
  },
  tatacliq: {
    key: "tatacliq",
    label: "Tata CLiQ",
    logo: "tata-cliq",
    eComPlatform: "TATACLIQ",
    usernameLabel: "Tata CLiQ Login Id",
    emptyText: "No Tata CLiQ accounts yet. Click Add Account to connect one.",
    showAccountType: false,
    showCloudflareEmail: true,
    cloudflareEmailLabel: "Cloudflare Access email",
    // Save All only verifies the login (it stops at the portal's OTP modal), so no session is minted.
    supportsSession: false,
    cardTitle: "Tata CLiQ",
    cardDescription: "Configure your Tata CLiQ seller accounts to manage imports, order data, and claim workflows.",
  },
};

export const PROVIDER_ORDER: EcommerceProvider[] = ["ajio", "meesho", "snapdeal", "myntra", "nykaa", "flipkart", "delhivery", "xbees", "tatacliq"];

export const WHATSAPP_PROVIDERS: WhatsAppProvider[] = ["mark360", "11za", "kwikengage"];

export const WHATSAPP_LABELS: Record<WhatsAppProvider, string> = { mark360: "Mark360", "11za": "11za", kwikengage: "KwikEngage" };

/** Card order on /integrations (TrackVid shows 11za before Mark360 and KwikEngage). */
export const WHATSAPP_CARD_ORDER: WhatsAppProvider[] = ["11za", "mark360", "kwikengage"];

export const isEcommerceProvider = (v: string | null | undefined): v is EcommerceProvider => !!v && (PROVIDER_ORDER as string[]).includes(v);
export const isWhatsAppProvider = (v: string | null | undefined): v is WhatsAppProvider => !!v && (WHATSAPP_PROVIDERS as string[]).includes(v);

/**
 * `?provider=` slug. Accepts the marketplace names the shell banner lower-cases from the profile
 * ("nykaa fashion", "tata cliq", "ajio dropship" …) as well as the TrackVid keys.
 */
export function normalizeProviderParam(raw: string | null): string | null {
  if (!raw) return null;
  const slug = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = { nykaafashion: "nykaa", expressbees: "xbees", ajiodropship: "ajio", myntrappmp: "myntra" };
  return aliases[slug] ?? slug;
}
