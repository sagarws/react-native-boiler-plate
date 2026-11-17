import type { IUser, PermissionMap } from "@/types/common";

/** `hasPermission(user, "cms::edit")`: walks the role permission tree (same rules as TrackVid-FE). */
export function hasPermission(user: IUser | null | undefined, path: string): boolean {
  if (!path) return false;
  let level: boolean | PermissionMap | undefined = user?.role?.permission;
  for (const key of path.split("::")) {
    if (level && typeof level === "object") level = level[key];
    else return false;
  }
  return level === true;
}

/**
 * TrackVid `AccessRestriction` / `SidebarGuard` rule: an admin whose role name is in `roles`,
 * or every listed permission, or no permissions listed.
 */
export function canAccess(user: IUser | null | undefined, roles: readonly string[], permissions: readonly string[]): boolean {
  if (!user) return false;
  const hasRole = Boolean(user.role?.isAdmin) && roles.includes(user.role?.name ?? "");
  if (hasRole) return true;
  if (permissions.length === 0) return true;
  return permissions.every((p) => hasPermission(user, p));
}
