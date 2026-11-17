import { clone, delay, newId } from "@/mocks/delay";
import { sampleRoles } from "@/mocks/users-roles";
import type { MessageResponse } from "@/types/common";
import type { IRole, IRolePayload } from "@/types/users-roles";

/** Mock of TrackVid-FE `api/role-service.ts`. Roles live in memory for the page session. */

let roles: IRole[] = clone(sampleRoles);

/** Same-module lookup used by the manage-user mock to resolve role names (not part of the TrackVid API). */
export function peekRole(roleId: string): { _id: string; name: string } | null {
  const role = roles.find((r) => r._id === roleId);
  return role ? { _id: role._id, name: role.name } : null;
}

function assertName(payload: IRolePayload, exceptId?: string): string {
  const name = payload.name.trim();
  if (!name) throw new Error("Role name is required");
  if (name.toLowerCase() === "admin") throw new Error("The admin role is reserved.");
  if (roles.some((r) => r._id !== exceptId && r.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A role with this name already exists.");
  }
  return name;
}

const getRoles = async (): Promise<IRole[]> => {
  await delay();
  return clone(roles);
};

const createRole = async (payload: IRolePayload): Promise<MessageResponse & { data: IRole }> => {
  await delay(500);
  const name = assertName(payload);
  const now = new Date().toISOString();
  const role: IRole = {
    _id: newId(),
    name,
    description: payload.description.trim(),
    permission: clone(payload.permission),
    createdBy: "64f0c0ffee0000000000a001",
    systemKey: null,
    createdAt: now,
    updatedAt: now,
  };
  roles = [...roles, role];
  return { message: "Role added successfully", data: clone(role) };
};

const updateRole = async (payload: IRolePayload, role_id: string): Promise<MessageResponse & { data: IRole }> => {
  await delay(500);
  const current = roles.find((r) => r._id === role_id);
  if (!current) throw new Error("Role not found.");
  if (current.systemKey) throw new Error("Built-in roles cannot be changed.");
  const name = assertName(payload, role_id);
  const updated: IRole = {
    ...current,
    name,
    description: payload.description.trim(),
    permission: clone(payload.permission),
    updatedAt: new Date().toISOString(),
  };
  roles = roles.map((r) => (r._id === role_id ? updated : r));
  return { message: "Role updated successfully", data: clone(updated) };
};

const getRoleById = async (role_id: string): Promise<IRole> => {
  await delay(300);
  const role = roles.find((r) => r._id === role_id);
  if (!role) throw new Error("Role not found.");
  return clone(role);
};

export const RoleService = { getRoles, createRole, updateRole, getRoleById };
