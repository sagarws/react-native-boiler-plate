// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { ProfileAvatar } from "@/components/ui/profile-avatar";
import { buildHref } from "@/lib/navigation";
import { readProfile } from "@/lib/profile";

export function ProfileMenu({ open: e, onToggle, onClose }) {
  const r = readProfile();
  return (
    <div className="header-menu-wrap">
      <button
        type="button"
        className="profile-button"
        data-header-menu="profile"
        aria-label="My profile"
        aria-haspopup="menu"
        aria-expanded={e}
        aria-controls="header-popover-profile"
        onClick={(e) => onToggle(e.currentTarget)}
      >
        <ProfileAvatar profile={r} />
        <span className="profile-copy">
          <strong data-no-translate="">{r.name}</strong>
          <small>{r.role}</small>
        </span>
        <Icon name="caret-down" />
      </button>
      {e ? (
        <div
          id="header-popover-profile"
          className="header-popover popover-profile"
          role="menu"
          aria-label="My profile"
        >
          <div className="popover-profile-summary" data-no-translate="">
            <ProfileAvatar profile={r} />
            <div>
              <strong>{r.name}</strong>
              <span>{r.email}</span>
            </div>
          </div>
          <Link
            role="menuitem"
            href={buildHref("/commerce/profile")}
            onClick={() => onClose()}
          >
            <Icon name="users" />
            <span>My profile</span>
            <Icon name="arrow-right" />
          </Link>
          <Link
            role="menuitem"
            href={buildHref("/commerce/settings-general")}
            onClick={() => onClose()}
          >
            <Icon name="gear" />
            <span>Account settings</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            data-action="drafts"
            onClick={() => onClose()}
          >
            <Icon name="notebook" />
            <span>Saved drafts</span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-action="preferences"
            onClick={() => onClose()}
          >
            <Icon name="gear" />
            <span>Preferences</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
