"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { Banner } from "@/components/ui/banner";
import { PasswordField, SelectField, TextField } from "@/components/ui/form-field";
import { toast } from "@/lib/events";
import { MailboxConnectionError, MailboxService } from "@/services/mailbox-service";
import type { MailboxProvider, ProviderConfig } from "@/types/emails";

/** TrackVid `PasswordMailboxForm.tsx`: connect a mailbox with an app password (test first, then save). */

interface ProviderLink {
  name: string;
  link2FA?: string;
  linkAppPassword: string;
  instructions: string;
}

const PROVIDER_LINKS: Record<MailboxProvider, ProviderLink> = {
  google: {
    name: "Gmail",
    link2FA: "https://myaccount.google.com/signinoptions/two-step-verification",
    linkAppPassword: "https://myaccount.google.com/apppasswords",
    instructions: "Step 1: Enable 2-Factor Authentication. Step 2: Generate App Password.",
  },
  outlook: {
    name: "Outlook",
    linkAppPassword: "https://account.microsoft.com/security",
    instructions: "Use your Microsoft account password (no app password needed)",
  },
  yahoo: {
    name: "Yahoo",
    link2FA: "https://login.yahoo.com/account/security",
    linkAppPassword: "https://login.yahoo.com/account/security",
    instructions: "Step 1: Enable 2-Step Verification. Step 2: Generate App Password.",
  },
  zoho: {
    name: "Zoho",
    linkAppPassword: "https://accounts.zoho.com/home#security",
    instructions: "Generate an app-specific password in Account Security",
  },
  other: { name: "Other", linkAppPassword: "", instructions: "Contact your email provider for IMAP/SMTP settings" },
};

