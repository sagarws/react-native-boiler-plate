"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { Avatar } from "@/components/ui/avatar";
import ROUTE_URLS from "@/config/route";
import { hasPermission } from "@/lib/permissions";
import type { IUser } from "@/types/common";

/** Company avatar button + menu: Profile, Change Password, mock role switch, Logout (TrackVid header). */
export function ProfileMenu({
  user,
  open,
  onToggle,
  onClose,
  onLogout,
  mockRole,
  onMockRoleChange,
  impersonator,
}: {
  user: IUser;
  open: boolean;
  onToggle: (el: HTMLElement) => void;
  onClose: () => void;
  onLogout: () => void;
  mockRole: "admin" | "system_admin";
  onMockRoleChange: (r: "admin" | "system_admin") => void;
  impersonator: string | null;
}) {
  const router = useRouter();
  const fullName = `${user.name.firstName} ${user.name.lastName}`.trim();
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <div className="header-menu-wrap">
      <button
        type="button"
        className="profile-button"
        aria-label="My account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="header-popover-profile"
        onClick={(e) => onToggle(e.currentTarget)}
      >
        <Avatar name={user.company.name} photo={user.company.logo} />
        <span className="profile-copy">
          <strong>{user.company.name}</strong>
          <small>{impersonator ? `Viewing as ${fullName}` : fullName}</small>
        </span>
        <Icon name="caret-down" />
      </button>
      {open ? (
        <div id="header-popover-profile" className="header-popover popover-profile" role="menu" aria-label="My account">
          <div className="popover-profile-summary">
            <Avatar name={fullName} />
            <div>
              <strong>{fullName}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          {hasPermission(user, "profile::view") || user.role.isAdmin ? (
            <button type="button" role="menuitem" onClick={() => go(ROUTE_URLS.PROFILE)}>
              <Icon name="user" />
              <span>Profile</span>
              <Icon name="arrow-right" />
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => go(`${ROUTE_URLS.PROFILE}?tab=change_password`)}>
            <Icon name="lock" />
            <span>Change Password</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={mockRole === "system_admin"}
            onClick={() => {
              onMockRoleChange(mockRole === "admin" ? "system_admin" : "admin");
              onClose();
            }}
          >
            <Icon name="shield" />
            <span>
              <strong>Sample role: {mockRole === "admin" ? "Admin" : "System admin"}</strong>
              <small>UI preview only. Switch to see role-gated screens.</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onLogout();
            }}
          >
            <Icon name="sign-out" />
            <span>{impersonator ? "Exit impersonation" : "Logout"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
