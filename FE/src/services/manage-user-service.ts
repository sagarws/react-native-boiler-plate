import { clone, delay, newId } from "@/mocks/delay";
import { sampleCompanyUsers } from "@/mocks/users-roles";
import { peekRole } from "@/services/role-service";
import type { MessageResponse } from "@/types/common";
import type { ICompanyUser, IInviteUserPayload } from "@/types/users-roles";

/** Mock of TrackVid-FE `api/manage-user-service.ts`. Users live in memory for the page session. */

let users: ICompanyUser[] = clone(sampleCompanyUsers);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(payload: IInviteUserPayload, exceptId?: string): { email: string; role: { _id: string; name: string } } {
  const email = payload.email.trim().toLowerCase();
  if (!email) throw new Error("Email is required");
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email");
  if (email === "aarav@urbanthreads.in" || users.some((u) => u._id !== exceptId && u.email === email)) {
    throw new Error("This user is already part of your company.");
  }
  const role = peekRole(payload.role);
  if (!role) throw new Error("Role is required");
  return { email, role };
}

const getCompanyUsers = async (): Promise<ICompanyUser[]> => {
  await delay();
  // Role names follow later role renames (the BE populates `role`).
  return clone(users.map((u) => ({ ...u, role: (u.role && peekRole(u.role._id)) ?? u.role })));
};

/** Sends an invitation email: the user stays `Pending` until they accept. */
const createUser = async (payload: IInviteUserPayload): Promise<MessageResponse> => {
  await delay(600);
  const { email, role } = validate(payload);
  users = [...users, { _id: newId(), email, role, status: "Pending", createdAt: new Date().toISOString() }];
  return { message: `Invitation sent to ${email}` };
};

/** Adds a user without the invitation step (BE creates the account directly). */
const addDataUser = async (payload: IInviteUserPayload): Promise<MessageResponse> => {
  await delay(600);
  const { email, role } = validate(payload);
  users = [...users, { _id: newId(), email, role, status: "Accepted", createdAt: new Date().toISOString() }];
  return { message: "User added successfully" };
};

const updateDataUser = async (payload: IInviteUserPayload, user_id: string): Promise<MessageResponse> => {
  await delay(500);
  const current = users.find((u) => u._id === user_id);
  if (!current) throw new Error("User not found.");
  const { email, role } = validate(payload, user_id);
  // An accepted user's email belongs to their account and cannot be changed here.
  const nextEmail = current.status === "Accepted" ? current.email : email;
  users = users.map((u) => (u._id === user_id ? { ...u, email: nextEmail, role } : u));
  return { message: "User updated successfully" };
};

/** Not in TrackVid's API file: removes users from the company (used by the row / bulk delete actions). */
const deleteCompanyUsers = async (payload: { id: string[] }): Promise<MessageResponse> => {
  await delay(400);
  if (payload.id.length === 0) throw new Error("Select at least one user.");
  users = users.filter((u) => !payload.id.includes(u._id));
  return { message: payload.id.length === 1 ? "User deleted successfully" : `${payload.id.length} users deleted successfully` };
};

export const ManageUserService = { getCompanyUsers, createUser, addDataUser, updateDataUser, deleteCompanyUsers };
