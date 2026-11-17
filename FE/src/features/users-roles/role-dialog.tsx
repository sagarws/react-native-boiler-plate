"use client";

import { useState, type FormEvent } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { TextField, TextareaField } from "@/components/ui/form-field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { PERMISSIONS } from "@/config/constant";
import { RoleService } from "@/services/role-service";
import type { IRole, PermissionMap } from "@/types/users-roles";
import { PermissionMatrix } from "@/features/users-roles/permission-matrix";
import { withAllModules } from "@/features/users-roles/permission-logic";

export type RoleDialogMode = "add" | "edit" | "view";

const TITLES: Record<RoleDialogMode, string> = { add: "Add Role", edit: "Edit Role", view: "View Role" };
const SUBTITLES: Record<RoleDialogMode, string> = {
  add: "Define a new role and its access permissions",
  edit: "Update role details and permissions",
  view: "Inspect role permissions",
};

function RoleForm({
  mode,
  role,
  hasEditPermission,
  onClose,
  onSaved,
}: {
  mode: RoleDialogMode;
  role: IRole | null;
  hasEditPermission: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Built-in roles (e.g. "Video Link Viewer") are fixed by TrackVid; the BE refuses to update them.
  const isSystemRole = Boolean(role?.systemKey);
  const canEdit = hasEditPermission && !isSystemRole && mode !== "view";
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permission, setPermission] = useState<PermissionMap>(() => withAllModules(role?.permission ?? PERMISSIONS));
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canEdit) return;
    if (!name.trim()) {
      setNameError("Role name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim(), description, permission };
      const res = role ? await RoleService.updateRole(payload, role._id) : await RoleService.createRole(payload);
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
    <form id="tv-role-form" className="tv-stack" onSubmit={submit} noValidate>
      {isSystemRole ? (
        <Banner tone="info" title="Built-in role">
          This role is managed by TrackVid and cannot be changed.
        </Banner>
      ) : null}
      <section>
        <h3 className="tv-ur-section-label">Role Details</h3>
        <div className="c-form-grid">
          <TextField
            label="Role Name"
            required
            full
            placeholder="e.g. Operations Manager"
            value={name}
            maxLength={60}
            disabled={!canEdit}
            error={nameError}
            onChange={(e) => {
              setName(e.currentTarget.value);
              if (nameError) setNameError(null);
            }}
          />
          <TextareaField
            label="Role Description"
            rows={2}
            placeholder="Brief description of what this role can do"
            value={description}
            maxLength={250}
            disabled={!canEdit}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
        </div>
      </section>
      <section>
        <h3 className="tv-ur-section-label">Permissions</h3>
        <PermissionMatrix permissions={permission} onChange={setPermission} readOnly={!canEdit} />
      </section>
      {canEdit ? (
        <div className="tv-dialog-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {mode === "edit" ? "Save Changes" : "Add Role"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

/** TrackVid `AddEditRoleModal`: role name, description and the permission matrix. */
export function RoleDialog({
  mode,
  roleId,
  hasEditPermission,
  onClose,
  onSaved,
}: {
  mode: RoleDialogMode;
  roleId: string | null;
  hasEditPermission: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, loading, error, reload } = useAsync(() => (roleId ? RoleService.getRoleById(roleId) : Promise.resolve(null)), [roleId]);

  return (
    <AppDialog
      size="xl"
      onClose={onClose}
      title={
        <span className="tv-ur-dialog-title">
          {TITLES[mode]}
          <small>{SUBTITLES[mode]}</small>
        </span>
      }
    >
      {loading ? (
        <LoadingState label="Loading role…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <RoleForm mode={mode} role={data} hasEditPermission={hasEditPermission} onClose={onClose} onSaved={onSaved} />
      )}
    </AppDialog>
  );
}
