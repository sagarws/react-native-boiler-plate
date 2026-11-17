// @ts-nocheck
import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/icons/icon";
import { brandAssets } from "@/config/branding";
import { navigationSections } from "@/config/navigation";
import { storeProfile } from "@/data/dashboard";
import { readGeneralSettings } from "@/lib/branding";
import { buildHref } from "@/lib/navigation";

function SidebarNavItem({ item, activePath }) {
  if (item.children) {
    const n = item.children.some((e) => e.path === activePath);
    return (
      <li>
        <button
          type="button"
          className={`nav-link nav-parent${n ? " has-active" : ""}`}
          data-nav-toggle=""
          aria-expanded={n ? "true" : "false"}
          aria-controls={`nav-${item.id}`}
          title={item.label}
        >
          <Icon name={item.icon} />
          <span className="nav-label">{item.label}</span>
          <Icon name="caret-down" className="nav-chevron" />
        </button>
        <ul className="nav-children" id={`nav-${item.id}`} hidden={!n}>
          {item.children.map((e) => {
            const n = e.path === activePath;
            return (
              <li key={e.id}>
                <Link
                  className={`nav-link nav-child${n ? " active" : ""}`}
                  href={buildHref(e.path)}
                  aria-current={n ? "page" : void 0}
                >
                  <span>{e.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </li>
    );
  }
  const n = item.path === activePath;
  return (
    <li>
      <Link
        className={`nav-link${n ? " active" : ""}`}
        href={buildHref(item.path || "/overview")}
        title={item.label}
        aria-current={n ? "page" : void 0}
      >
        <Icon name={item.icon} />
        <span className="nav-label">{item.label}</span>
      </Link>
    </li>
  );
}

export function Sidebar({ activePath }) {
  const t = readGeneralSettings();
  const n = t.storeName || storeProfile.name;
  const r = t.tagline || storeProfile.tagline;
  const i = navigationSections;
  return (
    <Fragment>
      <aside className="sidebar" id="sidebar" aria-label="Main navigation">
        <Link
          className="brand"
          href={buildHref("/overview")}
          aria-label={`${n} overview`}
        >
          <span className="brand-mark">
            <img
              src={t.sidebarLogo || brandAssets.sidebarLogo}
              alt=""
              style={
                t.sidebarLogo
                  ? {
                      display: "block",
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      borderRadius: "inherit",
                    }
                  : {
                      display: "block",
                      width: "30px",
                      height: "30px",
                      objectFit: "contain",
                    }
              }
            />
          </span>
          <span className="brand-name">
            {n}
            <small>{r}</small>
          </span>
        </Link>
        <button
          type="button"
          className="sidebar-collapse icon-button"
          data-action="toggle-sidebar"
          aria-label="Collapse sidebar"
          aria-expanded="true"
        >
          <Icon name="caret-right" />
        </button>
        <nav className="navigation">
          {i.map((t) => (
            <section key={t.label} className="nav-group" aria-label={t.label}>
              <div className="nav-group-label">
                <span>{t.label}</span>
              </div>
              <ul>
                {t.items.map((t) => (
                  <SidebarNavItem key={t.id} item={t} activePath={activePath} />
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </aside>
      <button
        type="button"
        className="sidebar-scrim"
        data-action="close-sidebar"
        aria-label="Close navigation"
      />
    </Fragment>
  );
}
