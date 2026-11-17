"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { IconTile } from "@/components/ui/card-primitives";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { ThemeMenu } from "@/components/layout/theme-menu";
import ROUTE_URLS from "@/config/route";
import { formatNumber } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import type { IUser } from "@/types/common";

type MenuId = "notifications" | "profile" | "theme";

export function Topbar({
  title,
  user,
  onOpenMobileNav,
  mobileNavOpen,
  onLogout,
  mockRole,
  onMockRoleChange,
  impersonator,
}: {
  title: string;
  user: IUser;
  onOpenMobileNav: () => void;
  mobileNavOpen: boolean;
  onLogout: () => void;
  mockRole: "admin" | "system_admin";
  onMockRoleChange: (r: "admin" | "system_admin") => void;
  impersonator: string | null;
}) {
  const headerRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [scrolled, setScrolled] = useState(false);

  const close = (refocus = false) => {
    setMenu(null);
    if (refocus) requestAnimationFrame(() => openerRef.current?.focus());
  };
  const toggle = (id: MenuId, el: HTMLElement) => {
    if (menu === id) close();
    else {
      openerRef.current = el;
      setMenu(id);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let raf = 0;
    document.addEventListener(
      "click",
      (e) => {
        if (e.target instanceof Element && !e.target.closest(".header-menu-wrap")) setMenu(null);
      },
      { signal },
    );
    window.addEventListener(
      "scroll",
      () => {
        raf ||= requestAnimationFrame(() => {
          raf = 0;
          setScrolled(window.scrollY > 12);
        });
      },
      { signal, passive: true },
    );
    return () => {
      controller.abort();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!menu) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
    const items = Array.from(headerRef.current?.querySelectorAll<HTMLElement>(".header-popover button:not(:disabled), .header-popover a") ?? []);
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = idx < 0 ? 0 : (idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const credit = user.company.creditId;
  return (
    <header ref={headerRef} className={`topbar${scrolled ? " is-scrolled" : ""}`} onKeyDown={onKeyDown}>
      <button type="button" className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={onOpenMobileNav}>
        <Icon name="list" />
      </button>
      <div className="header-primary">
        <h1 className="tv-section-title" style={{ padding: "0 10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </h1>
        <div className="header-metrics">
          <Link className="header-metric" href={`${ROUTE_URLS.ACCOUNTS}?tab=my_usage`} aria-label="Account wallet: remaining credits">
            <IconTile name="wallet" tone="success" />
            <span>
              Credits
              <strong>{formatNumber(credit.remainingCredit)}</strong>
            </span>
          </Link>
          <Link className="header-metric" href={`${ROUTE_URLS.ACCOUNTS}?tab=my_usage`} aria-label="Storage remaining">
            <IconTile name="database" tone="info" />
            <span>
              Storage
              <strong>{credit.remainingStorage.toFixed(1)} GB</strong>
            </span>
          </Link>
        </div>
      </div>
      <div className="header-tools">
        <ThemeMenu open={menu === "theme"} onToggle={(el) => toggle("theme", el)} onClose={() => close(true)} />
        <NotificationsMenu open={menu === "notifications"} onToggle={(el) => toggle("notifications", el)} onClose={() => close()} />
        {hasPermission(user, "settings::view") || user.role.isAdmin ? (
          <Link className="icon-button" href={ROUTE_URLS.SETTINGS} aria-label="Settings" title="Settings">
            <Icon name="gear" />
          </Link>
        ) : null}
        <ProfileMenu
          user={user}
          open={menu === "profile"}
          onToggle={(el) => toggle("profile", el)}
          onClose={() => close()}
          onLogout={onLogout}
          mockRole={mockRole}
          onMockRoleChange={onMockRoleChange}
          impersonator={impersonator}
        />
      </div>
    </header>
  );
}
