"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { Banner } from "@/components/ui/banner";
import { PageHeading } from "@/components/ui/page-heading";
import { platformLogoUrl } from "@/components/ui/platform-logo";
import { LoadingState } from "@/components/ui/states";
import ROUTE_URLS from "@/config/route";
import { BaseIntegrationDialog } from "@/features/integrations/base-integration-dialog";
import { EcommerceAccountsSettings } from "@/features/integrations/ecommerce-accounts-settings";
import { GoogleConsentDialog } from "@/features/integrations/google-drive/google-consent-dialog";
import { GoogleDriveManageDialog } from "@/features/integrations/google-drive/google-drive-manage-dialog";
import { useGoogleDrive } from "@/features/integrations/google-drive/use-google-drive";
import { IntegrationCard } from "@/features/integrations/integration-card";
import { isIntegrationKey, useIntegrationAccess } from "@/features/integrations/integration-access";
import {
  PROVIDER_CONFIGS,
  PROVIDER_ORDER,
  WHATSAPP_CARD_ORDER,
  WHATSAPP_LABELS,
  isEcommerceProvider,
  isWhatsAppProvider,
  normalizeProviderParam,
} from "@/features/integrations/provider-config";
import { useAsync } from "@/lib/use-async";
import { WhatsAppService } from "@/services/whatsapp-service";
import { useSelector } from "@/store";
import type { EcommerceProvider, IntegrationStatus } from "@/types/integrations";
import { WhatsAppSettings } from "@/features/integrations/whatsapp-settings";

const BASE_PATH = ROUTE_URLS.INTEGRATIONS;

/**
 * TrackVid `pages/Integrations.tsx`: integration cards gated by `company.settings.integrationAccess`,
 * and the `?provider=<key>` sub-views (marketplace accounts, WhatsApp provider settings).
 * Uses search params: render inside <Suspense>.
 */
