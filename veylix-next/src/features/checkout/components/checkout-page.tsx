// @ts-nocheck
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { FormField } from "@/components/ui/form-field";
import { modulesById } from "@/config/modules/registry";
import { CheckoutPreview } from "@/features/checkout/components/checkout-preview";
import { CheckoutToggleRow } from "@/features/checkout/components/checkout-toggle-row";
import { CheckoutWorkspaceNav } from "@/features/checkout/components/checkout-workspace-nav";
import {
  checkoutExperienceToggles,
  checkoutPaymentToggles,
  checkoutPreviewFields,
  checkoutSettingFields,
  defaultCheckoutSettings,
} from "@/features/checkout/constants";
import {
  formatCheckoutUsd,
  readCheckoutSettings,
  validateCheckoutSettings,
} from "@/features/checkout/lib/checkout-preview";
import { showToast } from "@/lib/events";
import { buildHref } from "@/lib/navigation";
import { listRecords } from "@/lib/store/core";
import { savePreference } from "@/lib/store/preferences";

export function CheckoutPage() {
  const e = modulesById.checkout;
  const [t, n] = useState(() => readCheckoutSettings());
  const [r, i] = useState(() => readCheckoutSettings());
  const [a, o] = useState("");
  const [s, c] = useState(false);
  const u = useMemo(
    () => ({
      enabledMethods: listRecords("methods").filter(
        (e) => e.status === "Enabled",
      ).length,
      activeOffers:
        listRecords("coupons").filter((e) => e.status === "Active").length +
        listRecords("discounts").filter((e) => e.status === "Active").length,
      abandoned: listRecords("abandoned").filter((e) =>
        ["Open", "Reminder drafted"].includes(String(e.status || "")),
      ),
      giftLiability: listRecords("gift-cards")
        .filter((e) =>
          ["Active", "Partially used"].includes(String(e.status || "")),
        )
        .reduce((e, t) => e + Number(t.balance || 0), 0),
    }),
    [t],
  );
  const d = [
    [
      "1",
      "Contact information",
      "Required",
      "Email, account and customer contact",
    ],
    [
      "2",
      "Shipping address",
      "Required",
      "Delivery destination and address details",
    ],
    ["3", "Delivery method", "Required", "Rates, pickup and shipping choice"],
    [
      "4",
      "Payment",
      "Required",
      `${u.enabledMethods} enabled checkout method${u.enabledMethods === 1 ? "" : "s"}`,
    ],
    [
      "5",
      "Order review",
      t.orderReview === "Enabled" ? "Enabled" : "Hidden",
      "Final confirmation before payment",
    ],
  ];
  const f = (e, t) =>
    i((n) => ({
      ...n,
      [e]: t,
    }));
  return (
    <Fragment>
      <CommercePageHeading
        title={e.title}
        actions={
          <Fragment>
            <button
              type="button"
              className="secondary-button"
              data-c-action="checkout-preview"
              onClick={() => c(true)}
            >
              <Icon name="eye" />
              {" Preview checkout"}
            </button>
            <Link
              className="primary-button"
              href={buildHref("/commerce/methods")}
            >
              Payment methods
            </Link>
          </Fragment>
        }
      />
      <CheckoutWorkspaceNav />
      <div className="checkout-kpi-grid">
        <article className="glass-card checkout-kpi">
          <span className="mint">
            <Icon name="wallet" />
          </span>
          <div>
            <small>Payment methods</small>
            <strong>{u.enabledMethods}</strong>
            <em>Enabled at checkout</em>
          </div>
        </article>
        <article className="glass-card checkout-kpi">
          <span className="amber">
            <Icon name="seal-percent" />
          </span>
          <div>
            <small>Active offers</small>
            <strong>{u.activeOffers}</strong>
            <em>Coupons + automatic</em>
          </div>
        </article>
        <article className="glass-card checkout-kpi">
          <span className="blue">
            <Icon name="cart" />
          </span>
          <div>
            <small>Recovery queue</small>
            <strong>{u.abandoned.length}</strong>
            <em>
              {formatCheckoutUsd(
                u.abandoned.reduce((e, t) => e + Number(t.value || 0), 0),
                0,
              )}
              {" basket value"}
            </em>
          </div>
        </article>
        <article className="glass-card checkout-kpi">
          <span className="lilac">
            <Icon name="gift" />
          </span>
          <div>
            <small>Gift card balance</small>
            <strong>{formatCheckoutUsd(u.giftLiability, 0)}</strong>
            <em>Outstanding liability</em>
          </div>
        </article>
      </div>
      <div className="checkout-layout">
        <div className="checkout-settings-column">
          <section className="glass-card checkout-section">
            <div className="checkout-section-heading">
              <div>
                <span>CHECKOUT FLOW</span>
                <h2>Checkout steps</h2>
                <p>
                  Keep the flow clear while controlling the optional review
                  step.
                </p>
              </div>
              <Link
                className="secondary-button"
                href={buildHref("/commerce/abandoned")}
              >
                Abandoned checkouts
              </Link>
            </div>
            <div className="checkout-step-list">
              {d.map(([e, t, n, r]) => (
                <div key={e} className="checkout-step">
                  <b>{e}</b>
                  <div>
                    <strong>{t}</strong>
                    <small>{r}</small>
                  </div>
                  <span className={n === "Hidden" ? "off" : ""}>{n}</span>
                </div>
              ))}
            </div>
          </section>
          <form
            data-c-form="checkout"
            className="checkout-settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              o("");
              try {
                const e = validateCheckoutSettings(r);
                savePreference("checkout", e);
                n(e);
                i(e);
                showToast("Checkout settings saved.");
              } catch (e) {
                o(
                  e instanceof Error
                    ? e.message
                    : "Checkout settings could not be saved.",
                );
              }
            }}
          >
            <section className="glass-card checkout-section">
              <div className="checkout-section-heading">
                <div>
                  <span>CUSTOMER INFORMATION</span>
                  <h2>{"Fields & identity"}</h2>
                  <p>
                    Choose what you ask for without making the checkout feel
                    heavy.
                  </p>
                </div>
              </div>
              <div className="c-form-grid checkout-form-grid">
                {checkoutSettingFields.map((e) => (
                  <FormField
                    key={e.key}
                    field={e}
                    value={r[e.key]}
                    prefix="checkout"
                    onChange={(t) => f(e.key, t)}
                  />
                ))}
              </div>
              <div className="checkout-toggle-list">
                {checkoutExperienceToggles.map(([e, t, n]) => (
                  <CheckoutToggleRow
                    key={e}
                    settingKey={e}
                    title={t}
                    description={n}
                    value={r[e]}
                    onChange={f}
                  />
                ))}
              </div>
            </section>
            <section className="glass-card checkout-section">
              <div className="checkout-section-heading">
                <div>
                  <span>{"PRICING & CONVERSION"}</span>
                  <h2>{"Discounts, recovery & upsells"}</h2>
                  <p>
                    Control the tools that improve conversion without cluttering
                    the flow.
                  </p>
                </div>
                <div className="checkout-heading-links">
                  <Link
                    className="secondary-button"
                    href={buildHref("/commerce/coupons")}
                  >
                    Coupons
                  </Link>
                  <Link
                    className="secondary-button"
                    href={buildHref("/commerce/discounts")}
                  >
                    Automatic discounts
                  </Link>
                </div>
              </div>
              <div className="checkout-toggle-list">
                {checkoutPaymentToggles.map(([e, t, n]) => (
                  <CheckoutToggleRow
                    key={e}
                    settingKey={e}
                    title={t}
                    description={n}
                    value={r[e]}
                    onChange={f}
                  />
                ))}
              </div>
            </section>
            <section className="glass-card checkout-section">
              <div className="checkout-section-heading">
                <div>
                  <span>PREVIEW SCENARIO</span>
                  <h2>Test order values</h2>
                  <p>
                    Use a sample basket to see matching payment methods, tax and
                    automatic offers.
                  </p>
                </div>
              </div>
              <div className="c-form-grid checkout-form-grid">
                {checkoutPreviewFields.map((e) => (
                  <FormField
                    key={e.key}
                    field={e}
                    value={r[e.key]}
                    prefix="checkout-preview"
                    onChange={(t) => f(e.key, t)}
                  />
                ))}
              </div>
              <p className="c-form-error" role="alert">
                {a}
              </p>
              <div className="checkout-form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  data-c-action="checkout-reset"
                  onClick={() => {
                    savePreference("checkout", defaultCheckoutSettings);
                    n({
                      ...defaultCheckoutSettings,
                    });
                    i({
                      ...defaultCheckoutSettings,
                    });
                    o("");
                    showToast("Recommended checkout settings restored.");
                  }}
                >
                  Reset recommended settings
                </button>
                <button type="submit" className="primary-button">
                  <Icon name="check" />
                  {" Save checkout settings"}
                </button>
              </div>
            </section>
          </form>
        </div>
        <aside className="glass-card checkout-preview-card">
          <div className="checkout-preview-card-heading">
            <div>
              <span>LIVE PREVIEW</span>
              <h2>Store checkout</h2>
            </div>
            <small>Updates after save</small>
          </div>
          <CheckoutPreview settings={t} />
        </aside>
      </div>
      {s ? (
        <AppDialog
          title="Checkout preview"
          onClose={() => c(false)}
          wide
          className="checkout-preview-dialog"
        >
          <CheckoutPreview settings={t} expanded />
        </AppDialog>
      ) : null}
    </Fragment>
  );
}
