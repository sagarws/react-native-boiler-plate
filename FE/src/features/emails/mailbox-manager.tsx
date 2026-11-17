"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { CardHeading, IconTile, ProgressBar, ToneBadge } from "@/components/ui/card-primitives";
import { TextField } from "@/components/ui/form-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import ROUTE_URLS from "@/config/route";
import { toast } from "@/lib/events";
import { formatRelative } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { useAsync } from "@/lib/use-async";
import { MailboxService } from "@/services/mailbox-service";
import { useSelector } from "@/store";
import type { MailFetchFolder, Mailbox, MailboxProvider } from "@/types/emails";
import {
  MAIL_FETCH_FOLDER_HELP,
  MAIL_FETCH_FOLDER_LABELS,
  SINGLE_EMAIL_POLLING_ENABLED,
  mailboxStatusTones,
  readErrorMessage,
  toDateTimeLocalValue,
  validateLastSyncValue,
} from "./email-helpers";
import { PasswordMailboxForm } from "./password-mailbox-form";
import { UpdatePasswordModal } from "./update-password-modal";
import { ZohoConnectModal } from "./zoho-connect-modal";

/**
 * "Connected Mailboxes" section of TrackVid `IntegrationsSettings.tsx`: list, add (app password /
 * Outlook OAuth / Zoho OAuth), fetch folder, manual sync + last sync date, update password,
 * reconnect, logs and remove. Exported so the Settings route can reuse it.
 */

interface LastSyncState {
  mailboxId: string;
  mailboxEmail: string;
  mailboxCreatedAt: string;
  value: string;
}

/** Mock UI: the OAuth start URL is always "configured" (TrackVid checks `VITE_APP_BASE_URL`). */
const OAUTH_CONFIGURED = true;

