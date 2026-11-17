// @ts-nocheck
import { Fragment, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { showToast } from "@/lib/events";
import { readPreference, savePreference } from "@/lib/store/preferences";

export function ProviderConnectionDialog({ connection, onClose, onSaved }) {
  const r = readPreference(`connection-${connection.id}`, {
    secretRef: connection.env,
    webhookSecretRef: connection.webhookEnv || "",
    environment: "Sandbox",
    settlementSchedule: "Provider default",
    accountLabel: "",
    descriptor: "",
  });
  const [i, a] = useState(r.secretRef || connection.env);
  const [o, s] = useState(r.webhookSecretRef || connection.webhookEnv || "");
  const [c, u] = useState(r.environment || "Sandbox");
  const [d, f] = useState(r.settlementSchedule || "Provider default");
  const [p, m] = useState(r.accountLabel || "");
  const [h, g] = useState(r.descriptor || "");
  const [_, v] = useState("");
  const y = connection.category === "Payments";
  return (
    <AppDialog
      title={`Configure ${connection.name}`}
      onClose={onClose}
      wide={y}
      className={y ? "payment-provider-form-dialog" : ""}
    >
      <form
        className="c-form payment-provider-form"
        data-c-form="connection"
        data-id={connection.id}
        onSubmit={(t) => {
          t.preventDefault();
          if (/^[A-Z][A-Z0-9_]*$/.test(i)) {
            if (o && !/^[A-Z][A-Z0-9_]*$/.test(o)) {
              v("Use an environment variable name for the webhook secret.");
            } else {
              savePreference(`connection-${connection.id}`, {
                secretRef: i,
                webhookSecretRef: o,
                environment: c,
                settlementSchedule: d,
                accountLabel: p,
                descriptor: h,
              });
              showToast(
                "Configuration saved. No provider connection has been claimed or enabled.",
              );
              onSaved();
            }
          } else {
            v("Enter an environment variable name, not an API key.");
          }
        }}
      >
        <p>
          Store actual secrets on your server. This form saves only
          environment-variable names and non-sensitive operating preferences.
        </p>
        <div className="c-form-grid">
          <ProviderConnectionField
            label="API secret environment name"
            value={i}
            onChange={a}
            required
            pattern="[A-Z][A-Z0-9_]*"
          />
          <label className="c-field">
            <span>Environment</span>
            <select value={c} onChange={(e) => u(e.currentTarget.value)}>
              <option>Sandbox</option>
              <option>Production</option>
            </select>
          </label>
          {y ? (
            <Fragment>
              <ProviderConnectionField
                label="Webhook secret environment name"
                value={o}
                onChange={s}
                pattern="[A-Z][A-Z0-9_]*"
              />
              <label className="c-field">
                <span>Settlement schedule</span>
                <select value={d} onChange={(e) => f(e.currentTarget.value)}>
                  <option>Provider default</option>
                  <option>Automatic daily</option>
                  <option>Automatic weekly</option>
                  <option>Manual review</option>
                </select>
              </label>
              <ProviderConnectionField
                label="Destination account label"
                value={p}
                onChange={m}
              />
              <ProviderConnectionField
                label="Statement descriptor"
                value={h}
                onChange={g}
              />
            </Fragment>
          ) : null}
        </div>
        <p className="c-form-error" role="alert">
          {_}
        </p>
        <div className="c-form-footer">
          <button type="submit" className="primary-button">
            Save configuration
          </button>
        </div>
      </form>
    </AppDialog>
  );
}

function ProviderConnectionField({
  label,
  value,
  onChange,
  required = false,
  pattern,
}) {
  return (
    <label className="c-field">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type="text"
        required={required}
        pattern={pattern}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}
