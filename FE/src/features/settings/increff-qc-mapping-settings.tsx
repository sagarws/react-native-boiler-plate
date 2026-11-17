"use client";

import { useState } from "react";
import { platformLogoUrl } from "@/components/ui/platform-logo";
import { Spinner, ErrorState, LoadingState } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { AppSettingsService } from "@/services/app-settings";
import { CompanyService } from "@/services/company-service";
import { UserService } from "@/services/user-service";
import { useDispatch, useSelector } from "@/store";
import { setUserProfile } from "@/store/profile-slice";
import { QC_REASON_KEY, type IncreffQcMappingEntry } from "@/types/settings";
import { PlatformMark, PlatformPills, SettingsSection, platformLabel, useCanEditSettings } from "./settings-shared";

/** Platform columns of the mapping, in first-seen order (new BE columns show up without an FE change). */
function platformsOf(mapping: readonly IncreffQcMappingEntry[]): string[] {
  const seen: string[] = [];
  for (const entry of mapping) {
    for (const key of Object.keys(entry)) {
      if (key !== QC_REASON_KEY && !seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

/**
 * TrackVid `components/settings/IncreffQcMappingSettings.tsx`: per-marketplace switch for auto claim
 * creation from the Increff report (`company.settings.increffAllocation`), and the read-only
 * Increff QC reason → marketplace claim type mapping.
 */
export function IncreffQcMappingSettings() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.profile.userProfile);
  const canEdit = useCanEditSettings();
  const load = useAsync(() => AppSettingsService.getAppSettings(), []);
  const [savingPlatform, setSavingPlatform] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const allocation = user?.company.settings.increffAllocation ?? [];
  const isAllowed = (platform: string) => allocation.some((a) => a.platform === platform && a.allowed);

  const handleToggle = async (platform: string, next: boolean) => {
    if (!user) return;
    setSavingPlatform(platform);
    try {
      await CompanyService.updateIncreffAllocation({ platform, allowed: next });
      // TrackVid patches the profile slice (`updateIncreffAllocationEntry`); keep the mock profile in step too.
      const entries = allocation.some((a) => a.platform === platform)
        ? allocation.map((a) => (a.platform === platform ? { ...a, allowed: next } : a))
        : [...allocation, { platform, allowed: next }];
      const settings = { ...user.company.settings, increffAllocation: entries };
      const updated = await UserService.updateUser({ company: { ...user.company, settings } }, user._id);
      dispatch(setUserProfile(updated));
      toast.success(`Increff auto-claim ${next ? "enabled" : "disabled"} for ${platformLabel(platform)}`);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update"));
    } finally {
      setSavingPlatform(null);
    }
  };

  const mapping = load.data?.increffQcMapping ?? [];
  const platformOptions = platformsOf(mapping);
  const safeIndex = activeIndex < platformOptions.length ? activeIndex : 0;
  const activePlatform = platformOptions[safeIndex] ?? "";
  const increffLogo = platformLogoUrl("increff");

  let toggles;
  if (load.loading && !load.data) toggles = <LoadingState label="Loading marketplaces…" />;
  else if (load.error) toggles = <ErrorState message={load.error} onRetry={load.reload} title="Failed to load Increff QC mapping" />;
  else if (platformOptions.length === 0)
    toggles = (
      <p className="tv-muted tv-small">
        No Increff-mapped platforms yet. Seed the mapping via <strong>POST /app-settings/increff-qc-mapping</strong> first.
      </p>
    );
  else
    toggles = (
      <div className="tv-settings-toggle-grid">
        {platformOptions.map((name) => (
          <div key={name} className="tv-settings-toggle-cell">
            <span className="tv-row tv-ellipsis">
              <PlatformMark name={name} />
              <span className="tv-ellipsis">{platformLabel(name)}</span>
            </span>
            {savingPlatform === name ? (
              <Spinner label={`Saving ${platformLabel(name)}`} />
            ) : (
              <Switch
                checked={isAllowed(name)}
                onChange={(checked) => void handleToggle(name, checked)}
                label={`Auto claim creation for ${platformLabel(name)}`}
                hideLabel
                disabled={!canEdit || savingPlatform !== null}
              />
            )}
          </div>
        ))}
      </div>
    );

  return (
    <div className="tv-stack">
      <section className="glass-card tv-settings-card">
        <header className="tv-settings-card-head">
          <div className="tv-settings-card-title">
            {increffLogo ? <img className="tv-settings-brand-logo" src={increffLogo} alt="Increff" /> : null}
            <div>
              <h2>Select Marketplaces for auto claim creation:</h2>
            </div>
          </div>
        </header>
        <div className="tv-settings-card-body">{toggles}</div>
      </section>

      {load.loading && !load.data ? null : load.error ? null : mapping.length === 0 ? (
        <section className="glass-card tv-settings-card">
          <p className="tv-muted">
            No Increff QC mapping configured yet. Seed the AppSetting via <strong>POST /app-settings/increff-qc-mapping</strong> to populate this view.
          </p>
        </section>
      ) : (
        <SettingsSection
          icon="shopping-bag"
          title="Increff QC Mapping"
          description="Reference mapping from Increff QC reasons to the claim type each marketplace expects."
        >
          <div className="tv-settings-pill-row">
            <PlatformPills names={platformOptions} value={safeIndex} onChange={setActiveIndex} label="Increff mapping platforms" />
          </div>
          <div className="tv-settings-platform-card">
            <div className="tv-settings-platform-head">
              <span className="tv-settings-label">Platform</span>
              <div className="c-field tv-settings-name-field">
                <input type="text" readOnly aria-label="Platform" value={platformLabel(activePlatform)} />
              </div>
            </div>
            <div className="tv-settings-map-grid tv-settings-map-head" aria-hidden="true">
              <span className="tv-settings-eyebrow">Types of claim</span>
              <span className="tv-settings-eyebrow">Types of claim form {platformLabel(activePlatform) || "platform"}</span>
            </div>
            <div className="tv-stack tv-settings-map-rows">
              {mapping.map((entry, idx) => {
                const qcReason = typeof entry[QC_REASON_KEY] === "string" ? entry[QC_REASON_KEY] : "";
                const platformReason = activePlatform && typeof entry[activePlatform] === "string" ? entry[activePlatform] : "";
                return (
                  <div key={`${qcReason || "row"}-${idx}`} className="tv-settings-map-grid">
                    <div className="c-field">
                      <input type="text" readOnly value={qcReason} aria-label={`QC reason ${idx + 1}`} />
                    </div>
                    <div className="c-field">
                      <input type="text" readOnly value={platformReason} placeholder="—" aria-label={`${platformLabel(activePlatform)} claim type for ${qcReason}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </SettingsSection>
      )}
    </div>
  );
}
