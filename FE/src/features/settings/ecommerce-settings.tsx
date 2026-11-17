"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { Banner } from "@/components/ui/banner";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { DefaultECommercePlatforms } from "@/config/constant";
import ROUTE_URLS from "@/config/route";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { AppSettingsService } from "@/services/app-settings";
import { UserService, type IAppECommerceSettings } from "@/services/user-service";
import { useDispatch } from "@/store";
import { getUserProfile } from "@/store/profile-slice";
import type { IEcommerce } from "@/types/common";
import { EcommerceClaimsEditor, copyClaims, validateEcommerce } from "./ecommerce-claims-editor";
import { MasterSetting } from "./master-setting";
import { DaysRow, SettingsSection, useCanEditSettings } from "./settings-shared";

/**
 * Ordered platform slugs — must stay in step with the BE canonical slugs (`resolveSpfTatSlug`).
 * "expressbees" is the BE slug for Xbees and "naykaa" the (historical) slug for Nykaa Fashion.
 */
export const SPF_CLAIM_TAT_PLATFORMS: { key: string; label: string }[] = [
  { key: "ajio", label: "Ajio" },
  { key: "meesho", label: "Meesho" },
  { key: "snapdeal", label: "Snapdeal" },
  { key: "delhivery", label: "Delhivery" },
  { key: "expressbees", label: "Xbees" },
  { key: "myntra", label: "Myntra" },
  { key: "flipkart", label: "Flipkart" },
  { key: "amazon", label: "Amazon" },
  { key: "tataCliq", label: "Tata CliQ" },
  { key: "naykaa", label: "Nykaa Fashion" },
];

/** Every known SPF platform key seeded with `defaultDays`; `overrides` win per key. */
function buildSpfTatMap(defaultDays: number, ...overrides: (Record<string, number> | undefined)[]): Record<string, number> {
  const base: Record<string, number> = {};
  for (const p of SPF_CLAIM_TAT_PLATFORMS) base[p.key] = defaultDays;
  return Object.assign(base, ...overrides.map((o) => o ?? {}));
}

const cloneList = (list: readonly IEcommerce[]): IEcommerce[] => list.map((p) => ({ ...p, typeOfClaims: p.typeOfClaims.map((c) => ({ ...c })) }));

/**
 * TrackVid `components/settings/ECommerceSettings.tsx`: marketplace-credentials notice, SPF claim TAT
 * (saved on its own), Master Data + TAT periods, and the per-platform claim types editor.
 */
