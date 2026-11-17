"use client";

import { Icon } from "@/components/icons/icon";
import { PasswordField, SelectField, TextField } from "@/components/ui/form-field";
import { CLOUDFLARE_EMAIL_HELPER_TEXT, CLOUDFLARE_EMAIL_INVALID_TEXT, isCloudflareEmailValid } from "@/config/app-constant";
import { TEMP_PERMIT } from "@/config/constant";
import type { ProviderConfig } from "@/features/integrations/provider-config";
import { SessionChip } from "@/features/integrations/session-chip";
import { describeSessionAge } from "@/features/integrations/session-state";
import type { CredentialSession, IAccount } from "@/types/integrations";

export type AccountField = "username" | "password" | "accountType" | "vendorCode" | "phoneNumber" | "cloudflareEmail";

/** One seller login row (TrackVid `AccountRow`): fields, verified pill, session cluster, remove. */
export function AccountRow({
  index,
  account,
  config,
  disabled,
  session,
  sessionLoading,
  renewing,
  renewBusy,
  onChange,
  onRemove,
  onRenew,
  onViewSession,
}: {
  index: number;
  account: IAccount;
  config: ProviderConfig;
  disabled: boolean;
  session: CredentialSession | null;
  sessionLoading: boolean;
  renewing: boolean;
  /** Another row is renewing (one login at a time). */
  renewBusy: boolean;
  onChange: (field: AccountField, value: string) => void;
  onRemove: () => void;
  onRenew: () => void;
  onViewSession: () => void;
}) {
  const verified = account.is_verified;
  // A row only just added has no id yet, so there is nothing to renew or inspect until Save All.
  const persisted = Boolean(account._id);
  const showSession = persisted && config.supportsSession !== false;
  const cloudflareOk = isCloudflareEmailValid(account.cloudflareEmail);
  const n = index + 1;

  return (
    <div className="tv-int-account">
      <span className="tv-int-account-index" aria-hidden="true">
        {n}
      </span>
      <div className="tv-int-account-fields">
        <TextField
          label={config.usernameLabel}
          required
          value={account.username}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => onChange("username", e.currentTarget.value)}
          aria-label={`${config.usernameLabel} for account ${n}`}
        />
        <PasswordField
          label="Password"
          required
          value={account.password}
          disabled={disabled}
          autoComplete="new-password"
          onChange={(e) => onChange("password", e.currentTarget.value)}
          aria-label={`Password for account ${n}`}
        />
        {config.showAccountType ? (
          <SelectField
            label="Type"
            value={account.accountType || config.defaultAccountType || ""}
            options={config.accountTypeOptions ?? []}
            disabled={disabled}
            onChange={(e) => onChange("accountType", e.currentTarget.value)}
          />
        ) : null}
        {config.showVendorCode ? (
          <TextField
            label={config.vendorCodeLabel ?? "Vendor Code"}
            required
            value={account.vendorCode ?? ""}
            disabled={disabled}
            onChange={(e) => onChange("vendorCode", e.currentTarget.value)}
          />
        ) : null}
        {config.showPhoneNumber ? (
          <TextField
            label={config.phoneNumberLabel ?? "Callback Number"}
            required
            type="tel"
            inputMode="tel"
            value={account.phoneNumber ?? ""}
            disabled={disabled}
            onChange={(e) => onChange("phoneNumber", e.currentTarget.value)}
          />
        ) : null}
        {config.showCloudflareEmail ? (
          <TextField
            label={config.cloudflareEmailLabel ?? "Cloudflare Access email"}
            type="email"
            placeholder="name@yourcompany.com"
            value={account.cloudflareEmail ?? ""}
            disabled={disabled}
            error={cloudflareOk ? null : CLOUDFLARE_EMAIL_INVALID_TEXT}
            hint={CLOUDFLARE_EMAIL_HELPER_TEXT}
            onChange={(e) => onChange("cloudflareEmail", e.currentTarget.value)}
          />
        ) : null}
      </div>

      <div className="tv-int-account-meta">
        <span
          className={`c-status ${verified ? "green" : "red"} tv-int-verified`}
          title={verified ? "Verified" : "Username/Email or Password is not verified"}
        >
          <Icon name={verified ? "check-circle" : "warning"} />
          {verified ? "Verified" : "Unverified"}
        </span>

        {showSession ? (
          <span className="tv-int-session">
            <span
              title={
                sessionLoading
                  ? "Checking stored session…"
                  : session
                    ? `Expires ${describeSessionAge(session.expiresAt)}`
                    : "No login session cached yet — press Renew to create one"
              }
            >
              <SessionChip session={session} override={renewing ? "Renewing…" : sessionLoading ? "Checking…" : undefined} />
            </span>
            {/* Renew spends a real portal login (rate-limit / bot-check sensitive), so it stays an ops tool. */}
            {TEMP_PERMIT ? (
              <button
                type="button"
                className="icon-button tv-int-row-button"
                onClick={onRenew}
                disabled={renewing || renewBusy}
                aria-label="Renew session"
                title={renewing ? "Logging in… this can take up to a minute" : "Log in again and cache a fresh session (takes up to a minute)"}
              >
                {renewing ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="refresh" />}
              </button>
            ) : null}
            <button type="button" className="icon-button tv-int-row-button" onClick={onViewSession} aria-label="Session details" title="Session details">
              <Icon name="file-text" />
            </button>
          </span>
        ) : null}

        <button
          type="button"
          className="icon-button tv-int-row-button is-danger"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove account ${n}`}
          title="Remove account"
        >
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}
