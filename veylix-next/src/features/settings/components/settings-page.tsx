// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { FormField } from "@/components/ui/form-field";
import { modulesById } from "@/config/modules/registry";
import { settingsSections } from "@/config/modules/settings-sections";
import { BrandAssetsField } from "@/features/settings/components/brand-assets-field";
import { settingsSectionEntries } from "@/features/settings/constants";
import {
  applyDocumentBranding,
  validateBrandImageDataUrl,
} from "@/lib/branding";
import { showToast } from "@/lib/events";
import { buildHref } from "@/lib/navigation";
import { validateSettingsSection } from "@/lib/settings-validation";
import { readPreference, savePreference } from "@/lib/store/preferences";

function SettingsSectionNav({ activeSection }) {
  return (
    <nav className="glass-card c-settings-nav" aria-label="Settings sections">
      {settingsSectionEntries.map(([t, n]) => (
        <Link
          key={t}
          href={buildHref(`/commerce/settings-${t}`)}
          aria-current={t === activeSection ? "page" : void 0}
        >
          {n.title}
          <Icon name="caret-right" />
        </Link>
      ))}
      <Link className="secondary-button" href={buildHref("/commerce/taxes")}>
        Tax rules
        <Icon name="arrow-right" />
      </Link>
      <Link
        className="secondary-button"
        href={buildHref("/commerce/shipping-rules")}
      >
        {"Shipping zones & rates"}
        <Icon name="arrow-right" />
      </Link>
    </nav>
  );
}

function readSettingsSectionValues(e, t) {
  const n = readPreference(e, t.defaults);
  return {
    ...t.defaults,
    ...(n && typeof n == "object" ? n : {}),
  };
}

function normalizeSettingsValues(e, t) {
  const n = {};
  for (const r of e) {
    const e = t[r.key] ?? "";
    if (r.type === "money" || r.type === "number") {
      n[r.key] = e === "" ? "" : Number(e);
    } else {
      n[r.key] = typeof e == "string" ? e.trim() : e;
    }
  }
  return n;
}

export function SettingsPage({ moduleId }) {
  const t = modulesById[moduleId];
  const n = settingsSections[t.section];
  const r = useMemo(() => readSettingsSectionValues(moduleId, n), [moduleId, n]);
  const [i, a] = useState(r);
  const [o, s] = useState("");
  const c = (e, t) =>
    a((n) => ({
      ...n,
      [e]: t,
    }));
  return (
    <Fragment>
      <CommercePageHeading title={t.title} />
      <div className="c-settings-layout">
        <SettingsSectionNav activeSection={t.section} />
        <section className="glass-card">
          <h2>{n.title}</h2>
          <p className="c-section-copy">{n.description}</p>
          <form
            data-c-form="settings"
            className="c-form"
            onSubmit={(e) => {
              e.preventDefault();
              s("");
              try {
                const e = normalizeSettingsValues(n.fields, i);
                if (t.section === "general")
                  for (const [t, n] of [
                    ["favicon", "Favicon"],
                    ["sidebarLogo", "Sidebar logo"],
                    ["siteLogo", "Main site logo"],
                  ])
                    e[t] = validateBrandImageDataUrl(String(i[t] || ""), n);
                const r = validateSettingsSection(t.section, e);
                savePreference(t.id, r);
                a({
                  ...n.defaults,
                  ...r,
                });
                if (t.section === "general") {
                  applyDocumentBranding(t.title);
                  window.dispatchEvent(new Event("veylix:branding"));
                }
                showToast("Settings saved in this browser.");
              } catch (e) {
                s(
                  e instanceof Error
                    ? e.message
                    : "These settings could not be saved.",
                );
              }
            }}
          >
            <div className="c-form-grid">
              {t.section === "general" ? (
                <BrandAssetsField
                  values={i}
                  onChange={(e, t) => c(e, t)}
                  onError={s}
                  onClearError={() => s("")}
                />
              ) : null}
              {n.fields.map((e) => (
                <FormField
                  key={e.key}
                  field={e}
                  value={i[e.key]}
                  prefix="field"
                  onChange={(t) => c(e.key, t)}
                />
              ))}
            </div>
            <p className="c-form-error" role="alert">
              {o}
            </p>
            <div className="c-form-footer">
              <button type="submit" className="primary-button" data-c-action="">
                Save settings
              </button>
            </div>
          </form>
        </section>
      </div>
    </Fragment>
  );
}
