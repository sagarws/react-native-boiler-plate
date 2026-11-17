"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { CardHeading } from "@/components/ui/card-primitives";
import { PasswordField, TextField } from "@/components/ui/form-field";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { EmptyState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useIntegrationAccess } from "@/features/integrations/integration-access";
import { WHATSAPP_LABELS, WHATSAPP_PROVIDERS } from "@/features/integrations/provider-config";
import { errorMessage, toast } from "@/lib/events";
import { canAccess } from "@/lib/permissions";
import { WhatsAppService } from "@/services/whatsapp-service";
import { useSelector } from "@/store";
import type { WhatsAppConnectionStatus, WhatsAppProvider } from "@/types/integrations";

type DialogKind = "connect" | "update" | "view" | "disconnect";

const providerFlags = (source?: Partial<Record<WhatsAppProvider, boolean>>) =>
  Object.fromEntries(WHATSAPP_PROVIDERS.map((p) => [p, Boolean(source?.[p])])) as Record<WhatsAppProvider, boolean>;

const isValidHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (err) {
    // Not a URL at all: the caller shows the validation message.
    void err;
    return false;
  }
};

/**
 * TrackVid `components/settings/WhatsAppSettings`: provider tabs, global active banner, per-provider
 * connection card (status select, connect / view / update / disconnect dialogs). Exported for the
 * Settings route as well. Mount with `key={provider}` to restart on a different provider.
 */
