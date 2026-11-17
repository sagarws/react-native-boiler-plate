import type { ECommercePlatform } from "@/types/platform";

/** Types for the /settings route. Copied from TrackVid-FE `helper/types/types.ts` and `IntegrationsSettings.tsx`. */

export interface backupDurationRates {
  days: number;
  credits: number;
}

export interface videoSizeRates {
  videoSize: number;
  credits: number;
}

/** Canonical key of the QC-reason column in the Increff mapping (matches the BE payload, space included). */
export const QC_REASON_KEY = "QC Reason";

/** One row of the Increff QC mapping: `{ "QC Reason": "...", <platform>: "<claim type>" }`. */
export type IncreffQcMappingEntry = Record<string, string>;

/** `GET /app-settings/get-app-setting-for-admin` → `data`. */
export interface IAppSetting {
  backupDurationRates: backupDurationRates[];
  videoSizeRates: videoSizeRates[];
  cmsCredits: number;
  vmsCredits: number;
  increffQcMapping?: IncreffQcMappingEntry[];
  /** Per-platform SPF-claim TAT (days), keyed by BE platform slug. */
  spfClaimTatPeriod?: Record<string, number>;
}

/** `GET /app-settings/claim-types` → `data`. */
export interface IClaimTypes {
  eCommercePlatform: ECommercePlatform[];
}

/** Settings route tabs (TrackVid `pages/Settings.tsx` `TabValue`). */
export type SettingsTab = "video_settings" | "ecommerce_settings" | "integrations" | "increff_qc_mapping";

// ---------- template automation (`/templates`) ----------

export type TemplateStatus = "active" | "inactive";

export type TemplateProvider =
  | "ajio"
  | "amazon"
  | "flipkart"
  | "myntra"
  | "nykaa"
  | "limeroad"
  | "meesho"
  | "snapdeal"
  | "tata cliq"
  | "other";

export interface TemplateRecord {
  _id: string;
  name: string;
  subject: string;
  body: string;
  provider: string;
  status: TemplateStatus;
  variables?: string[];
  updatedAt: string;
  isDefault?: boolean;
}

export interface TemplatePreview {
  templateId: string;
  provider: string;
  subject: string;
  body: string;
  resolvedSubject: string;
  resolvedBodyText: string;
  resolvedBodyHtml: string;
  variables: string[];
}

export interface TemplateDefaults {
  name: string;
  subject: string;
  body: string;
  variables?: string[];
}

export interface ListTemplatesParams {
  provider?: string;
}

export interface SaveTemplatePayload {
  _id?: string;
  name: string;
  subject?: string;
  body: string;
  status?: TemplateStatus;
  provider?: string;
  variables?: string[];
  isDefault?: boolean;
}

export interface ListTemplatesResponse {
  templates: TemplateRecord[];
}

export interface TemplateResponse {
  template: TemplateRecord;
}

export interface DefaultTemplateResponse {
  defaults?: TemplateDefaults;
  template?: TemplateRecord;
}

export interface PreviewTemplateResponse {
  preview: TemplatePreview;
}

/** The template form on the "AJIO Email Auto Reply" tab. */
export interface TemplateFormState {
  _id?: string;
  name: string;
  subject: string;
  body: string;
  status: TemplateStatus;
}