export function MailboxManager({ onChanged }: { onChanged?: () => void }) {
  const user = useSelector((s) => s.profile.userProfile);
  const canViewMailboxes = canAccess(user, ["admin"], ["email::mailbox::view"]);
  const canEditMailboxes = canAccess(user, ["admin"], ["email::mailbox::edit"]);

  const list = useAsync(() => MailboxService.listMailboxes(), []);
  const folder = useAsync(() => MailboxService.getMailFetchFolder(), []);
  const [folderOverride, setFolderOverride] = useState<MailFetchFolder | null>(null);
  const [folderSaving, setFolderSaving] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<MailboxProvider>("google");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [zohoOpen, setZohoOpen] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastSync, setLastSync] = useState<LastSyncState | null>(null);
  const [lastSyncSaving, setLastSyncSaving] = useState(false);
  const [passwordFor, setPasswordFor] = useState<{ mailboxId: string; mailboxEmail: string } | null>(null);

  const mailboxes = list.data?.mailboxes ?? [];
  const mailFetchFolder: MailFetchFolder = folderOverride ?? folder.data?.data.mailFetchFolder ?? "inbox";
  const folderOptions: MailFetchFolder[] = folder.data?.data.options ?? ["inbox", "allMail"];

  // Simulated progress while a manual sync runs (the server answers only when the poll is done).
  useEffect(() => {
    if (!syncingId) return;
    const timer = window.setInterval(() => setSyncProgress((p) => Math.min(92, p + 7)), 180);
    return () => window.clearInterval(timer);
  }, [syncingId]);

  const reloadAll = () => {
    list.reload();
    onChanged?.();
  };

  const handleFolderChange = async (next: MailFetchFolder) => {
    if (!canEditMailboxes || next === mailFetchFolder) return;
    const previous = mailFetchFolder;
    setFolderOverride(next);
    setFolderSaving(true);
    try {
      const res = await MailboxService.updateMailFetchFolder(next);
      const saved = res.data.mailFetchFolder ?? next;
      setFolderOverride(saved);
      toast.success(`Fetching from ${MAIL_FETCH_FOLDER_LABELS[saved] ?? saved}. It applies from the next sync.`);
    } catch (err) {
      setFolderOverride(previous);
      toast.error(readErrorMessage(err, "Failed to update the fetch folder"));
    } finally {
      setFolderSaving(false);
    }
  };

  /** TrackVid opens the provider page in a new tab; the mock simulates consent and the callback. */
  const handleConnect = async (providerId: "outlook") => {
    if (!OAUTH_CONFIGURED) {
      toast.error("Mailbox OAuth URL is not configured. Please contact support.");
      return;
    }
    if (pendingProvider) return;
    setPendingProvider(providerId);
    toast.info("Opening provider authorization…");
    try {
      await MailboxService.startOAuthConnect(providerId);
      toast.success("Mailbox connected successfully.");
      reloadAll();
    } catch (err) {
      toast.error(readErrorMessage(err, "Failed to open provider authorization page."));
    } finally {
      setPendingProvider(null);
    }
  };

  const handleReconnect = async (mailbox: Mailbox) => {
    if (!canEditMailboxes) {
      toast.error("You don't have permission to modify mailboxes.");
      return;
    }
    if (reconnectingId) return;
    setReconnectingId(mailbox._id);
    toast.info("Redirecting to provider to refresh access…");
    try {
      await MailboxService.startOAuthConnect(mailbox.provider === "google" ? "google" : "outlook", mailbox._id);
      toast.success("Mailbox connected successfully.");
      reloadAll();
    } catch (err) {
      toast.error(readErrorMessage(err, "Failed to open provider authorization page."));
    } finally {
      setReconnectingId(null);
    }
  };

  const handleManualSync = async (mailboxId: string) => {
    if (!canEditMailboxes) {
      toast.error("You don't have permission to modify mailboxes.");
      return;
    }
    if (syncingId) return;
    setSyncProgress(4);
    setSyncingId(mailboxId);
    toast.info("Syncing mailbox…");
    try {
      const res = await MailboxService.syncMailbox(mailboxId);
      const result = res.data;
      if (result.fetchedCount > 0) {
        toast.success(`Fetched ${result.fetchedCount} email(s) for ${result.email}` + (result.unrepliedCount ? ` — ${result.unrepliedCount} awaiting reply` : ""));
      } else {
        // 0 fetched is normal on a mailbox the server already polls — say whether anything was found.
        const skipped = Object.values(result.skipped ?? {}).reduce((t, c) => t + c, 0);
        toast.success(
          result.scanned > 0
            ? `Scanned ${result.scanned} email(s), none new — ${skipped} filtered (see logs).`
            : "No matching emails in the sync window. Check the last sync date.",
        );
      }
      reloadAll();
    } catch (err) {
      toast.error(readErrorMessage(err, "Failed to sync mailbox"));
    } finally {
      setSyncingId(null);
      setSyncProgress(0);
    }
  };

  const handleSaveLastSync = async () => {
    if (!lastSync) return;
    const validation = validateLastSyncValue(lastSync.value, lastSync.mailboxCreatedAt);
    if (validation) {
      toast.error(validation);
      return;
    }
    setLastSyncSaving(true);
    try {
      // Empty input clears the watermark — the next sync starts from the connection time.
      const iso = lastSync.value ? new Date(lastSync.value).toISOString() : null;
      await MailboxService.updateMailboxLastSync(lastSync.mailboxId, iso);
      toast.success(iso ? "Last sync date updated." : "Last sync date cleared.");
      setLastSync(null);
      list.reload();
    } catch (err) {
      toast.error(readErrorMessage(err, "Failed to update last sync date"));
    } finally {
      setLastSyncSaving(false);
    }
  };

  const handleRemove = async (mailboxId: string) => {
    if (!canEditMailboxes) {
      toast.error("You don't have permission to modify mailboxes.");
      return;
    }
    if (removingId) return;
    setRemovingId(mailboxId);
    try {
      await MailboxService.removeMailbox(mailboxId);
      toast.success("Mailbox removed");
      list.setData((prev) => (prev ? { mailboxes: prev.mailboxes.filter((m) => m._id !== mailboxId) } : prev));
      onChanged?.();
    } catch (err) {
      toast.error(readErrorMessage(err, "Failed to remove mailbox"));
    } finally {
      setRemovingId(null);
    }
  };

  if (!canViewMailboxes) {
    return (
      <section className="glass-card tv-emails-mailboxes">
        <CardHeading title="Connected Mailboxes" />
        <p className="tv-muted">You don&apos;t have permission to view mailbox integrations. Please contact your administrator.</p>
      </section>
    );
  }

  const lastSyncError = lastSync ? validateLastSyncValue(lastSync.value, lastSync.mailboxCreatedAt) : "";
  const lastSyncMin = lastSync ? toDateTimeLocalValue(lastSync.mailboxCreatedAt || null) : "";
  const lastSyncMax = toDateTimeLocalValue(new Date().toISOString());
  const connectedAtLabel = lastSync?.mailboxCreatedAt ? new Date(lastSync.mailboxCreatedAt).toLocaleString() : "";

  let body;
  if (list.loading && !list.data) body = <LoadingState label="Loading mailboxes…" />;
  else if (list.error) body = <ErrorState message={list.error} onRetry={list.reload} title="Failed to load mailboxes" />;
  else if (mailboxes.length === 0 && !showPasswordForm)
    body = (
      <EmptyState
        icon="envelope"
        title="No mailboxes connected yet"
        message={
          <>
            Click <strong>Add Mailbox</strong> to connect your first AJIO inbox.
          </>
        }
      />
    );
  else
    body = (
      <ul className="tv-emails-mailbox-list">
        {mailboxes.map((mb) => {
          const showReconnect = mb.authType === "oauth" && (mb.status === "token_expired" || mb.status === "error");
          const lastSynced = mb.inboxSync?.lastSyncedAt ? formatRelative(mb.inboxSync.lastSyncedAt) : null;
          const details = `Type: ${mb.type ?? "—"}\nIMAP: ${mb.config?.imapHost || "—"}\nSMTP: ${mb.config?.smtpHost || "—"}`;
          const syncing = syncingId === mb._id;
          return (
            <li key={mb._id} className="tv-emails-mailbox">
              <div className="tv-emails-mailbox-identity">
                <IconTile name="envelope" tone="info" />
                <div className="tv-emails-mailbox-text">
                  <div className="tv-row">
                    <strong className="tv-ellipsis">{mb.displayName || mb.email}</strong>
                    <StatusPill value={mb.status.replace("_", " ")} tone={mailboxStatusTones[mb.status]} />
                    <ToneBadge label={mb.authType === "oauth" ? "OAuth" : "Password"} tone={mb.authType === "oauth" ? "success" : "blue"} />
                  </div>
                  <div className="tv-emails-mailbox-meta">
                    <span>{mb.email}</span>
                    <span className="tv-emails-dot" aria-hidden="true" />
                    <span className="tv-emails-capital">{mb.provider}</span>
                    {lastSynced ? (
                      <>
                        <span className="tv-emails-dot" aria-hidden="true" />
                        <span>Synced {lastSynced}</span>
                      </>
                    ) : null}
                    <span className="tv-emails-info" title={details} aria-label={details} role="img">
                      <Icon name="info" />
                    </span>
                  </div>
                  {syncing ? <ProgressBar value={syncProgress} tone="blue" /> : null}
                </div>
              </div>
              <div className="tv-emails-mailbox-actions">
                {SINGLE_EMAIL_POLLING_ENABLED ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      disabled={!canEditMailboxes || Boolean(syncingId) || mb.status !== "connected"}
                      onClick={() => void handleManualSync(mb._id)}
                    >
                      {syncing ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="refresh" />}
                      Sync
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Change last sync date"
                      aria-label={`Change last sync date for ${mb.email}`}
                      disabled={!canEditMailboxes}
                      onClick={() =>
                        setLastSync({
                          mailboxId: mb._id,
                          mailboxEmail: mb.email,
                          mailboxCreatedAt: mb.createdAt ?? "",
                          value: toDateTimeLocalValue(mb.inboxSync?.lastSyncedAt),
                        })
                      }
                    >
                      <Icon name="calendar" />
                    </button>
                  </>
                ) : null}
                {mb.authType === "password" ? (
                  <button
                    type="button"
                    className="icon-button"
                    title="Update password"
                    aria-label={`Update password for ${mb.email}`}
                    disabled={!canEditMailboxes}
                    onClick={() => setPasswordFor({ mailboxId: mb._id, mailboxEmail: mb.email })}
                  >
                    <Icon name="key" />
                  </button>
                ) : null}
                {showReconnect ? (
                  <button
                    type="button"
                    className="icon-button tv-emails-warn"
                    title={reconnectingId === mb._id ? "Opening…" : "Reconnect"}
                    aria-label={`Reconnect ${mb.email}`}
                    disabled={!canEditMailboxes || reconnectingId === mb._id}
                    onClick={() => void handleReconnect(mb)}
                  >
                    {reconnectingId === mb._id ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="plug" />}
                  </button>
                ) : null}
                <Link className="icon-button" title="View logs" aria-label={`View logs for ${mb.email}`} href={ROUTE_URLS.MAILBOX_LOGS.replace(":mailboxId", mb._id)}>
                  <Icon name="file-text" />
                </Link>
                <button
                  type="button"
                  className="icon-button tv-emails-danger"
                  title="Remove mailbox"
                  aria-label={`Remove ${mb.email}`}
                  disabled={!canEditMailboxes || removingId === mb._id}
                  onClick={() => void handleRemove(mb._id)}
                >
                  {removingId === mb._id ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="trash" />}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );

  return (
    <section className="glass-card tv-emails-mailboxes" aria-label="Connected Mailboxes">
      <div className="tv-row-between tv-emails-mailboxes-head">
        <div>
          <h2 className="tv-section-title">Connected Mailboxes</h2>
          <p className="tv-muted tv-small">Connect mailboxes that should receive AJIO email automation.</p>
        </div>
        <div className="tv-row">
          <label className="c-filter" title={MAIL_FETCH_FOLDER_HELP}>
            <span className="tv-emails-filter-label">Fetch From</span>
            <select
              value={mailFetchFolder}
              aria-label="Fetch From"
              disabled={!canEditMailboxes || folderSaving}
              onChange={(e) => void handleFolderChange(e.currentTarget.value as MailFetchFolder)}
            >
              {folderOptions.map((o) => (
                <option key={o} value={o}>
                  {MAIL_FETCH_FOLDER_LABELS[o] ?? o}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary-button" onClick={() => list.reload()} disabled={list.loading}>
            <Icon name="refresh" />
            Refresh
          </button>
          {!showPasswordForm ? (
            <button type="button" className="primary-button" disabled={!canEditMailboxes} onClick={() => setProviderDialogOpen(true)}>
              <Icon name="plus" />
              Add Mailbox
            </button>
          ) : null}
        </div>
      </div>

      {showPasswordForm ? (
        <div className="tv-emails-form-wrap">
          <PasswordMailboxForm
            initialProvider={selectedProvider}
            onSuccess={() => {
              setShowPasswordForm(false);
              reloadAll();
            }}
            onCancel={() => setShowPasswordForm(false)}
          />
        </div>
      ) : null}

      {body}

      {providerDialogOpen ? (
        <AppDialog
          title={
            <span className="tv-emails-dialog-title">
              Connect Mailbox
              <small>Choose how you&apos;d like to authenticate.</small>
            </span>
          }
          size="sm"
          onClose={() => setProviderDialogOpen(false)}
          footer={
            <button type="button" className="secondary-button" onClick={() => setProviderDialogOpen(false)}>
              Cancel
            </button>
          }
        >
          <div className="tv-emails-methods">
            <button
              type="button"
              className="tv-emails-method"
              onClick={() => {
                setProviderDialogOpen(false);
                setSelectedProvider("google");
                setShowPasswordForm(true);
              }}
            >
              <IconTile name="key" tone="blue" />
              <span>
                <strong>Email App Password</strong>
                <small>Connect Gmail, Yahoo or any IMAP/SMTP mailbox with an app password.</small>
              </span>
            </button>
            <button
              type="button"
              className="tv-emails-method"
              disabled={!OAUTH_CONFIGURED || pendingProvider === "outlook"}
              onClick={() => {
                setProviderDialogOpen(false);
                void handleConnect("outlook");
              }}
            >
              <IconTile name="external-link" tone="success" />
              <span>
                <strong>Outlook (OAuth)</strong>
                <small>Connect Outlook and Microsoft 365 accounts via OAuth 2.0.</small>
              </span>
            </button>
            <button
              type="button"
              className="tv-emails-method"
              onClick={() => {
                setProviderDialogOpen(false);
                setZohoOpen(true);
              }}
            >
              <IconTile name="envelope" tone="coral" />
              <span>
                <strong>Zoho Mail (OAuth)</strong>
                <small>Connect Zoho Mail / Zoho Workplace accounts via OAuth 2.0.</small>
              </span>
            </button>
          </div>
        </AppDialog>
      ) : null}

      {zohoOpen ? (
        <ZohoConnectModal
          onClose={() => setZohoOpen(false)}
          onAuthorized={() => {
            toast.success("Mailbox connected successfully.");
            reloadAll();
          }}
        />
      ) : null}

      {passwordFor ? (
        <UpdatePasswordModal
          mailboxId={passwordFor.mailboxId}
          mailboxEmail={passwordFor.mailboxEmail}
          onClose={() => setPasswordFor(null)}
          onSuccess={reloadAll}
        />
      ) : null}

      {lastSync ? (
        <AppDialog
          title={
            <span className="tv-emails-dialog-title">
              Change last sync date
              <small>{lastSync.mailboxEmail}</small>
            </span>
          }
          size="sm"
          locked={lastSyncSaving}
          onClose={() => setLastSync(null)}
          footer={
            <>
              <button type="button" className="secondary-button" disabled={lastSyncSaving} onClick={() => setLastSync(null)}>
                Cancel
              </button>
              <button type="button" className="primary-button" disabled={lastSyncSaving || Boolean(lastSyncError)} onClick={() => void handleSaveLastSync()}>
                {lastSyncSaving ? <span className="tv-spinner small" aria-hidden="true" /> : null}
                Save
              </button>
            </>
          }
        >
          <div className="tv-stack">
            <TextField
              label="Last synced at"
              type="datetime-local"
              value={lastSync.value}
              min={lastSyncMin || undefined}
              max={lastSyncMax}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setLastSync((prev) => (prev ? { ...prev, value } : prev));
              }}
              error={lastSyncError || null}
            />
            <p className="tv-muted tv-small">
              The next sync fetches mail received after this moment. Leave it empty to clear the watermark and start from the mailbox connection time. Emails
              already replied to are never answered twice.
              {connectedAtLabel ? ` Earliest allowed: ${connectedAtLabel} — when this mailbox was connected.` : ""}
            </p>
          </div>
        </AppDialog>
      ) : null}
    </section>
  );
}
