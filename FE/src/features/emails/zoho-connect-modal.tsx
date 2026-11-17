"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { PasswordField, SelectField, TextField } from "@/components/ui/form-field";
import { LoadingState } from "@/components/ui/states";
import { copyText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { MailboxService } from "@/services/mailbox-service";

/**
 * TrackVid `ZohoConnectModal.tsx`. Zoho data centres must match the BE's SUPPORTED_LOCATIONS.
 * Mount only while open: unmounting wipes the client secret from memory.
 */
const DATA_CENTERS = [
  { value: "in", label: "India (.in)" },
  { value: "com", label: "United States (.com)" },
  { value: "eu", label: "Europe (.eu)" },
  { value: "com.au", label: "Australia (.com.au)" },
  { value: "jp", label: "Japan (.jp)" },
  { value: "ca", label: "Canada (.ca)" },
  { value: "sa", label: "Saudi Arabia (.sa)" },
  { value: "uk", label: "United Kingdom (.uk)" },
] as const;

export function ZohoConnectModal({ onClose, onAuthorized }: { onClose: () => void; onAuthorized: () => void }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [location, setLocation] = useState("in");
  const [redirectUri, setRedirectUri] = useState("");
  const [suggestedRedirectUri, setSuggestedRedirectUri] = useState("");
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    MailboxService.getZohoSettings()
      .then((data) => {
        if (cancelled) return;
        setClientId(data.clientId ?? "");
        setLocation(data.location || "in");
        setRedirectUri(data.redirectUri ?? "");
        setSuggestedRedirectUri(data.suggestedRedirectUri ?? "");
        setHasStoredSecret(Boolean(data.hasClientSecret));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, "Unable to load Zoho settings"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const consoleUrl = `https://api-console.zoho.${location || "in"}/`;
  const consoleLabel = `api-console.zoho.${location || "in"}`;
  const homepageHint = typeof window === "undefined" ? "" : window.location.origin;

  const handleCopyRedirect = async () => {
    if (!redirectUri) return;
    if (await copyText(redirectUri)) toast.success("Callback URL copied");
    else toast.error("Could not copy — select and copy it manually");
  };

  const handleConnect = async () => {
    setError(null);
    if (!clientId.trim()) {
      setError("Client ID is required.");
      return;
    }
    // An empty secret is only allowed when reusing the one already on file; the server re-checks this.
    if (!clientSecret.trim() && !hasStoredSecret) {
      setError("Client Secret is required.");
      return;
    }
    if (!redirectUri.trim()) {
      setError("Redirect URI is required and must match your Zoho console entry.");
      return;
    }
    setConnecting(true);
    try {
      const callback = new URL(window.location.href);
      callback.searchParams.set("tab", "mailboxes");
      callback.searchParams.set("connected", "1");
      const data = await MailboxService.startZohoConnect({
        clientId: clientId.trim(),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        redirectUri: redirectUri.trim(),
        location,
        callbackUrl: callback.toString(),
      });
      if (!data.url) {
        setError("Server did not return a Zoho authorization URL.");
        return;
      }
      // Only accept https://accounts.zoho.* so a bad response cannot become an open redirect.
      let parsed: URL;
      try {
        parsed = new URL(data.url);
      } catch {
        // Unparseable URL from the server.
        setError("Server returned an invalid Zoho authorization URL.");
        return;
      }
      if (parsed.protocol !== "https:" || !parsed.hostname.startsWith("accounts.zoho.")) {
        setError("Unexpected authorization host — refusing to redirect.");
        return;
      }
      // Mock UI: no redirect to Zoho; the service already simulated consent + callback.
      setClientSecret("");
      onClose();
      onAuthorized();
    } catch (err) {
      setError(errorMessage(err, "Failed to start Zoho authorization. Check your credentials."));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <AppDialog
      title={
        <span className="tv-emails-dialog-title">
          Connect Zoho Mail
          <small>Enter your Zoho API credentials, then authorize the mailbox.</small>
        </span>
      }
      size="md"
      onClose={onClose}
      locked={connecting}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={connecting}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void handleConnect()} disabled={loading || connecting}>
            {connecting ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {connecting ? "Redirecting…" : "Authorize with Zoho"}
          </button>
        </>
      }
    >
      {loading ? (
        <LoadingState label="Loading Zoho settings…" />
      ) : (
        <div className="tv-stack">
          <Banner
            tone="info"
            title="Where do these come from?"
            actions={
              <button type="button" className="secondary-button compact-button" aria-expanded={showGuide} onClick={() => setShowGuide((s) => !s)}>
                {showGuide ? "Less" : "More"}
                <Icon name={showGuide ? "caret-up" : "caret-down"} />
              </button>
            }
          >
            <p>
              Create a <strong>Server-based Application</strong> at{" "}
              <a className="tv-link" href={consoleUrl} target="_blank" rel="noopener noreferrer">
                {consoleLabel}
              </a>
              . The <strong>Redirect URI below must match the one in your Zoho console character for character</strong> — Zoho compares them as exact strings.
            </p>
            {showGuide ? (
              <>
                <ol className="tv-emails-guide">
                  <li>
                    Open{" "}
                    <a className="tv-link" href={consoleUrl} target="_blank" rel="noopener noreferrer">
                      {consoleLabel}
                    </a>{" "}
                    and click <strong>ADD CLIENT</strong> (top right of the Applications list).
                  </li>
                  <li>
                    On <strong>Choose a Client Type</strong>, pick <strong>Server-based Applications</strong> → <strong>CREATE NOW</strong>.
                  </li>
                  <li>
                    Fill in <strong>Create New Client</strong>:
                    <ul>
                      <li>
                        <strong>Client Name</strong> — anything, e.g. <code>TrackVid</code>
                      </li>
                      <li>
                        <strong>Homepage URL</strong> — where TrackVid runs, e.g. <code>{homepageHint}</code>
                      </li>
                      <li>
                        <strong>Authorized Redirect URIs</strong> — paste the Redirect URI from the field below, exactly as shown
                      </li>
                    </ul>
                    Then click <strong>CREATE</strong>.
                  </li>
                  <li>
                    Back on <strong>Applications</strong>, click the client you just created.
                  </li>
                  <li>
                    Open its <strong>Client Secret</strong> tab (next to Client Details).
                  </li>
                  <li>
                    Copy <strong>Client ID</strong> and <strong>Client Secret</strong> into the fields below, select the <strong>Data Center</strong> your Zoho account
                    is on, then <strong>Authorize with Zoho</strong>.
                  </li>
                </ol>
                <p className="tv-small">
                  <em>
                    Your Zoho console lives on one data centre only. If yours opens on a different domain (for example api-console.zoho.com), change the{" "}
                    <strong>Data Center</strong> below to match — the TLDs have to agree or the token exchange fails.
                  </em>
                </p>
              </>
            ) : null}
          </Banner>

          <div className="tv-emails-copy-field">
            <TextField
              label="Redirect URI"
              required
              value={redirectUri}
              placeholder="https://your-backend/api/mailboxes/zoho/callback"
              onChange={(e) => setRedirectUri(e.currentTarget.value)}
              hint={
                suggestedRedirectUri && redirectUri !== suggestedRedirectUri
                  ? `This server expects callbacks at ${suggestedRedirectUri}`
                  : "Copy this into your Zoho console's Authorized Redirect URIs."
              }
            />
            <button type="button" className="icon-button" title="Copy" aria-label="Copy redirect URI" disabled={!redirectUri} onClick={() => void handleCopyRedirect()}>
              <Icon name="copy" />
            </button>
          </div>
          <TextField label="Client ID" required value={clientId} placeholder="1000.XXXXXXXXXXXXXXXXXXXXXXXXXX" onChange={(e) => setClientId(e.currentTarget.value)} />
          <PasswordField
            label="Client Secret"
            required={!hasStoredSecret}
            value={clientSecret}
            autoComplete="off"
            placeholder={hasStoredSecret ? "Leave blank to reuse the saved secret" : "Zoho client secret"}
            hint={hasStoredSecret ? "A secret is already saved — leave blank to keep using it." : undefined}
            onChange={(e) => setClientSecret(e.currentTarget.value)}
          />
          <SelectField label="Data Center" value={location} options={DATA_CENTERS} onChange={(e) => setLocation(e.currentTarget.value)} />
          {error ? (
            <Banner tone="error" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          ) : null}
        </div>
      )}
    </AppDialog>
  );
}
