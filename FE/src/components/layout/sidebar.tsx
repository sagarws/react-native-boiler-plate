"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { navigationSections, type NavItem } from "@/config/navigation";
import { hasCmsApp, isVideoLinkOnlyUser } from "@/lib/access";
import { canAccess } from "@/lib/permissions";
import type { IUser } from "@/types/common";

function NavEntry({ item, pathname, user, badges, onNavigate }: { item: NavItem; pathname: string; user: IUser; badges: Record<string, number>; onNavigate: () => void }) {
  const childActive = item.children?.some((c) => c.path === pathname) ?? false;
  // A manual toggle applies to the page it was made on; on navigation the group follows the active route.
  const [override, setOverride] = useState<{ path: string; open: boolean } | null>(null);
  const expanded = override && override.path === pathname ? override.open : childActive;
  const setExpanded = (fn: (v: boolean) => boolean) => setOverride({ path: pathname, open: fn(expanded) });

  if (item.children) {
    const children = item.children.filter((c) => !(c.hideWithCmsApp && hasCmsApp(user)));
    return (
      <li>
        <button
          type="button"
          className={`nav-link nav-parent${childActive ? " has-active" : ""}`}
          aria-expanded={expanded}
          aria-controls={`nav-${item.id}`}
          title={item.label}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name={item.icon} />
          <span className="nav-label">{item.label}</span>
          <Icon name="caret-down" className="nav-chevron" />
        </button>
        <ul className="nav-children" id={`nav-${item.id}`} hidden={!expanded}>
          {children.map((c) => {
            const active = c.path === pathname;
            return (
              <li key={c.id}>
                <Link className={`nav-link nav-child${active ? " active" : ""}`} href={c.path} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                  <span>{c.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </li>
    );
  }
  const active = item.path === pathname || (item.path !== "/" && pathname.startsWith(`${item.path}/`));
  const count = item.badge ? (badges[item.badge] ?? 0) : 0;
  return (
    <li>
      <Link className={`nav-link${active ? " active" : ""}`} href={item.path} title={item.label} aria-current={active ? "page" : undefined} onClick={onNavigate}>
        <Icon name={item.icon} />
        <span className="nav-label">{item.label}</span>
        {count > 0 ? (
          <span className="nav-badge" aria-label={`${count} pending`}>
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function Sidebar({
  pathname,
  user,
  badges,
  collapsed,
  onToggleCollapsed,
  onCloseMobile,
}: {
  pathname: string;
  user: IUser;
  badges: Record<string, number>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
}) {
  const videoOnly = isVideoLinkOnlyUser(user);
  return (
    <>
      <aside className="sidebar" id="sidebar" aria-label="Main navigation">
        <Link className="brand" href="/" aria-label="TrackVid dashboard" onClick={onCloseMobile}>
          <span className="brand-mark">
            <img className="tv-brand-logo" src="/assets/brand/logo.svg" alt="" />
          </span>
          <span className="brand-name">
            TrackVid
            <small>{user.company.name}</small>
          </span>
        </Link>
        <button
          type="button"
          className="sidebar-collapse icon-button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          <Icon name="caret-right" />
        </button>
        <nav className="navigation">
          {navigationSections.map((section) => {
            const items = section.items.filter((i) => canAccess(user, i.roles, i.permissions) && !(videoOnly && i.hideForVideoLinkOnly));
            if (!items.length) return null;
            return (
              <section key={section.label} className="nav-group" aria-label={section.label}>
                <div className="nav-group-label">
                  <span>{section.label}</span>
                </div>
                <ul>
                  {items.map((item) => (
                    <NavEntry key={item.id} item={item} pathname={pathname} user={user} badges={badges} onNavigate={onCloseMobile} />
                  ))}
                </ul>
              </section>
            );
          })}
        </nav>
      </aside>
      <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={onCloseMobile} />
    </>
  );
}