export function ECommerceSettings() {
  const dispatch = useDispatch();
  const canEdit = useCanEditSettings();
  const load = useAsync(() => UserService.getAppECommerceSettings(), []);
  // App-level SPF defaults. Failure is silent: the grid keeps the hard-coded 10 days (the BE seed).
  const appSettings = useAsync(() => AppSettingsService.getAppSettings().catch(() => null), []);

  const [baseline, setBaseline] = useState<IEcommerce[] | null>(null);
  const [values, setValues] = useState<IEcommerce[] | null>(null);
  const [spfOverride, setSpfOverride] = useState<Record<string, number> | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  if (load.loading && !load.data) return <LoadingState label="Loading ecommerce settings…" />;
  if (load.error || !load.data) {
    return <ErrorState message={load.error} onRetry={load.reload} title="Could not load ecommerce settings" />;
  }

  const ecommerceList = baseline ?? load.data.eCommercePlatform;
  const formValues = values ?? ecommerceList;
  const spfTatValues = spfOverride ?? buildSpfTatMap(10, appSettings.data?.spfClaimTatPeriod, load.data.spfClaimTatPeriod);
  const errors = submitted ? validateEcommerce(formValues) : null;
  const safeActive = Math.min(activeIndex, Math.max(0, formValues.length - 1));

  const save = async (build: () => Promise<IAppECommerceSettings>, onSaved?: () => void) => {
    setSaving(true);
    try {
      const res = await UserService.updateAppECommerceSettings(await build());
      toast.success(res.message || "Settings updated successfully");
      onSaved?.();
      void dispatch(getUserProfile());
    } catch (err) {
      toast.error(errorMessage(err, "Something went wrong"));
    } finally {
      setSaving(false);
    }
  };

  /** Partial save: only the SPF map, the BE leaves the platform list alone. */
  const handleSaveSpfTat = () => {
    // The mock's payload type requires `eCommercePlatform`: re-send the stored list untouched, so unsaved
    // claim / TAT edits on this page are not saved by this button (TrackVid sends only the SPF map).
    const spf = { ...spfTatValues };
    void save(async () => ({ eCommercePlatform: (await UserService.getAppECommerceSettings()).eCommercePlatform, spfClaimTatPeriod: spf }));
  };

  const handleTatPeriodChange = (id: string, value: number) => {
    const apply = (list: readonly IEcommerce[]) => list.map((p) => (p._id === id ? { ...p, tatPeriod: value } : p));
    setBaseline(apply(ecommerceList));
    setValues(apply(formValues));
  };

  const handleSubmit = () => {
    setSubmitted(true);
    if (formValues.length === 0) {
      toast.error("Ecommerce settings cannot be empty!");
      return;
    }
    const found = validateEcommerce(formValues);
    const firstInvalid = Object.keys(found).map(Number)[0];
    if (firstInvalid !== undefined) {
      setActiveIndex(firstInvalid);
      return;
    }
    const saved = cloneList(formValues);
    const spf = { ...spfTatValues };
    void save(async () => ({ eCommercePlatform: saved, spfClaimTatPeriod: spf }), () => {
      setBaseline(saved);
      setValues(null);
      setSubmitted(false);
    });
  };

  /** Default marketplaces get their default claims back; missing defaults are appended; custom ones stay. */
  const handleResetAllClaims = () => {
    const currentNames = new Set(formValues.map((p) => p.name?.trim().toLowerCase()).filter(Boolean));
    const reset = formValues.map((platform) => {
      const name = platform.name?.trim().toLowerCase();
      const defaults = DefaultECommercePlatforms.find((dp) => dp.name.trim().toLowerCase() === name);
      return defaults ? { ...platform, typeOfClaims: copyClaims(defaults.typeOfClaims) } : platform;
    });
    const missing: IEcommerce[] = DefaultECommercePlatforms.filter((dp) => !currentNames.has(dp.name.trim().toLowerCase())).map((dp) => ({
      name: dp.name,
      tatPeriod: 0,
      typeOfClaims: copyClaims(dp.typeOfClaims),
    }));
    setValues([...reset, ...missing]);
  };

  return (
    <div className="tv-stack">
      <Banner
        tone="info"
        title="Marketplace credentials have moved"
        actions={
          <Link className="primary-button compact-button" href={`${ROUTE_URLS.INTEGRATIONS}?provider=ajio`}>
            Go to Integrations
            <Icon name="arrow-right" />
          </Link>
        }
      >
        Add and manage your marketplace account credentials from the Integrations page.
      </Banner>

      <SettingsSection
        icon="clock"
        title="SPF Claim TAT Period (in days)"
        description="Turnaround time for each marketplace's SPF claim. Saved independently — hitting this Save button will not affect the Ecommerce Claims below."
        action={
          canEdit ? (
            <button type="button" className="primary-button compact-button" onClick={handleSaveSpfTat} disabled={saving}>
              Save
            </button>
          ) : null
        }
      >
        <div className="tv-settings-days-grid">
          {SPF_CLAIM_TAT_PLATFORMS.map((p) => (
            <DaysRow
              key={p.key}
              name={p.label}
              inputName={`spfClaimTatPeriod.${p.key}`}
              value={spfTatValues[p.key]}
              disabled={!canEdit}
              onChange={(value) => setSpfOverride({ ...spfTatValues, [p.key]: value })}
            />
          ))}
        </div>
      </SettingsSection>

      <MasterSetting platforms={ecommerceList} onTatPeriodChange={handleTatPeriodChange} canEdit={canEdit} />

      <SettingsSection
        icon="shopping-bag"
        title="Ecommerce Claims"
        description="Configure marketplace platforms and the claim types each one supports."
        action={
          canEdit ? (
            <div className="tv-row">
              <button type="button" className="secondary-button compact-button tv-settings-danger-outline" onClick={handleResetAllClaims} disabled={saving}>
                Reset All
              </button>
              <button
                type="reset"
                className="secondary-button compact-button"
                disabled={saving}
                onClick={() => {
                  setValues(null);
                  setSubmitted(false);
                }}
              >
                Discard Changes
              </button>
              <button type="submit" className="primary-button compact-button" onClick={handleSubmit} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : null
        }
      >
        <EcommerceClaimsEditor
          values={formValues}
          onChange={setValues}
          errors={errors}
          activeIndex={safeActive}
          onActiveIndexChange={setActiveIndex}
          canEdit={canEdit}
          saving={saving}
        />
      </SettingsSection>
    </div>
  );
}
