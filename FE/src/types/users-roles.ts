/** Manage users / roles types (TrackVid-FE `helper/types/types.ts`, `slices/manageUserSlice`, `slices/roleSlice`). */
import type { IRole, PermissionMap } from "@/types/common";

export type { IRole, PermissionMap };

/** TrackVid `enum INVITATION_STATUS` (kept as a const object so values stay plain strings). */
export const INVITATION_STATUS = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
} as const;
export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];

export interface InvitedUsers {
  _id?: string;
  email: string;
  status: InvitationStatus;
  role?: { _id: string; name: string };
}

/** Row returned by `ManageUserService.getCompanyUsers` (`user/get-company-users`). */
export interface ICompanyUser extends InvitedUsers {
  _id: string;
  name?: { firstName: string; lastName: string };
  createdAt: string;
}

/** Body of `auth/create-user`, `auth/add-data-user` and `auth/update-data-user/:id`. */
export interface IInviteUserPayload {
  email: string;
  role: string;
  _id?: string;
}

/** Body of `role/add-role` and `role/update-role/:id`. */
export interface IRolePayload {
  name: string;
  description: string;
  permission: PermissionMap;
}

/** One radio column of the permission matrix. */
export type PermissionLevel = "none" | "view" | "viewEdit";
