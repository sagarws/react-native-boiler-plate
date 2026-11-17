"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "@/components/icons/icon";
import { PageHeading } from "@/components/ui/page-heading";
import ROUTE_URLS from "@/config/route";
import { useIntegrationAccess } from "@/features/integrations/integration-access";
import { useSelector } from "@/store";
import type { ICompanySettings } from "@/types/common";
import type { SettingsTab } from "@/types/settings";
import { ECommerceSettings } from "./ecommerce-settings";
import { EmailAutoReplySettings } from "./email-auto-reply-settings";
import { IncreffQcMappingSettings } from "./increff-qc-mapping-settings";
import { VideoSettings } from "./video-settings";

const BASE_PATH = ROUTE_URLS.SETTINGS;

const ALL_TABS: { value: SettingsTab; label: string; tone: string }[] = [
  { value: "video_settings", label: "Video Settings", tone: "blue" },
  { value: "ecommerce_settings", label: "Ecommerce Settings", tone: "lilac" },
  { value: "integrations", label: "AJIO Email Auto Reply", tone: "amber" },
  { value: "increff_qc_mapping", label: "Auto claim creation through Increff Report", tone: "green" },
];

const isSettingsTab = (value: string | null): value is SettingsTab => ALL_TABS.some((t) => t.value === value);

/**
 * TrackVid `pages/Settings.tsx`: settings sections selected with `?tab=` (default `video_settings`).
 * The Increff tab needs the company's `increffBulkClaim` flag, the email tab the `email` integration.
 * Uses search params: render inside <Suspense>.
 */
export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userProfile = useSelector((s) => s.profile.userProfile);
  const { isEnabled } = useIntegrationAccess();

  const settings: (ICompanySettings & { increffBulkClaim?: boolean }) | undefined = userProfile?.company.settings;
  // TrackVid reads `company.settings.increffBulkClaim`. The mock profile has no such field, so when it is
  // missing the company's `integrationAccess.increff` flag decides instead.
  const showIncreffTab = settings?.increffBulkClaim ?? settings?.integrationAccess?.increff === true;
  // The email auto-reply tab is the Settings half of the "Email" card on /integrations: same gate.
  const showEmailTab = isEnabled("email");
  const tabs = ALL_TABS.filter((t) => (t.value !== "increff_qc_mapping" || showIncreffTab) && (t.value !== "integrations" || showEmailTab));

  const rawTab = searchParams.get("tab");
  const requested: SettingsTab = isSettingsTab(rawTab) ? rawTab : "video_settings";
  const active: SettingsTab = tabs.some((t) => t.value === requested) ? requested : "video_settings";

  // A deep link to a hidden tab (e.g. a bookmark from before the flag was turned off) snaps back to
  // Video Settings. Waits for the profile: before it loads every gated tab reads as hidden.
  useEffect(() => {
    if (!userProfile || !rawTab) return;
    if (!isSettingsTab(rawTab) || active !== rawTab) router.replace(`${BASE_PATH}?tab=video_settings`);
  }, [userProfile, rawTab, active, router]);

  const hrefFor = (value: SettingsTab) => {
    const params = new URLSearchParams();
    params.set("tab", value);
    // Keep `?provider=` when moving to the email tab (TrackVid passes it through).
    const provider = searchParams.get("provider");
    if (value === "integrations" && provider) params.set("provider", provider);
    return `${BASE_PATH}?${params.toString()}`;
  };

  let content;
  switch (active) {
    case "ecommerce_settings":
      content = <ECommerceSettings />;
      break;
    case "integrations":
      content = <EmailAutoReplySettings />;
      break;
    case "increff_qc_mapping":
      content = <IncreffQcMappingSettings />;
      break;
    default:
      content = <VideoSettings />;
  }

  const activeLabel = tabs.find((t) => t.value === active)?.label ?? "Video Settings";

  return (
    <div className="tv-page">
      <PageHeading title="Settings" subtitle="Video storage, marketplace claims, email auto-reply and Increff auto claims for your workspace." />
      <div className="c-settings-layout tv-settings-layout">
        <nav className="glass-card c-settings-nav" aria-label="Settings sections">
          {tabs.map((t) => (
            <Link key={t.value} href={hrefFor(t.value)} replace scroll={false} aria-current={t.value === active ? "page" : undefined}>
              <span className="tv-settings-nav-label">
                <span className={`tv-settings-nav-dot is-${t.tone}`} aria-hidden="true" />
                {t.label}
              </span>
              <Icon name="caret-right" />
            </Link>
          ))}
        </nav>
        <div className="tv-settings-content" role="region" aria-label={activeLabel}>
          {content}
        </div>
      </div>
    </div>
  );
}