export function WhatsAppSettings({ provider: initialProvider = "mark360" }: { provider?: WhatsAppProvider }) {
  const user = useSelector((s) => s.profile.userProfile);
  const canView = canAccess(user, ["admin"], ["whatsapp::view"]);
  const canEdit = canAccess(user, ["admin"], ["whatsapp::edit"]);
  const { isEnabled } = useIntegrationAccess();

  const [provider, setProvider] = useState<WhatsAppProvider>(initialProvider);
  const label = WHATSAPP_LABELS[provider];
  const isElevenZA = provider === "11za";
  const isKwikEngage = provider === "kwikengage";
  const isMark360 = provider === "mark360";
  // KwikEngage calls its secret an "API key"; the BE still takes it as `authToken`.
  const tokenLabel = isKwikEngage ? "API Key" : "Auth Token";
  const visibleProviders = WHATSAPP_PROVIDERS.filter((p) => p === provider || isEnabled(p));

  const [connectionStatus, setConnectionStatus] = useState<WhatsAppConnectionStatus | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [activeProviderGlobal, setActiveProviderGlobal] = useState<WhatsAppProvider | null>(null);
  const [configured, setConfigured] = useState(providerFlags());
  const [errored, setErrored] = useState(providerFlags());
  const [activeChoice, setActiveChoice] = useState<"active" | "inactive">("inactive");
  const [savingActiveChoice, setSavingActiveChoice] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);

  const [authToken, setAuthToken] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [originWebsite, setOriginWebsite] = useState("");
  const [merchantId, setMerchantId] = useState("");

  /** True while a save is in flight: the focus refetch must not overwrite the form being submitted. */
  const savingRef = useRef(false);
  /** Only the latest status fetch may write state (tab switch, focus and post-save fetches can overlap). */
  const fetchIdRef = useRef(0);

  const checkConnectionStatus = async (target: WhatsAppProvider) => {
    const myId = ++fetchIdRef.current;
    const isLatest = () => fetchIdRef.current === myId;
    try {
      const [activeRes, selectedRes] = await Promise.all([WhatsAppService.getActiveProvider(), WhatsAppService.getConnectionStatus(target)]);
      if (!isLatest()) return;
      if (activeRes.isSuccess) {
        setActiveProviderGlobal(activeRes.activeProvider);
        setConfigured(providerFlags(activeRes.configured));
        setErrored(providerFlags(activeRes.errored));
        setActiveChoice(activeRes.activeProvider === target ? "active" : "inactive");
      }
      const conn = selectedRes.isSuccess ? selectedRes.connection : undefined;
      if (conn) {
        setConnectionStatus(conn);
        if (conn.templateName) setTemplateName(conn.templateName);
        if (conn.organizationId) setOrganizationId(conn.organizationId);
        if (conn.originWebsite) setOriginWebsite(conn.originWebsite);
        if (conn.merchantId) setMerchantId(conn.merchantId);
      } else {
        setConnectionStatus(null);
      }
    } catch (err) {
      // Logged, not toasted: the banner keeps the last known state rather than flipping on one blip.
      console.error("[WhatsAppSettings] checkConnectionStatus failed", err);
      if (isLatest()) setConnectionStatus(null);
    } finally {
      if (isLatest()) {
        setHasLoadedOnce(true);
        setConnectionLoading(false);
      }
    }
  };

  const checkRef = useRef(checkConnectionStatus);
  const providerRef = useRef(provider);
  useEffect(() => {
    checkRef.current = checkConnectionStatus;
    providerRef.current = provider;
  });

  useEffect(() => {
    void checkRef.current(provider);
  }, [provider]);

  // Refetch on window focus to pick up changes made elsewhere (no polling); skipped during a save.
  useEffect(() => {
    const onFocus = () => {
      if (savingRef.current) return;
      void checkRef.current(providerRef.current);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  /** Tab switch: clear the form so a token typed for one provider is never sent to another. */
  const switchProvider = (next: WhatsAppProvider) => {
    if (next === provider) return;
    if (hasLoadedOnce) setActiveChoice(activeProviderGlobal === next ? "active" : "inactive");
    setAuthToken("");
    setTemplateName("");
    setOrganizationId("");
    setOriginWebsite("");
    setMerchantId("");
    setConnectionStatus(null);
    setConnectionLoading(true);
    setProvider(next);
  };

  const validateCommon = (): boolean => {
    if (!templateName.trim()) {
      toast.error("Please enter the template name");
      return false;
    }
    if (isElevenZA) {
      if (!originWebsite.trim()) {
        toast.error("Please enter the origin website");
        return false;
      }
      if (!isValidHttpUrl(originWebsite.trim())) {
        toast.error("Origin website must be a valid URL (e.g. https://example.com)");
        return false;
      }
    }
    return true;
  };

  const extras = () =>
    [
      isMark360 ? organizationId.trim() || undefined : undefined,
      isElevenZA ? originWebsite.trim() : undefined,
      isKwikEngage ? merchantId.trim() || undefined : undefined,
    ] as const;

  const handleConnect = async () => {
    if (!authToken.trim()) {
      toast.error(`Please enter the ${tokenLabel.toLowerCase()}`);
      return;
    }
    if (!validateCommon()) return;
    setIsConnecting(true);
    savingRef.current = true;
    try {
      const res = await WhatsAppService.connect(provider, authToken.trim(), templateName.trim(), ...extras());
      if (res.isSuccess) {
        toast.success(res.message || "Connected successfully");
        setDialog(null);
        setAuthToken("");
        void checkConnectionStatus(provider);
      } else {
        toast.error(res.message || "Connection failed");
      }
    } catch (err) {
      toast.error(errorMessage(err, "Connection failed"));
    } finally {
      setIsConnecting(false);
      savingRef.current = false;
    }
  };

  /** The token is optional on update: the seller may only change the template or the extra field. */
  const handleUpdate = async () => {
    if (!validateCommon()) return;
    setIsConnecting(true);
    savingRef.current = true;
    try {
      const res = await WhatsAppService.updateToken(provider, authToken.trim(), templateName.trim(), ...extras());
      if (res.isSuccess) {
        toast.success(res.message || "Token updated successfully");
        setDialog(null);
        setAuthToken("");
        void checkConnectionStatus(provider);
      } else {
        toast.error(res.message || "Update failed");
      }
    } catch (err) {
      toast.error(errorMessage(err, "Update failed"));
    } finally {
      setIsConnecting(false);
      savingRef.current = false;
    }
  };

  /** Active → setActive; Inactive → deactivate (soft toggle, keeps the credentials). */
  const handleSaveActiveChoice = async () => {
    if (!configured[provider]) {
      toast.error(`Connect ${label} first before changing its active state.`);
      return;
    }
    const currentlyActive = activeProviderGlobal === provider;
    if ((activeChoice === "active" && currentlyActive) || (activeChoice === "inactive" && !currentlyActive)) {
      toast.info(`No change — ${label} is already ${activeChoice}.`);
      return;
    }
    setSavingActiveChoice(true);
    savingRef.current = true;
    try {
      const res = activeChoice === "active" ? await WhatsAppService.setActive(provider) : await WhatsAppService.deactivate(provider);
      if (res.isSuccess) {
        toast.success(res.message || (activeChoice === "active" ? `${label} is now active` : `${label} deactivated`));
        await checkConnectionStatus(provider);
      } else {
        toast.error(res.message || (activeChoice === "active" ? "Failed to activate" : "Failed to deactivate"));
      }
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save active state"));
    } finally {
      setSavingActiveChoice(false);
      savingRef.current = false;
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    savingRef.current = true;
    try {
      const res = await WhatsAppService.disconnect(provider);
      if (res.isSuccess) {
        toast.success(res.promotedProvider ? `${label} disconnected. ${WHATSAPP_LABELS[res.promotedProvider]} is now active.` : res.message || `${label} disconnected`);
        setDialog(null);
        await checkConnectionStatus(provider);
      } else {
        toast.error(res.message || "Disconnect failed");
      }
    } catch (err) {
      toast.error(errorMessage(err, "Disconnect failed"));
    } finally {
      setIsDisconnecting(false);
      savingRef.current = false;
    }
  };

  if (!canView) {
    return <EmptyState icon="lock" title="No access" message="You don't have permission to view WhatsApp settings." />;
  }

  const activeIsErrored = Boolean(activeProviderGlobal && errored[activeProviderGlobal]);
  const bannerTone = activeIsErrored ? "red" : activeProviderGlobal ? "green" : "neutral";
  const isConfigured = configured[provider];
  const accountLine = connectionStatus?.businessAccountName || connectionStatus?.phoneNumber;

  const closeDialog = () => {
    setDialog(null);
    setAuthToken("");
  };

  const extraField = (mode: "connect" | "update") =>
    isKwikEngage ? (
      <TextField
        label="Merchant ID (optional)"
        placeholder="e.g. 6a0703f7314c64d443286f51"
        className="tv-mono"
        value={merchantId}
        onChange={(e) => setMerchantId(e.currentTarget.value)}
        hint={mode === "connect" ? "Your KwikEngage merchant ID" : "Leave unchanged to keep the existing merchant ID"}
      />
    ) : isElevenZA ? (
      <TextField
        label="Origin Website"
        placeholder="e.g. https://trackvid.in/"
        type="url"
        value={originWebsite}
        onChange={(e) => setOriginWebsite(e.currentTarget.value)}
        hint={mode === "connect" ? "The origin website registered in your 11za account" : "Leave unchanged to keep the existing origin website"}
      />
    ) : (
      <TextField
        label="Organization ID"
        placeholder="e.g. 69bd1cf544cb180aaf0b47c3"
        className="tv-mono"
        value={organizationId}
        onChange={(e) => setOrganizationId(e.currentTarget.value)}
        hint={mode === "connect" ? "Your Mark360 organization ID" : "Leave unchanged to keep the existing organization ID"}
      />
    );

  const statusLabel = (() => {
    const isThisActive = activeProviderGlobal === provider;
    if (connectionStatus?.status === "error" && isThisActive) return { text: "Active (Error)", tone: "red" };
    if (isThisActive) return { text: "Active", tone: "green" };
    if (isConfigured) return { text: "Inactive", tone: "tv-int-status-neutral" };
    return { text: "Not Connected", tone: "red" };
  })();

  return (
    <div className="tv-stack tv-int-whatsapp">
      <Tabs
        label="WhatsApp provider"
        value={provider}
        onChange={switchProvider}
        items={visibleProviders.map((p) => ({
          key: p,
          label: (
            <span className="tv-int-tab-label">
              <PlatformLogo name={p} showName={false} />
              {WHATSAPP_LABELS[p]}
            </span>
          ),
        }))}
      />

      <div className={`tv-int-active-banner is-${bannerTone}`} role="status">
        {!hasLoadedOnce ? (
          <>
            <span className="tv-spinner small" aria-hidden="true" />
            <span className="tv-muted">Loading active provider…</span>
          </>
        ) : (
          <>
            <span className="tv-int-dot" aria-hidden="true" />
            <span>
              Currently Active:{" "}
              <strong className="tv-int-active-name">
                {activeProviderGlobal ? WHATSAPP_LABELS[activeProviderGlobal] : "None"}
                {activeIsErrored ? " (Error)" : ""}
              </strong>
            </span>
            {activeProviderGlobal ? <span className={`c-status ${activeIsErrored ? "red" : "green"} tv-int-push`}>{activeIsErrored ? "Error" : "Live"}</span> : null}
          </>
        )}
      </div>

      {(connectionStatus?.status === "error" || connectionStatus?.status === "expired") && isConfigured ? (
        <div className="tv-banner error" role="alert">
          <Icon name="warning" />
          <div className="tv-banner-body">
            <strong>
              {label} {connectionStatus.status === "expired" ? "token expired" : "has an error"}
            </strong>
            <span>
              {connectionStatus.status === "expired" ? (
                <>
                  The {tokenLabel.toLowerCase()} has expired. Click <strong>Update</strong> below to re-enter a fresh one.
                </>
              ) : (
                <>
                  The last attempt failed — usually because the {tokenLabel.toLowerCase()} is invalid or the template name is missing. Click{" "}
                  <strong>Update</strong> below to re-enter credentials.
                </>
              )}
            </span>
          </div>
        </div>
      ) : null}

      <section className="glass-card tv-stack">
        <CardHeading
          title={
            <span className="tv-int-panel-title">
              <span className="icon-tile tile-success">
                <Icon name="link" />
              </span>
              {label} Connection
            </span>
          }
        />

        <div className="tv-int-subtle-row">
          <label className="tv-row tv-small" htmlFor="tv-int-wa-status">
            <strong className="tv-muted">Status</strong>
          </label>
          <select
            id="tv-int-wa-status"
            className="tv-int-select"
            value={activeChoice}
            onChange={(e) => setActiveChoice(e.currentTarget.value === "active" ? "active" : "inactive")}
            disabled={!isConfigured || savingActiveChoice}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            type="button"
            className="primary-button compact-button"
            onClick={() => void handleSaveActiveChoice()}
            disabled={!isConfigured || savingActiveChoice || !canEdit}
          >
            {savingActiveChoice ? "Saving..." : "Save"}
          </button>
          {!isConfigured ? <span className="tv-small tv-muted tv-int-push">Connect {label} first to use this control.</span> : null}
        </div>

        <div className="tv-int-connection-row">
          {connectionLoading ? (
            <span className="tv-int-center">
              <span className="tv-spinner" aria-label="Loading connection" />
            </span>
          ) : (
            <>
              <span className="tv-row">
                <span className={`tv-int-dot ${isConfigured ? "is-green" : ""}`} aria-hidden="true" />
                <strong>{isConfigured ? "Connected" : "Not Connected"}</strong>
                {isConfigured && accountLine ? <span className="tv-small tv-muted">{accountLine}</span> : null}
              </span>
              <span className="tv-row">
                {isConfigured ? (
                  <>
                    <button type="button" className="secondary-button compact-button" onClick={() => setDialog("view")}>
                      <Icon name="eye" /> View
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => {
                        setAuthToken("");
                        setDialog("update");
                      }}
                      disabled={!canEdit}
                    >
                      <Icon name="external-link" /> Update
                    </button>
                    <button type="button" className="danger-button compact-button" onClick={() => setDialog("disconnect")} disabled={isDisconnecting || !canEdit}>
                      <Icon name="x-circle" /> {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="primary-button compact-button"
                    onClick={() => {
                      setAuthToken("");
                      setDialog("connect");
                    }}
                    disabled={!canEdit}
                  >
                    <Icon name="link" /> Connect Account
                  </button>
                )}
              </span>
            </>
          )}
        </div>
      </section>

      {dialog === "connect" ? (
        <ProviderDialog
          title={`Connect ${label} Account`}
          subtitle={`Enter your ${tokenLabel.toLowerCase()} and template name to connect`}
          icon="link"
          primaryLabel={isConnecting ? "Connecting..." : "Connect Account"}
          primaryDisabled={!authToken.trim() || !templateName.trim() || (isElevenZA && !originWebsite.trim()) || isConnecting}
          busy={isConnecting}
          onPrimary={() => void handleConnect()}
          onClose={closeDialog}
        >
          <PasswordField
            label={tokenLabel}
            placeholder={`Paste your ${tokenLabel.toLowerCase()} here...`}
            className="tv-mono"
            autoComplete="off"
            value={authToken}
            onChange={(e) => setAuthToken(e.currentTarget.value)}
          />
          <TextField
            label="Template Name"
            placeholder="e.g. video_link"
            value={templateName}
            onChange={(e) => setTemplateName(e.currentTarget.value)}
            hint={`The WhatsApp template name approved in your ${label} dashboard`}
          />
          {extraField("connect")}
        </ProviderDialog>
      ) : null}

      {dialog === "update" ? (
        <ProviderDialog
          title={`Update ${label}`}
          subtitle={`Enter a new ${tokenLabel.toLowerCase()} or update other settings`}
          icon="external-link"
          primaryLabel={isConnecting ? "Updating..." : "Update"}
          primaryDisabled={!templateName.trim() || (isElevenZA && !originWebsite.trim()) || isConnecting}
          busy={isConnecting}
          onPrimary={() => void handleUpdate()}
          onClose={closeDialog}
        >
          <PasswordField
            label={`New ${tokenLabel} (optional)`}
            placeholder={`Leave blank to keep the existing ${tokenLabel.toLowerCase()}`}
            className="tv-mono"
            autoComplete="off"
            value={authToken}
            onChange={(e) => setAuthToken(e.currentTarget.value)}
            hint="Only fill this in if you want to replace the saved token"
          />
          <TextField
            label="Template Name"
            placeholder="e.g. video_link"
            value={templateName}
            onChange={(e) => setTemplateName(e.currentTarget.value)}
            hint="Leave unchanged to keep the existing template name"
          />
          {extraField("update")}
        </ProviderDialog>
      ) : null}

      {dialog === "view" ? (
        <ProviderDialog
          title="Connection Details"
          subtitle={`Your current ${label} integration status and details`}
          icon="eye"
          primaryLabel="Close"
          hideCancel
          onPrimary={() => setDialog(null)}
          onClose={() => setDialog(null)}
        >
          <dl className="tv-kv">
            <dt>{tokenLabel}</dt>
            <dd className="tv-mono">•••••••••••••••• (stored securely)</dd>
            {connectionStatus?.templateName ? (
              <>
                <dt>Template Name</dt>
                <dd className="tv-mono">{connectionStatus.templateName}</dd>
              </>
            ) : null}
            {isMark360 && connectionStatus?.organizationId ? (
              <>
                <dt>Organization ID</dt>
                <dd className="tv-mono">{connectionStatus.organizationId}</dd>
              </>
            ) : null}
            {isElevenZA && connectionStatus?.originWebsite ? (
              <>
                <dt>Origin Website</dt>
                <dd className="tv-mono">{connectionStatus.originWebsite}</dd>
              </>
            ) : null}
            {isKwikEngage && connectionStatus?.merchantId ? (
              <>
                <dt>Merchant ID</dt>
                <dd className="tv-mono">{connectionStatus.merchantId}</dd>
              </>
            ) : null}
          </dl>
          <div className="tv-int-subtle-row tv-row-between">
            <span className="tv-small tv-muted tv-int-caps">Connection Status</span>
            <span className={`c-status ${statusLabel.tone}`}>{statusLabel.text}</span>
          </div>
        </ProviderDialog>
      ) : null}

      {dialog === "disconnect" ? (
        <ProviderDialog
          title={`Disconnect ${label}?`}
          subtitle="Are you sure you want to disconnect this provider?"
          icon="x-circle"
          danger
          primaryLabel={isDisconnecting ? "Disconnecting..." : "Disconnect"}
          primaryDisabled={isDisconnecting}
          busy={isDisconnecting}
          onPrimary={() => void handleDisconnect()}
          onClose={() => setDialog(null)}
        >
          {accountLine ? (
            <div className="tv-int-subtle-row is-column">
              <span className="tv-small tv-muted tv-int-caps">Connected Account</span>
              <strong>{accountLine}</strong>
            </div>
          ) : null}
        </ProviderDialog>
      ) : null}
    </div>
  );
}

/** TrackVid `ProviderDialog`: icon + title + subtitle header, body, Cancel + primary footer. */
function ProviderDialog({
  title,
  subtitle,
  icon,
  danger = false,
  primaryLabel,
  primaryDisabled,
  busy = false,
  hideCancel = false,
  onPrimary,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  danger?: boolean;
  primaryLabel: string;
  primaryDisabled?: boolean;
  busy?: boolean;
  hideCancel?: boolean;
  onPrimary: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <AppDialog
      title={
        <span className="tv-int-dialog-head">
          <span className={`icon-tile ${danger ? "tile-danger" : "tile-blue"}`}>
            <Icon name={icon} />
          </span>
          <span className="tv-int-dialog-title">
            {title}
            {subtitle ? <small>{subtitle}</small> : null}
          </span>
        </span>
      }
      onClose={onClose}
      locked={busy}
      footer={
        <>
          {hideCancel ? null : (
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
          <button type="button" className={danger ? "danger-button" : "primary-button"} onClick={onPrimary} disabled={primaryDisabled}>
            {busy ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {primaryLabel}
          </button>
        </>
      }
    >
      <div className="tv-stack">{children}</div>
    </AppDialog>
  );
}