export function IntegrationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userProfile = useSelector((s) => s.profile.userProfile);
  const { isEnabled, enabledCount } = useIntegrationAccess();

  const rawProvider = searchParams.get("provider");
  const normalized = normalizeProviderParam(rawProvider);
  // A provider the company has no access to is dropped outright, so its sub-view never mounts.
  const providerParam = normalized && isIntegrationKey(normalized) && isEnabled(normalized) ? normalized : null;

  // Strip a ?provider= the company cannot use (e.g. a bookmark made before it was turned off).
  // Waits for the profile: before it loads every key reads as "no access".
  useEffect(() => {
    if (!userProfile) return;
    if (rawProvider && !providerParam) router.replace(BASE_PATH);
  }, [userProfile, rawProvider, providerParam, router]);

  const onCards = providerParam === null || (!isWhatsAppProvider(providerParam) && !isEcommerceProvider(providerParam));
  // Re-read on every return to the cards (TrackVid refetches after leaving the WhatsApp settings).
  const wa = useAsync(() => WhatsAppService.getActiveProvider(), [onCards]);

  const googleDrive = useGoogleDrive();
  const [baseDialogOpen, setBaseDialogOpen] = useState(false);
  const [driveDialogOpen, setDriveDialogOpen] = useState(false);

  const openProvider = (key: string) => router.push(`${BASE_PATH}?provider=${key}`);
  const backToCards = () => router.push(BASE_PATH);

  const consentDialog = googleDrive.consentOpen ? (
    <GoogleConsentDialog busy={googleDrive.connecting} onAnswer={(r) => void googleDrive.finishConsent(r)} onClose={googleDrive.cancelConsent} />
  ) : null;

  if (isWhatsAppProvider(providerParam)) {
    return (
      <div className="tv-page">
        <PageHeading
          title={`${WHATSAPP_LABELS[providerParam]} WhatsApp`}
          crumbs={[{ label: "Integrations", href: BASE_PATH }]}
          actions={
            <button type="button" className="secondary-button" onClick={backToCards}>
              <Icon name="arrow-left" /> Back to Integrations
            </button>
          }
        />
        <WhatsAppSettings key={providerParam} provider={providerParam} />
      </div>
    );
  }

  if (isEcommerceProvider(providerParam)) {
    return (
      <div className="tv-page">
        <PageHeading
          title={PROVIDER_CONFIGS[providerParam].label}
          crumbs={[{ label: "Integrations", href: BASE_PATH }]}
          actions={
            <button type="button" className="secondary-button" onClick={backToCards}>
              <Icon name="arrow-left" /> Back to Integrations
            </button>
          }
        />
        <EcommerceAccountsSettings provider={providerParam} onProviderChange={(next: EcommerceProvider) => openProvider(next)} />
      </div>
    );
  }

  const heading = (
    <PageHeading title="Integrations" subtitle="Set up integrations to automate emails, marketplace imports, and customer notifications." />
  );

  if (wa.loading && !wa.data) {
    return (
      <div className="tv-page">
        {heading}
        <section className="glass-card">
          <LoadingState label="Loading integrations" />
        </section>
        {consentDialog}
      </div>
    );
  }

  const configured = wa.data?.configured;
  const waStatus = (p: "11za" | "mark360" | "kwikengage"): IntegrationStatus => (configured?.[p] ? "connected" : "available");
  const activeProvider = wa.data?.activeProvider ?? null;

  const driveState = googleDrive.status?.status ?? "not_connected";
  const baseConnected = Boolean(userProfile?.company.baseLinkToken);
  const isMasterData = Boolean(userProfile?.company.settings.isUsingMasterData);

  return (
    <div className="tv-page">
      {heading}

      {wa.error ? (
        <Banner
          tone="warning"
          title="Could not load WhatsApp status"
          actions={
            <button type="button" className="secondary-button compact-button" onClick={wa.reload}>
              <Icon name="refresh" /> Retry
            </button>
          }
        >
          {wa.error}
        </Banner>
      ) : null}

      <section aria-labelledby="tv-int-connect-title" className="tv-stack">
        <h2 id="tv-int-connect-title" className="tv-section-title">
          Connect your tools
        </h2>
        {/* Google Drive is not an integrationAccess key: Scan and Pack needs it, so it is always shown. */}
        <div className="tv-int-grid">
          <IntegrationCard
            icon="folder"
            logoSrc={platformLogoUrl("google-drive")}
            title="Google Drive"
            description={
              googleDrive.loading && !googleDrive.status
                ? "Checking Google Drive connection…"
                : googleDrive.error && !googleDrive.status
                  ? `Could not check Google Drive connection. ${googleDrive.error}`
                  : driveState === "connected"
                  ? `Scan and Pack PDFs are saved in ${googleDrive.status?.email ?? "your Google Drive"}, one folder per week, cleared automatically.`
                  : driveState === "token_expired"
                    ? "Google Drive access has expired. Reconnect it to keep using Scan and Pack."
                    : "Connect your Google Drive to store Scan and Pack label and invoice PDFs. Required for Scan and Pack."
            }
            buttonText={driveState === "not_connected" ? "Connect" : "Manage"}
            primary={driveState === "connected"}
            onClick={() => {
              if (driveState === "not_connected") void googleDrive.connect();
              else setDriveDialogOpen(true);
            }}
            status={driveState === "connected" ? "connected" : "available"}
          />
        </div>
      </section>

      {enabledCount === 0 ? (
        <div className="tv-int-empty is-large">
          <strong>No other integrations enabled</strong>
          <span>
            Your workspace doesn&apos;t have any marketplace or messaging integrations turned on yet. Contact TrackVid support to enable the ones you need.
          </span>
        </div>
      ) : (
        <div className="tv-int-grid">
          {isEnabled("email") ? (
            <IntegrationCard
              icon="envelope"
              title="Email"
              description="Connect your email forwarder and automate workflow rules for incoming and outgoing messages."
              buttonText="Manage"
              primary
              onClick={() => router.push(`${ROUTE_URLS.SETTINGS}?tab=integrations`)}
              status="enabled"
            />
          ) : null}

          {PROVIDER_ORDER.filter((p) => isEnabled(p)).map((p) => (
            <IntegrationCard
              key={p}
              icon={p === "delhivery" || p === "xbees" ? "truck" : "storefront"}
              logoSrc={platformLogoUrl(PROVIDER_CONFIGS[p].logo)}
              title={PROVIDER_CONFIGS[p].cardTitle}
              description={PROVIDER_CONFIGS[p].cardDescription}
              buttonText="Manage"
              primary
              onClick={() => openProvider(p)}
              status={isMasterData ? "enabled" : "available"}
            />
          ))}

          {isEnabled("base") ? (
            <IntegrationCard
              icon="package"
              logoSrc={platformLogoUrl("base")}
              title="Base.com"
              description="Connect Base.com OMS so TrackVid video links appear directly inside your Base.com order rows."
              buttonText={baseConnected ? "Manage" : "Connect"}
              primary={baseConnected}
              onClick={() => setBaseDialogOpen(true)}
              status={baseConnected ? "connected" : "available"}
            />
          ) : null}

          {WHATSAPP_CARD_ORDER.filter((p) => isEnabled(p)).map((p) => (
            <IntegrationCard
              key={p}
              icon="chats-circle"
              whatsapp
              logoSrc={platformLogoUrl(p)}
              title={`${WHATSAPP_LABELS[p]} WhatsApp`}
              description={`Send instant, automated order updates to customers via the ${WHATSAPP_LABELS[p]} WhatsApp Business platform.`}
              buttonText={waStatus(p) === "connected" ? "Manage" : "Connect"}
              primary={waStatus(p) === "connected"}
              onClick={() => openProvider(p)}
              status={waStatus(p)}
              isActive={activeProvider === p}
            />
          ))}
        </div>
      )}

      <section className="tv-stack tv-int-soon" aria-labelledby="tv-int-soon-title">
        <div>
          <h2 id="tv-int-soon-title" className="tv-int-soon-title">
            Coming Soon
          </h2>
          <p className="tv-small tv-muted">We&apos;re working on adding more integrations to help you do more.</p>
        </div>
        <div className="tv-int-grid">
          {["Interakt WhatsApp"].map((name) => (
            <div key={name} className="tv-int-soon-card">
              <span className="icon-tile tile-neutral">
                <Icon name="chats-circle" />
              </span>
              <span>
                <strong>{name}</strong>
                <small>Coming soon</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      {baseDialogOpen ? <BaseIntegrationDialog onClose={() => setBaseDialogOpen(false)} /> : null}

      {driveDialogOpen ? (
        <GoogleDriveManageDialog
          status={googleDrive.status}
          connecting={googleDrive.connecting}
          disconnecting={googleDrive.disconnecting}
          onConnect={() => {
            setDriveDialogOpen(false);
            void googleDrive.connect();
          }}
          onDisconnect={googleDrive.disconnect}
          onClose={() => setDriveDialogOpen(false)}
        />
      ) : null}

      {consentDialog}
    </div>
  );
}
