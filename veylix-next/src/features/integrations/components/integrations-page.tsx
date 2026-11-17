// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { StatusPill } from "@/components/ui/status-pill";
import { modulesById } from "@/config/modules/registry";
import { IntegrationGuideDialog } from "@/features/integrations/components/integration-guide-dialog";
import { PaymentProvidersOverview } from "@/features/integrations/components/payment-providers-overview";
import { ProviderConnectionDialog } from "@/features/integrations/components/provider-connection-dialog";
import { integrationProviders } from "@/features/integrations/data";
import { checkAiServerHealth } from "@/lib/ai-client";
import { buildHref } from "@/lib/navigation";
import { readPreference } from "@/lib/store/preferences";

export function IntegrationsPage({ moduleId }) {
  const t = modulesById[moduleId];
  const [n, r] = useState(null);
  const [i, a] = useState(0);
  const [o, s] = useState(null);
  const [c, u] = useState({});
  const d = useMemo(
    () =>
      t.kind === "providers"
        ? integrationProviders.filter((e) => e.category === "Payments")
        : integrationProviders,
    [t.kind],
  );
  const f = (e) => {
    if (c[e.id]) return c[e.id];
    const t = readPreference(`connection-${e.id}`, {});
    return t.secretRef
      ? `Configuration saved · ${t.secretRef}`
      : "No connection configured";
  };
  const p = async (e) => {
    s(e.id);
    u((t) => ({
      ...t,
      [e.id]: "Checking local API server…",
    }));
    try {
      const t = await checkAiServerHealth();
      u((n) => ({
        ...n,
        [e.id]: t.configured
          ? `Server configured · ${t.model} · provider not called`
          : "API server found. Set OPENAI_API_KEY and OPENAI_MODEL on the server.",
      }));
    } catch (t) {
      u((n) => ({
        ...n,
        [e.id]: t instanceof Error ? t.message : String(t),
      }));
    } finally {
      s(null);
    }
  };
  return t.kind === "providers" ? (
    <PaymentProvidersOverview
      providers={d}
      revision={i}
      onConfigure={(e) =>
        r({
          mode: "configure",
          connection: e,
        })
      }
      onGuide={(e) =>
        r({
          mode: "guide",
          connection: e,
        })
      }
      dialog={n}
      close={() => r(null)}
      saved={(e) => {
        r(null);
        a((e) => e + 1);
        u((t) => ({
          ...t,
          [e.id]: "",
        }));
      }}
    />
  ) : (
    <Fragment>
      <CommercePageHeading
        title={t.title}
        actions={
          <Link
            className="secondary-button"
            href={buildHref("/commerce/webhooks")}
          >
            Webhooks
            <Icon name="arrow-right" />
          </Link>
        }
      />
      <div className="c-destination-grid">
        {d.map((e) => (
          <article key={`${e.id}-${i}`} className="glass-card c-connection">
            <div className="card-heading">
              <span className="icon-tile">
                <Icon name={e.icon} />
              </span>
              <StatusPill
                value={e.available ? "Not checked" : "Backend required"}
              />
            </div>
            <span className="c-cell-note">{e.category}</span>
            <h2>{e.name}</h2>
            <p>{e.description}</p>
            <div
              className="c-connection-state"
              data-connection-status={e.id}
              aria-live="polite"
            >
              {f(e)}
            </div>
            <div className="c-toolbar">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  r({
                    mode: "configure",
                    connection: e,
                  })
                }
              >
                Configure
              </button>
              {e.available ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={o === e.id}
                  onClick={() => void p(e)}
                >
                  Test connection
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    r({
                      mode: "guide",
                      connection: e,
                    })
                  }
                >
                  Integration guide
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <section className="glass-card c-integration-flow">
        <h2>How the connection works</h2>
        <ol>
          <li>
            <strong>Keep secrets on your server.</strong>
            <span>
              Use environment variables or your hosting provider’s secret
              manager.
            </span>
          </li>
          <li>
            <strong>Connect your application API.</strong>
            <span>
              The browser sends authenticated requests to your backend, which
              calls the provider.
            </span>
          </li>
          <li>
            <strong>Verify provider events.</strong>
            <span>
              Your backend validates webhook signatures and updates the order or
              message record.
            </span>
          </li>
        </ol>
      </section>
      {n?.mode === "configure" ? (
        <ProviderConnectionDialog
          connection={n.connection}
          onClose={() => r(null)}
          onSaved={() => {
            const e = n.connection;
            r(null);
            a((e) => e + 1);
            u((t) => ({
              ...t,
              [e.id]: "",
            }));
          }}
        />
      ) : null}
      {n?.mode === "guide" ? (
        <IntegrationGuideDialog
          connection={n.connection}
          onClose={() => r(null)}
        />
      ) : null}
    </Fragment>
  );
}
