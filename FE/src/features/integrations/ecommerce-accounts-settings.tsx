"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { Banner } from "@/components/ui/banner";
import { CardHeading } from "@/components/ui/card-primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { Tabs } from "@/components/ui/tabs";
import { CLOUDFLARE_EMAIL_SAVE_ERROR, isCloudflareEmailValid } from "@/config/app-constant";
import { AccountRow, type AccountField } from "@/features/integrations/account-row";
import { useIntegrationAccess } from "@/features/integrations/integration-access";
import { PROVIDER_CONFIGS, PROVIDER_ORDER, isEcommerceProvider } from "@/features/integrations/provider-config";
import { SessionDetailsDialog } from "@/features/integrations/session-details-dialog";
import { errorMessage, toast } from "@/lib/events";
import { CmsCredentialsService, SESSION_KEY_BY_PROVIDER } from "@/services/cms-credentials-service";
import { ecommerceAccountId, normalizePlatform, tatMasterSettingService } from "@/services/tatMasterSetting-service";
import { UserService } from "@/services/user-service";
import { useDispatch, useSelector } from "@/store";
import { setUserProfile } from "@/store/profile-slice";
import type { IUser } from "@/types/common";
import type { CredentialSession, EcommerceProvider, IAccount, IEcommerceAccountInfo } from "@/types/integrations";

type Row = IAccount & { rowKey: string };
type AccountsByProvider = Record<EcommerceProvider, Row[]>;

let newRowCounter = 0;

const emptyAccounts = (): AccountsByProvider => ({
  ajio: [],
  meesho: [],
  snapdeal: [],
  myntra: [],
  nykaa: [],
  flipkart: [],
  delhivery: [],
  xbees: [],
  tatacliq: [],
});

/**
 * Accounts from the profile. Passwords are not on the profile; they are filled in afterwards from
 * `UserService.getEcommerceCredentials` ("" keeps the inputs controlled meanwhile).
 */
function accountsFromProfile(user: IUser | null): AccountsByProvider {
  const next = emptyAccounts();
  if (!user?.company.settings.isUsingMasterData) return next;
  for (const login of user.company.settings.eCommercePlatformLoginInfo ?? []) {
    const provider = normalizePlatform(login.eComPlatform);
    if (!isEcommerceProvider(provider)) continue;
    const config = PROVIDER_CONFIGS[provider];
    login.info.forEach((acc: IEcommerceAccountInfo, i) => {
      // TrackVid only lists rows flagged `visible`; the sample profile has no flag, so a missing one counts as visible.
      if (acc.visible === false) return;
      const id = ecommerceAccountId(login._id, i, acc);
      next[provider].push({ ...acc, _id: id, rowKey: id, password: "", platform: config.eComPlatform, accountType: acc.accountType ?? "" });
    });
  }
  return next;
}

