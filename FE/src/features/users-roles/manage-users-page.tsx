"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BulkSelectionBar, DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect, SearchInput } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { errorMessage, toast } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { useSelector } from "@/store";
import { AuthService } from "@/services/auth-service";
import { ManageUserService } from "@/services/manage-user-service";
import { RoleService } from "@/services/role-service";
import { INVITATION_STATUS, type ICompanyUser, type IRole, type InvitationStatus } from "@/types/users-roles";
import { InviteUserDialog } from "@/features/users-roles/invite-user-dialog";
import { formatPermissionName } from "@/features/users-roles/permission-logic";
import { RoleDialog, type RoleDialogMode } from "@/features/users-roles/role-dialog";
import { RolesTable } from "@/features/users-roles/roles-table";

type TabValue = "users" | "roles";

const STATUS_TONE: Record<InvitationStatus, StatusTone> = { Accepted: "green", Pending: "amber", Rejected: "red" };

type Confirm =
  | { kind: "resend"; emails: string[] }
  | { kind: "delete"; users: ICompanyUser[] };

/** TrackVid `pages/ManageUser.tsx`: Team Members and Roles tabs. */
export function ManageUsersPage() {
  const me = useSelector((s) => s.profile.userProfile);
  const canEditUsers = canAccess(me, ["admin"], ["manage_users::edit"]);
  const canEditRoles = canAccess(me, ["admin"], ["manage_roles::edit"]);

  const [tab, setTab] = useState<TabValue>("users");
  const users = useAsync(() => ManageUserService.getCompanyUsers(), []);
  const roles = useAsync(() => RoleService.getRoles(), []);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [userDialog, setUserDialog] = useState<{ user: ICompanyUser | null } | null>(null);
  const [roleDialog, setRoleDialog] = useState<{ mode: RoleDialogMode; roleId: string | null } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  const allUsers = users.data ?? [];
  const roleList = roles.data ?? [];
  const q = search.trim().toLowerCase();
  const visibleUsers = allUsers.filter(
    (u) => (!status || u.status === status) && (!q || u.email.toLowerCase().includes(q) || (u.role?.name ?? "").toLowerCase().includes(q)),
  );
  const selectedUsers = allUsers.filter((u) => selected.has(u._id));
  const pendingSelected = selectedUsers.filter((u) => u.status !== INVITATION_STATUS.ACCEPTED);

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "resend") {
        const results = await Promise.all(confirm.emails.map((email) => AuthService.reSendInvitation({ email })));
        toast.success(results.length === 1 ? results[0].message : `Invitation sent again to ${results.length} users.`);
      } else {
        const res = await ManageUserService.deleteCompanyUsers({ id: confirm.users.map((u) => u._id) });
        toast.success(res.message);
        setSelected(new Set());
        users.reload();
      }
      setConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const userColumns: DataColumn<ICompanyUser>[] = [
    {
      key: "email",
      header: "Email",
      minWidth: 220,
      sortable: true,
      render: (u) => (
        <span className="tv-ur-user">
          <strong>{u.email}</strong>
          {u.name ? <small className="tv-muted">{`${u.name.firstName} ${u.name.lastName}`}</small> : null}
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      minWidth: 150,
      sortable: true,
      sortValue: (u) => u.role?.name ?? "",
      render: (u) => (u.role ? formatPermissionName(u.role.name) : "—"),
    },
    {
      key: "status",
      header: "Invitation Status",
      width: 170,
      sortable: true,
      render: (u) => <StatusPill value={u.status} tone={STATUS_TONE[u.status]} />,
    },
    { key: "createdAt", header: "Invited On", width: 140, sortable: true, render: (u) => formatDate(u.createdAt) },
    {
      key: "actions",
      header: "Actions",
      width: 90,
      align: "right",
      render: (u) => (
        <RowActionsMenu
          label={`Actions for ${u.email}`}
          actions={[
            {
              label: "Resend Invitation",
              icon: "paper-plane",
              disabled: u.status === INVITATION_STATUS.ACCEPTED,
              onClick: () => setConfirm({ kind: "resend", emails: [u.email] }),
            },
            { label: "Edit User", icon: "pencil", hidden: !canEditUsers, onClick: () => setUserDialog({ user: u }) },
            {
              label: "Delete User",
              icon: "trash",
              danger: true,
              separatorBefore: true,
              hidden: !canEditUsers,
              onClick: () => setConfirm({ kind: "delete", users: [u] }),
            },
          ]}
        />
      ),
    },
  ];

  const openRole = (role: IRole | null, mode: RoleDialogMode) => setRoleDialog({ mode, roleId: role?._id ?? null });

  const headerAction =
    tab === "users" ? (
      canEditUsers ? (
        <button type="button" className="primary-button" onClick={() => setUserDialog({ user: null })}>
          <Icon name="paper-plane" />
          Add User
        </button>
      ) : null
    ) : canEditRoles ? (
      <button type="button" className="primary-button" onClick={() => openRole(null, "add")}>
        <Icon name="plus" />
        Add Role
      </button>
    ) : null;

  return (
    <div className="tv-page">
      <PageHeading title="Manage User" subtitle="Invite team members and decide what each role can open." actions={headerAction} />

      <Tabs<TabValue>
        label="Manage user tabs"
        value={tab}
        onChange={setTab}
        items={[
          { key: "users", label: "Team Members", icon: "users", count: allUsers.length },
          { key: "roles", label: "Roles", icon: "shield", count: roleList.length },
        ]}
      />

      {tab === "users" ? (
        <section className="glass-card tv-table-card">
          <div className="c-toolbar">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by email or role" label="Search team members" />
            <FilterSelect
              label="Invitation status"
              value={status}
              onChange={setStatus}
              allLabel="All statuses"
              options={Object.values(INVITATION_STATUS).map((s) => ({ value: s, label: s }))}
            />
          </div>
          <BulkSelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
            <button
              type="button"
              className="secondary-button compact-button"
              disabled={pendingSelected.length === 0}
              onClick={() => setConfirm({ kind: "resend", emails: pendingSelected.map((u) => u.email) })}
            >
              <Icon name="paper-plane" />
              Resend Invitation
            </button>
            <button type="button" className="danger-button compact-button" onClick={() => setConfirm({ kind: "delete", users: selectedUsers })}>
              <Icon name="trash" />
              Delete
            </button>
          </BulkSelectionBar>
          <DataTable
            label="Team members"
            columns={userColumns}
            rows={visibleUsers}
            getRowId={(u) => u._id}
            loading={users.loading}
            error={users.error}
            onRetry={users.reload}
            emptyTitle={allUsers.length ? "No matching members" : "No team members yet"}
            emptyMessage={allUsers.length ? "Try another search or clear the status filter." : canEditUsers ? "Use Add User to invite your first team member." : "Your admin has not invited anyone yet."}
            selected={canEditUsers ? selected : undefined}
            onSelectedChange={canEditUsers ? setSelected : undefined}
            storageKey="manage-users"
          />
        </section>
      ) : (
        <section className="glass-card tv-table-card">
          <RolesTable roles={roleList} loading={roles.loading} error={roles.error} onRetry={roles.reload} hasEditPermission={canEditRoles} onOpen={openRole} />
        </section>
      )}

      {userDialog ? (
        <InviteUserDialog user={userDialog.user} roles={roleList} rolesLoading={roles.loading} onClose={() => setUserDialog(null)} onSaved={users.reload} />
      ) : null}

      {roleDialog ? (
        <RoleDialog
          mode={roleDialog.mode}
          roleId={roleDialog.roleId}
          hasEditPermission={canEditRoles}
          onClose={() => setRoleDialog(null)}
          onSaved={() => {
            roles.reload();
            users.reload();
          }}
        />
      ) : null}

      {confirm?.kind === "resend" ? (
        <ConfirmDialog
          title="Resend Invitation"
          message={
            confirm.emails.length === 1
              ? "Are you sure you want to resend the invitation?"
              : `Are you sure you want to resend the invitation to ${confirm.emails.length} users?`
          }
          confirmLabel="Resend"
          busy={busy}
          onConfirm={runConfirm}
          onClose={() => setConfirm(null)}
        />
      ) : null}

      {confirm?.kind === "delete" ? (
        <ConfirmDialog
          title={confirm.users.length === 1 ? "Delete User" : "Delete Users"}
          message={
            confirm.users.length === 1
              ? `Remove ${confirm.users[0].email} from your company? They will lose access to TrackVid.`
              : `Remove ${confirm.users.length} users from your company? They will lose access to TrackVid.`
          }
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={runConfirm}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}
