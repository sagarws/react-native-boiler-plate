"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { useSelector } from "@/store";
import { RoleService } from "@/services/role-service";
import type { IRole } from "@/types/users-roles";
import { RoleDialog, type RoleDialogMode } from "@/features/users-roles/role-dialog";
import { RolesTable } from "@/features/users-roles/roles-table";

/** TrackVid `pages/ManageRole.tsx`: roles table with the add / edit / view role dialog. */
export function ManageRolesPage() {
  const me = useSelector((s) => s.profile.userProfile);
  const hasEditPermission = canAccess(me, ["admin"], ["manage_roles::edit"]);
  const roles = useAsync(() => RoleService.getRoles(), []);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: RoleDialogMode; roleId: string | null } | null>(null);

  const q = search.trim().toLowerCase();
  const rows = (roles.data ?? []).filter((r) => !q || r.name.toLowerCase().replace(/_/g, " ").includes(q) || r.description.toLowerCase().includes(q));

  const open = (role: IRole | null, mode: RoleDialogMode) => setDialog({ mode, roleId: role?._id ?? null });

  return (
    <div className="tv-page">
      <PageHeading
        title="Manage Roles"
        subtitle="Roles decide which TrackVid screens a team member can view or edit."
        actions={
          hasEditPermission ? (
            <button type="button" className="primary-button" onClick={() => open(null, "add")}>
              <Icon name="plus" />
              Add Role
            </button>
          ) : null
        }
      />
      <section className="glass-card tv-table-card">
        <div className="c-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search roles" label="Search roles" />
        </div>
        <RolesTable roles={rows} loading={roles.loading} error={roles.error} onRetry={roles.reload} hasEditPermission={hasEditPermission} onOpen={open} />
      </section>
      {dialog ? (
        <RoleDialog mode={dialog.mode} roleId={dialog.roleId} hasEditPermission={hasEditPermission} onClose={() => setDialog(null)} onSaved={roles.reload} />
      ) : null}
    </div>
  );
}
