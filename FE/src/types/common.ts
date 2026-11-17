/** Shared TrackVid types (same field names as TrackVid-FE `helper/types/types.ts`). */

export type PLAN_TYPE = "CREDIT" | "STORAGE" | "SUBSCRIPTION";

export interface IPlan {
  _id: string;
  name: string;
  type: PLAN_TYPE;
  price: number;
  credit?: number;
  storage?: number;
  bonus?: number;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ICredit {
  _id: string;
  totalCredit: number;
  usedCredit: number;
  remainingCredit: number;
  totalStorage: number;
  usedStorage: number;
  remainingStorage: number;
  companyId: string;
  userId: string;
}

export interface Permission {
  view: boolean;
  edit: boolean;
}

/** Recursive permission tree, e.g. `{ cms: { view, edit }, accounts: { view, edit, plan: { view, edit } } }`. */
export interface PermissionMap {
  [key: string]: boolean | PermissionMap;
}

export interface IEcommerceClaimType {
  name: string;
  description: string;
  key?: string;
  isDisable: boolean;
  parentSelection?: string;
}

export interface IEcommerce {
  _id?: string;
  name: string;
  tatPeriod: number;
  typeOfClaims: IEcommerceClaimType[];
}

export interface IEcommerceLoginInfo {
  eComPlatform: string;
  _id?: string;
  info: { username: string; password: string; is_verified: boolean; vendorCode?: string }[];
}

export interface ICompanySettings {
  isUsingMasterData?: boolean;
  /** Company may create bulk claims from Increff QC reports (TrackVid flag). */
  increffBulkClaim?: boolean;
  cmsAppVersion?: string | null;
  compressPercentage: number;
  backupDuration: number;
  eCommercePlatform: IEcommerce[];
  eCommercePlatformLoginInfo: IEcommerceLoginInfo[];
  increffAllocation?: { _id?: string; platform: string; allowed: boolean }[];
  spfClaimTatPeriod?: Record<string, number>;
  integrationAccess?: Record<string, boolean>;
}

export interface ICompany {
  name: string;
  fileKey: string;
  fileName: string;
  logo?: string;
  gst_number?: string;
  creditPlan: IPlan;
  storagePlan: IPlan;
  creditId: ICredit;
  settings: ICompanySettings;
  baseLinkToken?: string;
}

export interface IUserRole {
  name: string;
  isAdmin?: boolean;
  permission?: PermissionMap;
  _id: string;
}

export interface IPhone {
  code: string;
  number: string;
  countryCode: string;
}

export interface IUser {
  name: { firstName: string; lastName: string };
  email: string;
  company: ICompany;
  phone: IPhone;
  _id: string;
  role: IUserRole;
  status?: string;
  isActive: boolean;
  isDeleted: boolean;
  isEmailVerified: boolean;
  planId: string;
  members: string[];
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export interface IRole {
  _id: string;
  name: string;
  description: string;
  createdBy: string;
  permission: PermissionMap;
  systemKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Standard list response used by paged mock services. */
export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/** Simple `{ message }` response for actions. */
export interface MessageResponse {
  message: string;
}
