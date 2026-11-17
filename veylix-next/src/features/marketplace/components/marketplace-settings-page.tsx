// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { FormField } from "@/components/ui/form-field";
import { MarketplaceOperationsNav } from "@/features/marketplace/components/marketplace-operations-nav";
import { VendorSummaryCard } from "@/features/marketplace/components/marketplace-review-ui";
import {
  marketplaceSettingsConfig,
  marketplaceSettingsSections,
} from "@/features/marketplace/data/marketplace-settings";
import { showToast } from "@/lib/events";
import { buildHref } from "@/lib/navigation";
import { validateSettingsSection } from "@/lib/settings-validation";
import { listRecords } from "@/lib/store/core";
import { readPreference, savePreference } from "@/lib/store/preferences";

function loadMarketplaceSettingsValues() {
  const e = readPreference(
    "settings-marketplace",
    marketplaceSettingsConfig.defaults,
  );
  return {
    ...marketplaceSettingsConfig.defaults,
    ...(e && typeof e == "object" ? e : {}),
  };
}

function normalizeMarketplaceSettingsValues(e) {
  const t = {};
  for (const n of marketplaceSettingsConfig.fields) {
    const r = e[n.key] ?? "";
    t[n.key] =
      n.type === "money" || n.type === "number"
        ? r === ""
          ? ""
          : Number(r)
        : typeof r == "string"
          ? r.trim()
          : r;
  }
  return t;
}

export function MarketplaceSettingsPage() {
  const e = useMemo(loadMarketplaceSettingsValues, []);
  const [t, n] = useState(e);
  const [r, i] = useState("");
  const a = (e, t) =>
    n((n) => ({
      ...n,
      [e]: t,
    }));
  const o = listRecords("disputes").filter(
    (e) => !["Resolved", "Closed"].includes(String(e.status)),
  ).length;
  const s = listRecords("payouts").filter((e) => e.status === "On hold").length;
  const c = listRecords("approvals").filter((e) =>
    ["Pending", "Under review", "Changes requested"].includes(String(e.status)),
  ).length;
  const u = listRecords("applications").filter((e) =>
    ["Pending", "Under review", "Changes requested"].includes(String(e.status)),
  ).length;
  return (
    <Fragment>
      <CommercePageHeading
        title="Marketplace policy"
        actions={
          <Link
            className="secondary-button"
            href={buildHref("/commerce/marketplace")}
          >
            Marketplace overview
            <Icon name="arrow-right" />
          </Link>
        }
      />
      <MarketplaceOperationsNav active="settings-marketplace" />
      <section className="marketplace-policy-hero">
        <div>
          <span>MARKETPLACE GOVERNANCE</span>
          <h2>One policy layer for every vendor relationship.</h2>
          <p>
            Set clear commercial, settlement and operating rules without
            rewriting the historical commission snapshots already attached to
            vendor orders.
          </p>
        </div>
        <div className="marketplace-policy-state">
          <span>
            <Icon name="gear" />
          </span>
          <strong>{String(t.payout || "Weekly")}</strong>
          <small>settlement cadence</small>
        </div>
      </section>
      <section
        className="marketplace-kpi-grid marketplace-policy-kpis"
        aria-label="Marketplace policy status"
      >
        <VendorSummaryCard
          icon="seal-percent"
          label="Default commission"
          value={`${Number(t.commission || 0).toFixed(1)}%`}
          detail="Fallback commercial rate"
          tone="amber"
        />
        <VendorSummaryCard
          icon="wallet"
          label="Rolling reserve"
          value={`${Number(t.reserve || 0).toFixed(1)}%`}
          detail={`${Number(t.hold || 0)} day settlement hold`}
          tone="blue"
        />
        <VendorSummaryCard
          icon="clipboard-text"
          label="Onboarding queue"
          value={String(u)}
          detail={`${c} product reviews open`}
          tone={u || c ? "amber" : "green"}
        />
        <VendorSummaryCard
          icon="info"
          label="Risk queue"
          value={String(o)}
          detail={`${s} payout hold${s === 1 ? "" : "s"}`}
          tone={o || s ? "red" : "green"}
        />
      </section>
      <form
        className="marketplace-policy-form"
        onSubmit={(e) => {
          e.preventDefault();
          i("");
          try {
            const e = validateSettingsSection(
              "marketplace",
              normalizeMarketplaceSettingsValues(t),
            );
            savePreference("settings-marketplace", e);
            n({
              ...marketplaceSettingsConfig.defaults,
              ...e,
            });
            showToast("Settings saved in this browser.");
          } catch (e) {
            i(
              e instanceof Error
                ? e.message
                : "Marketplace policy could not be saved.",
            );
          }
        }}
      >
        <div className="marketplace-policy-grid">
          {marketplaceSettingsSections.map(([e, n, r, i]) => (
            <section key={n} className="glass-card marketplace-policy-card">
              <header>
                <span>{e}</span>
                <h2>{n}</h2>
                <p>{r}</p>
              </header>
              <div className="c-form-grid">
                {i.map((e) => {
                  const n = marketplaceSettingsConfig.fields.find(
                    (t) => t.key === e,
                  );
                  return (
                    <FormField
                      key={e}
                      field={n}
                      value={t[e]}
                      prefix="marketplace-policy"
                      onChange={(t) => a(e, t)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <section className="glass-card marketplace-policy-save">
          <div>
            <Icon name="info" />
            <p>
              <strong>Policy changes affect future operations.</strong>
              {
                " Existing vendor-order commission snapshots remain unchanged. Use the payout and dispute workspaces to review any active financial holds before changing settlement policy."
              }
            </p>
          </div>
          <p className="c-form-error" role="alert">
            {r}
          </p>
          <button type="submit" className="primary-button">
            Save marketplace policy
          </button>
        </section>
      </form>
    </Fragment>
  );
}
