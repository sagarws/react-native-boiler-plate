"use client";

import { Icon } from "@/components/icons/icon";
import { ToneBadge } from "@/components/ui/card-primitives";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import type { IRole } from "@/types/users-roles";
import { formatPermissionName } from "@/features/users-roles/permission-logic";

interface RoleRow extends IRole {
  no: number;
}

/** Roles list used by /manage-roles and the Roles tab of /manage-users (TrackVid column set). */
export function RolesTable({
  roles,
  loading,
  error,
  onRetry,
  hasEditPermission,
  onOpen,
  pagination = "client",
}: {
  roles: readonly IRole[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  hasEditPermission: boolean;
  onOpen: (role: IRole, mode: "edit" | "view") => void;
  pagination?: "client" | "none";
}) {
  const rows: RoleRow[] = roles.map((r, i) => ({ ...r, no: i + 1 }));

  const columns: DataColumn<RoleRow>[] = [
    { key: "no", header: "No", width: 80, sortable: true },
    {
      key: "name",
      header: "Name",
      minWidth: 180,
      sortable: true,
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => (
        <span className="tv-row">
          <strong>{formatPermissionName(r.name)}</strong>
          {r.systemKey ? <ToneBadge label="Built-in" tone="neutral" /> : null}
        </span>
      ),
    },
    { key: "description", header: "Description", minWidth: 240, wrap: true, render: (r) => r.description || "---" },
    {
      key: "actions",
      header: "Actions",
      width: 110,
      align: "right",
      render: (r) => {
        // Built-in roles (systemKey) are read-only for everyone.
        const editable = hasEditPermission && !r.systemKey;
        const label = editable ? "Edit Role" : "View Role";
        return (
          <button type="button" className="icon-button compact-button" aria-label={`${label}: ${formatPermissionName(r.name)}`} title={label} onClick={() => onOpen(r, editable ? "edit" : "view")}>
            <Icon name={editable ? "pencil" : "eye"} />
          </button>
        );
      },
    },
  ];

  return (
    <DataTable
      label="Roles"
      columns={columns}
      rows={rows}
      getRowId={(r) => r._id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyTitle="No roles yet"
      emptyMessage={hasEditPermission ? "Add a role to decide what each team member can open." : "Your admin has not created any roles."}
      pagination={pagination}
      storageKey="manage-roles"
    />
  );
}
