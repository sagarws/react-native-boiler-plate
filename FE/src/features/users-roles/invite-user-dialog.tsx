"use client";

import { useState, type FormEvent } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { SelectField, TextField } from "@/components/ui/form-field";
import { errorMessage, toast } from "@/lib/events";
import { ManageUserService } from "@/services/manage-user-service";
import { INVITATION_STATUS, type ICompanyUser, type IRole } from "@/types/users-roles";
import { formatPermissionName } from "@/features/users-roles/permission-logic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Values {
  email: string;
  role: string;
}

/** TrackVid `sendInvitationValidation`. */
function validate(v: Values): Partial<Record<keyof Values, string>> {
  const errors: Partial<Record<keyof Values, string>> = {};
  if (!v.email.trim()) errors.email = "Email is required";
  else if (!EMAIL_RE.test(v.email.trim())) errors.email = "Enter a valid email";
  if (!v.role) errors.role = "Role is required";
  return errors;
}

/** TrackVid `InviteUserModal`: invite a new team member, or change an existing member's role. */
export function InviteUserDialog({
  user,
  roles,
  rolesLoading,
  onClose,
  onSaved,
}: {
  user: ICompanyUser | null;
  roles: readonly IRole[];
  rolesLoading: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(user);
  const [values, setValues] = useState<Values>({ email: user?.email ?? "", role: user?.role?._id ?? "" });
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const errors = validate(values);
  const show = (k: keyof Values) => (touched[k] ? errors[k] : undefined);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched({ email: true, role: true });
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const payload = { email: values.email.trim(), role: values.role };
      const res = user ? await ManageUserService.updateDataUser({ ...payload, _id: user._id }, user._id) : await ManageUserService.createUser(payload);
      toast.success(res.message);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppDialog
      size="sm"
      locked={saving}
      onClose={onClose}
      title={
        <span className="tv-ur-dialog-title">
          {isEdit ? "Edit User" : "Add User"}
          <small>{isEdit ? "Update user role and access" : "Send an invitation to join your team"}</small>
        </span>
      }
    >
      <form className="c-form-grid" onSubmit={submit} noValidate>
        <TextField
          label="Email"
          type="email"
          full
          required
          autoComplete="off"
          value={values.email}
          disabled={user?.status === INVITATION_STATUS.ACCEPTED}
          hint={user?.status === INVITATION_STATUS.ACCEPTED ? "This member has accepted the invitation; the email cannot change." : undefined}
          error={show("email")}
          onChange={(e) => {
            const email = e.currentTarget.value;
            setValues((v) => ({ ...v, email }));
          }}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
        />
        <SelectField
          label="Select Role"
          full
          required
          value={values.role}
          placeholder={rolesLoading ? "Loading roles…" : "Select Role"}
          options={roles.map((r) => ({ value: r._id, label: formatPermissionName(r.name) }))}
          error={show("role")}
          onChange={(e) => {
            const role = e.currentTarget.value;
            setValues((v) => ({ ...v, role }));
            setTouched((t) => ({ ...t, role: true }));
          }}
          onBlur={() => setTouched((t) => ({ ...t, role: true }))}
        />
        <div className="tv-dialog-footer span-full">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {isEdit ? "Save Changes" : "Send Invite"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