const PROVIDER_DEFAULTS: Record<MailboxProvider, { imapHost: string; imapPort: string; smtpHost: string; smtpPort: string }> = {
  google: { imapHost: "imap.gmail.com", imapPort: "993", smtpHost: "smtp.gmail.com", smtpPort: "465" },
  outlook: { imapHost: "outlook.office365.com", imapPort: "993", smtpHost: "smtp.office365.com", smtpPort: "587" },
  yahoo: { imapHost: "imap.mail.yahoo.com", imapPort: "993", smtpHost: "smtp.mail.yahoo.com", smtpPort: "465" },
  zoho: { imapHost: "imap.zoho.com", imapPort: "993", smtpHost: "smtp.zoho.com", smtpPort: "465" },
  other: { imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465" },
};

const PROVIDER_OPTIONS = [
  { value: "google", label: "Gmail" },
  { value: "outlook", label: "Outlook / Office 365" },
  { value: "yahoo", label: "Yahoo Mail" },
  { value: "zoho", label: "Zoho Mail" },
  { value: "other", label: "Other (Custom)" },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PasswordMailboxForm({
  onSuccess,
  onCancel,
  initialProvider = "google",
}: {
  onSuccess: () => void;
  onCancel: () => void;
  initialProvider?: MailboxProvider;
}) {
  const provider = initialProvider;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hosts, setHosts] = useState(() => PROVIDER_DEFAULTS[provider]);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  // Provider is fixed while the form is open (the select is disabled, as in TrackVid); load its hosts once.
  useEffect(() => {
    let cancelled = false;
    MailboxService.getProviderConfig(provider)
      .then((res) => {
        if (cancelled || !res.success) return;
        setProviderConfig(res.config);
        setHosts({
          imapHost: res.config.imapHost,
          imapPort: String(res.config.imapPort),
          smtpHost: res.config.smtpHost,
          smtpPort: String(res.config.smtpPort),
        });
      })
      .catch(() => {
        // Keep the built-in defaults when the provider config cannot be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const validateEmail = (value: string): boolean => {
    if (!value) {
      setEmailError("Email is required");
      return false;
    }
    if (!EMAIL_RE.test(value)) {
      setEmailError("Please enter a valid email address");
      return false;
    }
    setEmailError("");
    return true;
  };

  const validatePassword = (value: string): boolean => {
    if (!value) {
      setPasswordError("App password is required");
      return false;
    }
    setPasswordError("");
    return true;
  };

  const connection = () => ({
    imapHost: hosts.imapHost || providerConfig?.imapHost,
    imapPort: hosts.imapPort ? parseInt(hosts.imapPort, 10) : providerConfig?.imapPort || 993,
    smtpHost: hosts.smtpHost || providerConfig?.smtpHost,
    smtpPort: hosts.smtpPort ? parseInt(hosts.smtpPort, 10) : providerConfig?.smtpPort || 465,
  });

  const handleTestConnection = async () => {
    setError(null);
    setEmailError("");
    setPasswordError("");
    const okEmail = validateEmail(email);
    const okPassword = validatePassword(password);
    if (!okEmail || !okPassword) return;
    setTesting(true);
    try {
      const res = await MailboxService.testConnection({ email: email.trim(), password: password.trim(), ...connection() });
      if (res.success) {
        setTestSuccess(true);
        toast.success("Connection successful! You can now save.");
      }
    } catch (err) {
      const details = err instanceof Error && err.message ? err.message : "Connection failed. Please check your credentials.";
      setError(details);
      setTestSuccess(false);
      if (err instanceof MailboxConnectionError && err.field === "imap") setPasswordError(`IMAP Error: ${err.details}`);
      else if (err instanceof MailboxConnectionError && err.field === "smtp") toast.error(`SMTP Error: ${err.details}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!testSuccess) {
      toast.error("Please test the connection first");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await MailboxService.addPasswordMailbox({
        email: email.trim(),
        password: password.trim(),
        displayName: displayName.trim() || email.trim(),
        provider,
        ...connection(),
      });
      if (res.success) {
        toast.success("Mailbox connected successfully! Emails will start syncing.");
        onSuccess();
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Failed to add mailbox";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const info = PROVIDER_LINKS[provider];

  return (
    <form className="tv-emails-password-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
      <h3 className="tv-card-title">Connect Email with App Password</h3>
      <div className="tv-stack">
        <SelectField label="Email Provider" value={provider} options={PROVIDER_OPTIONS} disabled onChange={() => undefined} />
        <TextField
          label="Email Address"
          type="email"
          required
          value={email}
          placeholder="user@gmail.com"
          autoComplete="off"
          onChange={(e) => {
            const v = e.currentTarget.value;
            setEmail(v);
            if (emailError) validateEmail(v);
          }}
          onBlur={(e) => validateEmail(e.currentTarget.value)}
          error={emailError || null}
        />
        {info.linkAppPassword ? (
          <Banner tone="info" title="How to get an App Password?">
            {info.link2FA ? (
              <p>
                <strong>Step 1:</strong>{" "}
                <a className="tv-link" href={info.link2FA} target="_blank" rel="noopener noreferrer">
                  Enable 2-Factor Authentication
                </a>
              </p>
            ) : null}
            <p>
              {info.link2FA ? <strong>Step 2: </strong> : null}
              <a className="tv-link" href={info.linkAppPassword} target="_blank" rel="noopener noreferrer">
                {info.link2FA ? "Generate App Password" : `${info.name} Instructions`}
              </a>
            </p>
            <small className="tv-muted">{info.instructions}</small>
          </Banner>
        ) : null}
        <PasswordField
          label="App Password"
          required
          value={password}
          placeholder="Enter your app password"
          autoComplete="new-password"
          onChange={(e) => {
            const v = e.currentTarget.value;
            setPassword(v);
            if (passwordError) validatePassword(v);
          }}
          onBlur={(e) => validatePassword(e.currentTarget.value)}
          error={passwordError || null}
          hint="Mock: any 16-character app password passes; one containing “smtp” fails the SMTP check."
        />
        <TextField label="Display Name (Optional)" value={displayName} placeholder="My Gmail Account" onChange={(e) => setDisplayName(e.currentTarget.value)} />

        <div>
          <button type="button" className="secondary-button compact-button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((s) => !s)}>
            <Icon name={showAdvanced ? "caret-up" : "caret-down"} />
            Advanced Settings
          </button>
          {showAdvanced ? (
            <div className="c-form-grid tv-emails-advanced">
              <TextField label="IMAP Host" value={hosts.imapHost} placeholder={providerConfig?.imapHost || "imap.gmail.com"} disabled readOnly hint="Pre-configured for selected provider" />
              <TextField label="IMAP Port" type="number" value={hosts.imapPort} placeholder={String(providerConfig?.imapPort || 993)} disabled readOnly />
              <TextField label="SMTP Host" value={hosts.smtpHost} placeholder={providerConfig?.smtpHost || "smtp.gmail.com"} disabled readOnly hint="Pre-configured for selected provider" />
              <TextField label="SMTP Port" type="number" value={hosts.smtpPort} placeholder={String(providerConfig?.smtpPort || 465)} disabled readOnly />
            </div>
          ) : null}
        </div>

        {testSuccess ? (
          <Banner tone="success" title="Connection Successful">
            Your credentials are valid. Click Save to add this mailbox.
          </Banner>
        ) : null}
        {error ? (
          <Banner tone="error" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        ) : null}

        <div className="tv-emails-form-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={loading || testing}>
            Cancel
          </button>
          <button type="button" className="secondary-button" onClick={() => void handleTestConnection()} disabled={loading || testing || !email || !password}>
            {testing ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <button type="submit" className="primary-button" disabled={loading || testing || !testSuccess}>
            {loading ? <span className="tv-spinner small" aria-hidden="true" /> : null}
            {loading ? "Saving..." : "Save Mailbox"}
          </button>
        </div>
      </div>
    </form>
  );
}
