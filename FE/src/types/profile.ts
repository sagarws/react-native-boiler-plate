/** Profile form types (TrackVid-FE `IProfile extends IRegister`). */
import type { IPhone } from "@/types/common";

export interface IProfile {
  name: { firstName: string; lastName: string };
  email: string;
  company: { name: string; gst_number: string };
  phone: IPhone;
  token?: string;
}

export interface IChangePasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}

export type ProfileTabValue = "profile" | "change_password";
