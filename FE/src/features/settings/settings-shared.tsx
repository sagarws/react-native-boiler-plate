"use client";

import type { ReactNode } from "react";
import type { IconName } from "@/components/icons/icon";
import { IconTile } from "@/components/ui/card-primitives";
import { platformLogoUrl } from "@/components/ui/platform-logo";
import { Tabs } from "@/components/ui/tabs";
import { canAccess } from "@/lib/permissions";
import { useSelector } from "@/store";

/** TrackVid `usePermissionGuard(["admin"], ["settings::edit"])`: without it every settings control is read-only. */
export function useCanEditSettings(): boolean {
  const user = useSelector((s) => s.profile.userProfile);
  return canAccess(user, ["admin"], ["settings::edit"]);
}

const DISPLAY_NAMES: Record<string, string> = {
  ajio: "Ajio",
  myntra: "Myntra",
  flipkart: "Flipkart",
  amazon: "Amazon",
  meesho: "Meesho",
  snapdeal: "Snapdeal",
  delhivery: "Delhivery",
  xbees: "Xbees",
  expressbees: "Xbees",
  nykaa: "Nykaa Fashion",
  naykaa: "Nykaa Fashion",
  tatacliq: "Tata CliQ",
  limeroad: "LimeRoad",
};

/**
 * TrackVid `getPlatformDisplayName` ("Nykaa" → "Nykaa Fashion"), plus title case for the lower-case
 * slugs the BE stores in `increffAllocation` / the Increff QC mapping.
 */
export function platformLabel(name?: string | null): string {
  if (!name) return "";
  const raw = name.trim();
  return DISPLAY_NAMES[raw.toLowerCase().replace(/\s+/g, "")] ?? raw;
}

/** The small logo used on platform rows and pills; a dot when no asset ships for the name. */
export function PlatformMark({ name }: { name: string }) {
  const url = platformLogoUrl(name) ?? platformLogoUrl(platformLabel(name));
  return url ? <img className="tv-settings-logo" src={url} alt="" /> : <span className="tv-settings-dot" aria-hidden="true" />;
}

/** A settings card (TrackVid `SectionCard` / `SectionHeader`): icon tile, title, description, actions, body. */
export function SettingsSection({
  icon,
  title,
  description,
  action,
  children,
  className = "",
}: {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass-card tv-settings-card ${className}`.trim()}>
      <header className="tv-settings-card-head">
        <div className="tv-settings-card-title">
          {icon ? <IconTile name={icon} /> : null}
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
        </div>
        {action ? <div className="tv-settings-card-actions">{action}</div> : null}
      </header>
      {children !== undefined ? <div className="tv-settings-card-body">{children}</div> : null}
    </section>
  );
}

/** Platform segmented control (TrackVid's gradient pill strip), built on the shared `Tabs`. */
export function PlatformPills({
  names,
  value,
  onChange,
  label,
}: {
  names: readonly string[];
  value: number;
  onChange: (index: number) => void;
  label: string;
}) {
  const items = names.map((name, index) => ({
    key: String(index),
    label: (
      <span className="tv-settings-pill">
        <PlatformMark name={name} />
        {platformLabel(name) || `Platform ${index + 1}`}
      </span>
    ),
  }));
  return (
    <div className="tv-settings-pills">
      <Tabs items={items} value={String(value)} onChange={(key) => onChange(Number(key))} label={label} />
    </div>
  );
}

/** Yes / No segmented toggle (TrackVid `TogglePill`). */
export function YesNoToggle({
  value,
  onChange,
  disabled,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="tv-settings-yesno" role="radiogroup" aria-label={label}>
      {[
        { v: true, text: "Yes" },
        { v: false, text: "No" },
      ].map(({ v, text }) => (
        <button key={text} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** One "logo + name + days" input row of the TAT grids (TrackVid `TATPeriodSetting` / `SpfClaimTatPeriodSetting`). */
export function DaysRow({
  name,
  inputName,
  value,
  onChange,
  disabled,
}: {
  name: string;
  inputName: string;
  value: number | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="tv-settings-days-row">
      <PlatformMark name={name} />
      <span className="tv-ellipsis">{platformLabel(name)}</span>
      <input
        type="number"
        min={0}
        name={inputName}
        placeholder="Days"
        aria-label={`${platformLabel(name)} TAT in days`}
        value={value === undefined || value === 0 ? "" : value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        disabled={disabled}
      />
    </label>
  );
}
