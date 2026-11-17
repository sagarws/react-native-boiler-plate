import type { IUser } from "@/types/common";

/** True when the role grants the Video Link tab and nothing else (TrackVid `isVideoLinkOnlyUser`). */
export function isVideoLinkOnlyUser(user: IUser | null | undefined): boolean {
  const role = user?.role;
  if (!role || role.isAdmin) return false;
  const permissions = role.permission || {};
  const videoLink = permissions.video_link;
  if (typeof videoLink !== "object" || videoLink.view !== true) return false;
  const hasAnyTrue = (node: unknown): boolean => {
    if (node === true) return true;
    if (!node || typeof node !== "object") return false;
    return Object.values(node as Record<string, unknown>).some(hasAnyTrue);
  };
  return !Object.entries(permissions).some(([key, value]) => key !== "video_link" && hasAnyTrue(value));
}

/** True once the company has the CMS desktop app (TrackVid `hasCmsApp`). */
export function hasCmsApp(user: IUser | null | undefined): boolean {
  const version = user?.company?.settings?.cmsAppVersion;
  return typeof version === "string" && version.trim() !== "";
}
