import type { IPhone, IUser } from "@/types/common";

/** TrackVid-FE `helper/types/types.ts` → ILogin. */
export interface ILogin {
  email: string;
  password: string;
}

/** TrackVid-FE `helper/types/types.ts` → IRegister. */
export interface IRegister {
  name: {
    firstName: string;
    lastName: string;
  };
  email: string;
  password?: string;
  confirmPassword?: string;
  company: {
    companyId?: string;
    fileKey?: string;
    fileName?: string;
    name: string;
    gst_number?: string;
    compressPercentage?: number;
  };
  phone: IPhone;
}

/** TrackVid-FE `helper/types/types.ts` → ISubUseRegister (name kept, typo included). */
export interface ISubUseRegister {
  name: {
    firstName: string;
    lastName: string;
  };
  email?: string;
  password?: string;
  confirmPassword?: string;
  phone: IPhone;
}

/** Body of `POST /auth/add-data-user` (sub-user sign-up from an invitation link). */
export type AddDataUserPayload = ISubUseRegister & { token: string | null };

/** Body of `POST /auth/verify-user` (invitation link). */
export interface VerifyUserPayload {
  token: string | null;
  email: string | null;
}

export interface VerifyUserResponse {
  message: string;
  email: string;
  companyName: string;
  /** Admin invitations go straight to login; sub-users finish sign-up first. */
  isAdmin: boolean;
}

/** `POST /api/user/upload-logo` before registration: creates the company and returns its id. */
export interface UploadLogoResponse {
  _id: string;
  fileKey: string;
  fileName: string;
  url: string;
  message: string;
}

/** `GET /api/system-admin/:userId` (system admin "log in as" a customer). */
export interface ImpersonationResponse {
  accessToken: string;
  user: IUser;
  message: string;
}

/** Query string Zoho sends to `/oauth/zoho/callback`. */
export interface ZohoCallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  location: string | null;
}

/** What the backend callback decides: where to send the browser and with which flags. */
export interface ZohoCallbackResult {
  connected: boolean;
  error: string | null;
  redirectTo: string;
  mailbox: string | null;
}
