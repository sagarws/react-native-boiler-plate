"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { CardHeading, ToneBadge } from "@/components/ui/card-primitives";
import { TextField } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { PhoneField } from "@/components/ui/phone-field";
import { LoadingState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { errorMessage, toast } from "@/lib/events";
import { canAccess } from "@/lib/permissions";
import { useDispatch, useSelector } from "@/store";
import { setUserProfile } from "@/store/profile-slice";
import { UserService } from "@/services/user-service";
import type { IUser } from "@/types/common";
import type { IProfile, ProfileTabValue } from "@/types/profile";
import { BillingProfiles } from "@/features/profile/billing-profiles";
import { ChangePasswordForm } from "@/features/profile/change-password-form";
import { CompanyLogoUploader } from "@/features/profile/company-logo-uploader";
import { validateProfile, type ProfileField } from "@/features/profile/profile-validation";

function toForm(user: IUser): IProfile {
  return {
    name: { firstName: user.name.firstName ?? "", lastName: user.name.lastName ?? "" },
    email: user.email ?? "",
    company: { name: user.company?.name ?? "", gst_number: user.company?.gst_number ?? "" },
    phone: { code: user.phone?.code || "+91", number: user.phone?.number ?? "", countryCode: user.phone?.countryCode || "IN" },
    token: user.company?.baseLinkToken ?? "",
  };
}

function ProfileForm({ user }: { user: IUser }) {
  const dispatch = useDispatch();
  const hasEditPermission = canAccess(user, ["admin"], ["profile::edit"]);
  const isAdmin = user.role?.name === "admin";

  const initial = toForm(user);
  const signature = JSON.stringify(initial);
  const [values, setValues] = useState<IProfile>(initial);
  const [touched, setTouched] = useState<Partial<Record<ProfileField, boolean>>>({});
  const [saving, setSaving] = useState(false);
  // A new profile from the store (after save, logo upload, or elsewhere) resets the form.
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setValues(initial);
    setTouched({});
  }

  const errors = validateProfile(values, isAdmin);
  const valid = Object.keys(errors).length === 0;
  const dirty = JSON.stringify(values) !== signature;
  const err = (f: ProfileField) => (touched[f] ? errors[f] : undefined);
  const touch = (f: ProfileField) => () => setTouched((t) => ({ ...t, [f]: true }));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched({ firstName: true, lastName: true, email: true, phone: true, companyName: true, gst: true });
    if (!valid || !hasEditPermission) return;
    setSaving(true);
    try {
      const name = { firstName: values.name.firstName.trim(), lastName: values.name.lastName.trim() };
      const phone = { ...values.phone, number: values.phone.number.replace(/\s+/g, "") };
      // TrackVid: admins update the full profile; sub users may only change their name and phone.
      const payload: Partial<IUser> = isAdmin
        ? { name, phone, email: values.email.trim(), company: { ...user.company, name: values.company.name.trim() } }
        : { name, phone };
      const updated = await UserService.updateUser(payload, user._id);
      dispatch(setUserProfile(updated));
      toast.success("User profile updated successfully");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const fullName = `${user.name.firstName ?? ""} ${user.name.lastName ?? ""}`.trim();

  return (
    <div className="profile-layout">
      <aside className="glass-card profile-summary">
        <Avatar name={fullName || user.email} className="profile-portrait" />
        <h2>{fullName || "—"}</h2>
        {user.role?.name ? <ToneBadge label={String(user.role.name).toUpperCase()} tone="info" /> : null}
        <p>{user.email || "—"}</p>
        {user.company?.name ? <small>{user.company.name}</small> : null}
      </aside>

      <div className="tv-stack">
        {/* Billing profiles sit outside this form: their dialog has its own form, and React submit events bubble through portals. */}
        <form className="tv-stack" onSubmit={submit} noValidate>
          <section className="glass-card">
            <CardHeading title="Personal Details" />
            <p className="tv-muted tv-profile-card-intro">Your contact information used across TrackVid.</p>
            <div className="c-form-grid">
              <TextField
                label="First Name"
                required
                value={values.name.firstName}
                disabled={!hasEditPermission}
                error={err("firstName")}
                onChange={(e) => {
                  const firstName = e.currentTarget.value;
                  setValues((v) => ({ ...v, name: { ...v.name, firstName } }));
                }}
                onBlur={touch("firstName")}
              />
              <TextField
                label="Last Name"
                required
                value={values.name.lastName}
                disabled={!hasEditPermission}
                error={err("lastName")}
                onChange={(e) => {
                  const lastName = e.currentTarget.value;
                  setValues((v) => ({ ...v, name: { ...v.name, lastName } }));
                }}
                onBlur={touch("lastName")}
              />
              <TextField label="Email" type="email" value={values.email} disabled error={err("email")} hint="Contact support to change the sign-in email." />
              <PhoneField
                label="Phone"
                required
                value={values.phone}
                disabled={!hasEditPermission}
                error={err("phone")}
                onChange={(phone) => {
                  setValues((v) => ({ ...v, phone }));
                  setTouched((t) => ({ ...t, phone: true }));
                }}
              />
            </div>
          </section>

          {isAdmin ? (
            <section className="glass-card">
              <CardHeading title="Company Details" />
              <p className="tv-muted tv-profile-card-intro">Brand, identity, and integration credentials for your workspace.</p>
              <CompanyLogoUploader user={user} disabled={!hasEditPermission} />
              <div className="c-form-grid">
                <TextField
                  label="Company Name"
                  required
                  placeholder="Company Name"
                  value={values.company.name}
                  disabled={!hasEditPermission}
                  error={err("companyName")}
                  onChange={(e) => {
                    const name = e.currentTarget.value;
                    setValues((v) => ({ ...v, company: { ...v.company, name } }));
                  }}
                  onBlur={touch("companyName")}
                />
                <TextField
                  label="GST Number"
                  placeholder="GST Number"
                  value={values.company.gst_number}
                  disabled
                  error={err("gst")}
                  hint="Verified at sign-up. Contact support to change it."
                />
              </div>
            </section>
          ) : null}

          {hasEditPermission ? (
            <div className="c-form-footer tv-profile-footer">
              <span>{dirty ? "You have unsaved changes." : ""}</span>
              <button
                type="reset"
                className="secondary-button"
                disabled={saving || !dirty}
                onClick={() => {
                  setValues(initial);
                  setTouched({});
                }}
              >
                Discard Changes
              </button>
              <button type="submit" className="primary-button" disabled={saving || !dirty || !valid}>
                {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
                Update Profile
              </button>
            </div>
          ) : null}
        </form>

        {isAdmin ? <BillingProfiles canEdit={hasEditPermission} /> : null}
      </div>
    </div>
  );
}

/** TrackVid `pages/Profile.tsx`: Profile and Change Password tabs (`?tab=change_password` opens the second). */
export function ProfilePage() {
  const user = useSelector((s) => s.profile.userProfile);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: ProfileTabValue = params.get("tab") === "change_password" ? "change_password" : "profile";

  const changeTab = (next: ProfileTabValue) => {
    const query = new URLSearchParams(params.toString());
    if (next === "profile") query.delete("tab");
    else query.set("tab", next);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="tv-page">
      <PageHeading title="Profile" subtitle="Your details, company branding and password." />
      <Tabs<ProfileTabValue>
        label="Profile tabs"
        value={tab}
        onChange={changeTab}
        items={[
          { key: "profile", label: "Profile", icon: "user" },
          { key: "change_password", label: "Change Password", icon: "lock" },
        ]}
      />
      {!user ? <LoadingState label="Loading profile…" /> : tab === "profile" ? <ProfileForm user={user} /> : <ChangePasswordForm />}
    </div>
  );
}
