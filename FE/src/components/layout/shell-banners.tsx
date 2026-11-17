"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { CMS_APP_DOWNLOAD_URL, CMS_APP_GUIDE_LINK_TEXT, CMS_APP_GUIDE_URL, CMS_APP_INSTALL_LINK_TEXT, CMS_APP_INSTALL_MESSAGE } from "@/config/app-constant";
import ROUTE_URLS from "@/config/route";
import { hasCmsApp } from "@/lib/access";
import { canAccess } from "@/lib/permissions";
import type { IUser } from "@/types/common";

const toTitleCase = (name: string) =>
  name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

/** TrackVid `UnverifiedCredentialsBanner` + `CmsAppInstallBanner`. */
export function ShellBanners({ user }: { user: IUser }) {
  const router = useRouter();
  const [hideCmsApp, setHideCmsApp] = useState(false);
  const canViewIntegrations = canAccess(user, ["admin"], ["integrations::view"]);
  const canViewCms = canAccess(user, ["admin"], ["cms::view"]);
  const unverified = (user.company.settings.eCommercePlatformLoginInfo || [])
    .filter((e) => e.eComPlatform && e.info?.length && e.info.some((c) => c.is_verified === false))
    .map((e) => e.eComPlatform);

  const goTo = (platform: string) => router.push(`${ROUTE_URLS.INTEGRATIONS}?provider=${platform.toLowerCase()}`);
  const showCreds = canViewIntegrations && unverified.length > 0;
  const showCmsApp = canViewCms && !hasCmsApp(user) && !hideCmsApp;
  if (!showCreds && !showCmsApp) return null;

  return (
    <div className="tv-shell-banners">
      {showCreds ? (
        <Banner
          tone="error"
          title="Marketplace login could not be verified. Claims for these accounts will not be filed."
          actions={
            <button type="button" className="danger-button compact-button" onClick={() => goTo(unverified[0])}>
              Verify now
            </button>
          }
        >
          <div className="tv-chips" style={{ marginTop: 6 }}>
            {unverified.map((p) => (
              <button key={p} type="button" className="tv-chip" onClick={() => goTo(p)}>
                {toTitleCase(p)}
              </button>
            ))}
          </div>
        </Banner>
      ) : null}
      {showCmsApp ? (
        <Banner tone="info" onDismiss={() => setHideCmsApp(true)}>
          {CMS_APP_INSTALL_MESSAGE}{" "}
          <a className="tv-link" href={CMS_APP_GUIDE_URL} target="_blank" rel="noopener noreferrer">
            {CMS_APP_GUIDE_LINK_TEXT}
          </a>
          {" · "}
          <a className="tv-link" href={CMS_APP_DOWNLOAD_URL}>
            {CMS_APP_INSTALL_LINK_TEXT}
          </a>
        </Banner>
      ) : null}
    </div>
  );
}
