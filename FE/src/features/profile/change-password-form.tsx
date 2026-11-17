"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { CardHeading } from "@/components/ui/card-primitives";
import { PasswordField } from "@/components/ui/form-field";
import { errorMessage, toast } from "@/lib/events";
import { AuthService } from "@/services/auth-service";
import type { IChangePasswordForm } from "@/types/profile";
import { validatePassword } from "@/features/profile/profile-validation";

const EMPTY: IChangePasswordForm = { currentPassword: "", newPassword: "", confirmNewPassword: "" };

/** TrackVid Profile "Change Password" tab. */
export function ChangePasswordForm() {
  const [values, setValues] = useState<IChangePasswordForm>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof IChangePasswordForm, boolean>>>({});
  const [saving, setSaving] = useState(false);
  // Re-mounting the fields hides every password again after Discard / success (TrackVid resets visibility).
  const [formKey, setFormKey] = useState(0);
  const errors = validatePassword(values);
  const dirty = values.currentPassword !== "" || values.newPassword !== "" || values.confirmNewPassword !== "";
  const valid = Object.keys(errors).length === 0;

  const reset = () => {
    setValues(EMPTY);
    setTouched({});
    setFormKey((k) => k + 1);
  };

  const field = (key: keyof IChangePasswordForm) => ({
    value: values[key],
    error: touched[key] ? errors[key] : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.currentTarget.value;
      setValues((v) => ({ ...v, [key]: value }));
    },
    onBlur: () => setTouched((t) => ({ ...t, [key]: true })),
  });

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched({ currentPassword: true, newPassword: true, confirmNewPassword: true });
    if (!valid) return;
    setSaving(true);
    try {
      const res = await AuthService.changePassword({ oldPassword: values.currentPassword, newPassword: values.newPassword });
      toast.success(res.message || "Password updated successfully");
      reset();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="glass-card tv-profile-password" onSubmit={submit} noValidate>
      <CardHeading title="Change Password" />
      <p className="tv-muted tv-profile-card-intro">Use a strong password with at least 8 characters, a number, and a special character.</p>
      <div className="c-form-grid" key={formKey}>
        <PasswordField label="Current Password" required full autoComplete="current-password" {...field("currentPassword")} />
        <PasswordField label="New Password" required autoComplete="new-password" {...field("newPassword")} />
        <PasswordField label="Confirm New Password" required autoComplete="new-password" {...field("confirmNewPassword")} />
      </div>
      <div className="c-form-footer">
        <button type="reset" className="secondary-button" onClick={reset} disabled={saving || !dirty}>
          Discard
        </button>
        <button type="submit" className="primary-button" disabled={saving || !dirty || !valid}>
          {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
          Update Password
        </button>
      </div>
    </form>
  );
}