export function EcommerceAccountsSettings({
  provider,
  onProviderChange,
}: {
  provider: EcommerceProvider;
  onProviderChange: (provider: EcommerceProvider) => void;
}) {
  const dispatch = useDispatch();
  const userProfile = useSelector((s) => s.profile.userProfile);
  const isMasterData = Boolean(userProfile?.company.settings.isUsingMasterData);
  const { isEnabled } = useIntegrationAccess();
  // Only marketplaces this company has access to, but never drop the one that is open.
  const visibleProviders = PROVIDER_ORDER.filter((p) => p === provider || isEnabled(p));
  const config = PROVIDER_CONFIGS[provider];

  const [accountsByProvider, setAccountsByProvider] = useState<AccountsByProvider>(() => accountsFromProfile(userProfile));
  const [prevProfile, setPrevProfile] = useState(userProfile);
  if (prevProfile !== userProfile) {
    // A saved / removed account re-reads the profile, like TrackVid's `getUserProfile` round trip.
    setPrevProfile(userProfile);
    setAccountsByProvider(accountsFromProfile(userProfile));
  }

  const [busy, setBusy] = useState(false);
  const [sessionsById, setSessionsById] = useState<Record<string, CredentialSession | null>>({});
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [viewingSessionFor, setViewingSessionFor] = useState<Row | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Row | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Fill passwords by credential id. Only empty fields are filled, so a typed password is never replaced.
  useEffect(() => {
    if (!userProfile || !isMasterData) return;
    let cancelled = false;
    UserService.getEcommerceCredentials()
      .then((res) => {
        if (cancelled) return;
        const byId = new Map<string, string>();
        for (const login of userProfile.company.settings.eCommercePlatformLoginInfo ?? []) {
          const stored = login._id ? res[login._id] : undefined;
          if (!stored) continue;
          login.info.forEach((acc: IEcommerceAccountInfo, i) => {
            if (stored[i] !== undefined) byId.set(ecommerceAccountId(login._id, i, acc), stored[i]);
          });
        }
        if (byId.size === 0) return;
        setAccountsByProvider((prev) => {
          const filled = { ...prev };
          for (const key of PROVIDER_ORDER) {
            filled[key] = filled[key].map((acc) => (!acc.password && acc._id && byId.has(acc._id) ? { ...acc, password: byId.get(acc._id) ?? "" } : acc));
          }
          return filled;
        });
      })
      .catch((err: unknown) => {
        // Non-fatal: fields stay blank and saving keeps the stored passwords (blank means "unchanged").
        console.warn("[integrations] credential lookup failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [userProfile, isMasterData]);

  /** credentialId → session, flattened from the per-platform buckets (one fetch covers every tab). */
  const loadSessions = () =>
    CmsCredentialsService.getMyCompanyCredentials()
      .then((res) => {
        const next: Record<string, CredentialSession | null> = {};
        for (const key of PROVIDER_ORDER) {
          const sessionKey = SESSION_KEY_BY_PROVIDER[key];
          if (!sessionKey) continue;
          for (const cred of res.data[key] ?? []) next[cred.credentialId] = cred[sessionKey] ?? null;
        }
        setSessionsById(next);
      })
      .catch((err: unknown) => {
        // Deliberately silent (as in TrackVid): rows fall back to "No session"; the accounts stay editable.
        console.warn("[integrations] session lookup failed", err);
      })
      .finally(() => setSessionsLoading(false));

  const loadSessionsRef = useRef(loadSessions);
  useEffect(() => {
    loadSessionsRef.current = loadSessions;
  });
  useEffect(() => {
    void loadSessionsRef.current();
  }, []);

  // Deep links (`?provider=`) and tab switches bring the accounts panel into view.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [provider]);

  const refreshProfile = async () => {
    const user = await UserService.getUser();
    dispatch(setUserProfile(user));
  };

  const setAccountsFor = (key: EcommerceProvider, updater: (prev: Row[]) => Row[]) =>
    setAccountsByProvider((prev) => ({ ...prev, [key]: updater(prev[key]) }));

  const handleChange = (index: number, field: AccountField, value: string) =>
    setAccountsFor(provider, (prev) => prev.map((acc, i) => (i === index ? { ...acc, [field]: value } : acc)));

  const handleAdd = () => {
    newRowCounter += 1;
    setAccountsFor(provider, (prev) => [
      ...prev,
      {
        rowKey: `new-${newRowCounter}`,
        platform: config.eComPlatform,
        username: "",
        password: "",
        is_verified: false,
        accountType: config.defaultAccountType ?? "",
        ...(config.showVendorCode ? { vendorCode: "" } : {}),
        ...(config.showPhoneNumber ? { phoneNumber: "" } : {}),
        ...(config.showCloudflareEmail ? { cloudflareEmail: "" } : {}),
      },
    ]);
  };

  const removePersisted = async (account: Row) => {
    if (!userProfile || !account._id) return;
    const loginInfo = (userProfile.company.settings.eCommercePlatformLoginInfo ?? []).find(
      (l) => normalizePlatform(l.eComPlatform) === provider,
    );
    setBusy(true);
    try {
      const res = await tatMasterSettingService.masterRemoveAjio({
        companyId: userProfile.companyId,
        accountId: account._id,
        eCommercePlatformLoginInfoId: loginInfo?._id,
      });
      if (res.isSuccess) {
        toast.success(res.displayMessage);
        setConfirmRemove(null);
        await refreshProfile();
      } else {
        toast.error(res.displayMessage);
      }
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove the account."));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = (index: number) => {
    const account = accountsByProvider[provider][index];
    if (!account) return;
    if (!account._id) {
      setAccountsFor(provider, (prev) => prev.filter((_, i) => i !== index));
      return;
    }
    setConfirmRemove(account);
  };

  const handleSaveAll = async () => {
    if (!userProfile) return;
    const list = accountsByProvider[provider];
    const info: IEcommerceAccountInfo[] = list
      .filter((a) => a.username)
      .map((a) => ({
        _id: a._id,
        username: a.username,
        password: a.password,
        is_verified: a.is_verified,
        accountType: a.accountType || config.defaultAccountType || "",
        ...(config.showVendorCode ? { vendorCode: a.vendorCode ?? "" } : {}),
        ...(config.showPhoneNumber ? { phoneNumber: (a.phoneNumber ?? "").trim() } : {}),
        ...(config.showCloudflareEmail ? { cloudflareEmail: (a.cloudflareEmail ?? "").trim() } : {}),
      }));

    if (info.length === 0) {
      toast.error(`Please add at least one ${config.eComPlatform} account.`);
      return;
    }
    // The BE stores an invalid inbox as "" without an error, so block Save here instead.
    if (config.showCloudflareEmail && list.some((a) => a.username && !isCloudflareEmailValid(a.cloudflareEmail))) {
      toast.error(CLOUDFLARE_EMAIL_SAVE_ERROR);
      return;
    }
    // IMPORT_PLATFORM stores every platform lowercase except AJIO.
    const eComPlatform = config.eComPlatform === "AJIO" ? config.eComPlatform : config.eComPlatform.toLowerCase();

    setBusy(true);
    try {
      const res = await tatMasterSettingService.MaterTatSetting({ companyId: userProfile.companyId, eCommercePlatformLoginInfo: [{ eComPlatform, info }] });
      if (res.isSuccess) {
        toast.success(res.displayMessage);
        await refreshProfile();
        void loadSessions();
      } else {
        toast.error(res.displayMessage);
      }
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the accounts."));
    } finally {
      setBusy(false);
    }
  };

  /** Forces a fresh portal login for one credential; the row spins, the rest of the page stays usable. */
  const handleRenew = async (account: Row) => {
    if (!account._id || renewingId) return;
    setRenewingId(account._id);
    toast.info(`Logging in to ${config.label} as ${account.username || "this account"} — this takes up to a minute…`);
    try {
      const res = await CmsCredentialsService.renewSession({ platform: provider, credentialId: account._id });
      if (res.isSuccess) toast.success(res.displayMessage || "Session renewed");
      else toast.error(res.displayMessage || "Session renewal failed");
    } catch (err) {
      toast.error(errorMessage(err, "Session renewal failed"));
    } finally {
      setRenewingId(null);
      // Refetch on success and failure: a failed renewal can still change what is stored.
      void loadSessions();
    }
  };

  const accounts = accountsByProvider[provider];
  const description =
    provider === "nykaa"
      ? "Please add the credentials of Nykaa Fashion Dispute Support portal"
      : provider === "tatacliq"
        ? "Save All signs in to the Tata CLiQ seller portal to verify each login id and password. It stops as soon as the portal asks for the OTP — you don't need to enter one here."
        : `Manage your ${config.label} accounts used for imports and claim workflows.`;

  return (
    <div className="tv-stack tv-int-accounts">
      <Tabs
        label="Marketplace"
        value={provider}
        onChange={onProviderChange}
        items={visibleProviders.map((p) => ({
          key: p,
          label: (
            <span className="tv-int-tab-label">
              <PlatformLogo name={PROVIDER_CONFIGS[p].logo} showName={false} />
              {PROVIDER_CONFIGS[p].label}
            </span>
          ),
        }))}
      />

      {!isMasterData ? (
        <Banner tone="warning" title="Master Data is currently disabled">
          Enable Master Data from <strong>Settings → Ecommerce Settings</strong> to start managing {config.label} accounts here.
        </Banner>
      ) : null}

      <section ref={panelRef} className="glass-card tv-int-panel" aria-busy={busy} aria-labelledby="tv-int-accounts-title">
        <CardHeading
          title={
            <span className="tv-int-panel-title" id="tv-int-accounts-title">
              <PlatformLogo name={config.logo} showName={false} large />
              {config.label} Accounts
            </span>
          }
        />
        <div className="tv-row-between tv-int-panel-bar">
          <p className="tv-muted tv-small">{description}</p>
          <div className="tv-row">
            <button type="button" className="secondary-button compact-button" onClick={handleAdd} disabled={!isMasterData || busy}>
              <Icon name="plus" /> Add Account
            </button>
            {accounts.length > 0 ? (
              <button type="button" className="primary-button compact-button" onClick={() => void handleSaveAll()} disabled={!isMasterData || busy}>
                {busy ? <span className="tv-spinner small" aria-hidden="true" /> : null}
                Save All
              </button>
            ) : null}
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="tv-int-empty">{config.emptyText}</div>
        ) : (
          <div className="tv-stack">
            {accounts.map((account, index) => (
              <AccountRow
                key={account.rowKey}
                index={index}
                account={account}
                config={config}
                disabled={busy}
                session={sessionsById[account._id ?? ""] ?? null}
                sessionLoading={sessionsLoading}
                renewing={renewingId !== null && renewingId === account._id}
                renewBusy={renewingId !== null}
                onChange={(field, value) => handleChange(index, field, value)}
                onRemove={() => handleRemove(index)}
                onRenew={() => void handleRenew(account)}
                onViewSession={() => setViewingSessionFor(account)}
              />
            ))}
          </div>
        )}

        {busy ? (
          <div className="tv-int-busy" role="status" aria-label="Saving">
            <span className="tv-spinner" aria-hidden="true" />
          </div>
        ) : null}
      </section>

      {viewingSessionFor ? (
        <SessionDetailsDialog
          platformLabel={config.label}
          username={viewingSessionFor.username}
          session={sessionsById[viewingSessionFor._id ?? ""] ?? null}
          onClose={() => setViewingSessionFor(null)}
        />
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          title="Remove account?"
          message={
            <>
              Remove <strong>{confirmRemove.username || "this account"}</strong> from {config.label}? Claims for this account will no longer be filed
              automatically.
            </>
          }
          confirmLabel="Remove"
          danger
          busy={busy}
          onConfirm={() => void removePersisted(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      ) : null}
    </div>
  );
}
