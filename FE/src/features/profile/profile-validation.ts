import type { ICreateBillingProfile } from "@/services/user-service";
import type { IChangePasswordForm, IProfile } from "@/types/profile";

/** Plain-TS ports of TrackVid's yup schemas (`userProfileValidation`, `changePasswordValidation`, billing profile). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GST_RE = /^([0][1-9]|[1-2][0-9]|[3][0-7])([a-zA-Z]{5}[0-9]{4}[a-zA-Z]{1}[1-9a-zA-Z]{1}[zZ]{1}[0-9a-zA-Z]{1})+$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[0-9])(?=.*[-!@#$%^&*])(?=.{8,})/;

export type ProfileField = "firstName" | "lastName" | "email" | "phone" | "companyName" | "gst";
export type ProfileErrors = Partial<Record<ProfileField, string>>;

export function validateProfile(v: IProfile, includeCompany: boolean): ProfileErrors {
  const e: ProfileErrors = {};
  if (!v.name.firstName.trim()) e.firstName = "First Name is required";
  if (!v.name.lastName.trim()) e.lastName = "Last Name is required";
  if (!v.email.trim()) e.email = "Email is required";
  else if (!EMAIL_RE.test(v.email.trim())) e.email = "Enter a valid email";
  if (!v.phone.code || !v.phone.countryCode) e.phone = "Code is required";
  else if (!v.phone.number.trim()) e.phone = "Number is required";
  if (includeCompany) {
    if (!v.company.name.trim()) e.companyName = "Company Name is required.";
    const gst = v.company.gst_number.trim();
    if (gst) {
      if (gst.length !== 15) e.gst = "GST number must be 15 characters";
      else if (!GST_RE.test(gst)) e.gst = "Invalid GST number.";
    }
  }
  return e;
}

export type PasswordErrors = Partial<Record<keyof IChangePasswordForm, string>>;

export function validatePassword(v: IChangePasswordForm): PasswordErrors {
  const e: PasswordErrors = {};
  const current = v.currentPassword.trim();
  const next = v.newPassword.trim();
  const confirm = v.confirmNewPassword.trim();
  if (!current) e.currentPassword = "Current password is required";
  if (!next) e.newPassword = "New password is required";
  else if (!PASSWORD_RE.test(next)) e.newPassword = "Must Contain 8 Characters, One Lowercase, One Number and One Special Case Character";
  else if (next === current) e.newPassword = "New password must be different from current password";
  if (!confirm) e.confirmNewPassword = "Confirm new password is required";
  else if (confirm !== next) e.confirmNewPassword = "Passwords must match";
  return e;
}

export type BillingErrors = Partial<Record<keyof ICreateBillingProfile, string>>;

export function validateBilling(v: ICreateBillingProfile): BillingErrors {
  const e: BillingErrors = {};
  if (!v.billing_name.trim()) e.billing_name = "Company Name is required";
  if (!v.billing_email.trim()) e.billing_email = "Email is required";
  else if (!EMAIL_RE.test(v.billing_email.trim())) e.billing_email = "Invalid email address";
  if (!v.billing_phone.trim()) e.billing_phone = "Phone is required";
  const gst = v.gst_number.trim();
  if (gst) {
    if (gst.length !== 15) e.gst_number = "GST number must be at least 15 characters";
    else if (!GST_RE.test(gst)) e.gst_number = "Invalid GST number.";
  }
  if (!v.address_line_1.trim()) e.address_line_1 = "Address Line 1 is required";
  if (!v.city.trim()) e.city = "City is required";
  if (!v.state.trim()) e.state = "State is required";
  if (!v.country.trim()) e.country = "Country is required";
  if (!v.pincode.trim()) e.pincode = "Pin Code is required";
  return e;
}
