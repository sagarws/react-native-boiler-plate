// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import { brandAssets } from "@/config/branding";
import {
  calculateCheckoutDiscounts,
  getEligiblePaymentMethods,
} from "@/features/checkout/lib/checkout-preview";
import { readGeneralSettings } from "@/lib/branding";
import { listRecords } from "@/lib/store/core";

function CheckoutPreviewBrand() {
  const e = readGeneralSettings();
  const t = e.siteLogo || brandAssets.siteLogo;
  return (
    <span className="c-preview-brand">
      <img
        src={t}
        alt={e.storeName || "Veylix"}
        style={{
          display: "block",
          maxWidth: 180,
          maxHeight: 40,
          width: "auto",
          height: "auto",
          objectFit: "contain",
        }}
      />
    </span>
  );
}

export function CheckoutPreview({ settings, expanded = false }) {
  const n = calculateCheckoutDiscounts(settings);
  const r = getEligiblePaymentMethods(settings, n.total);
  const i = listRecords("coupons").filter((e) => e.status === "Active").length;
  const a = [
    "Contact",
    "Shipping",
    "Delivery",
    "Payment",
    ...(settings.orderReview === "Enabled" ? ["Review"] : []),
  ];
  return (
    <div
      className={`checkout-preview-shell ${expanded ? "expanded" : ""}`.trim()}
    >
      <div className="checkout-preview-brand">
        <CheckoutPreviewBrand />
        <span>Secure checkout</span>
      </div>
      <div className="checkout-preview-progress" aria-label="Checkout steps">
        {a.map((e, t) => (
          <span key={e} className={t === 0 ? "current" : ""}>
            <b>{t + 1}</b>
            {e}
          </span>
        ))}
      </div>
      <div className="checkout-preview-grid">
        <div className="checkout-preview-main">
          <div className="checkout-preview-section">
            <div className="checkout-preview-heading">
              <div>
                <small>STEP 1</small>
                <h3>Contact information</h3>
              </div>
              <span>
                {settings.guest === "Allowed"
                  ? "Guest allowed"
                  : "Account required"}
              </span>
            </div>
            <div className="checkout-preview-input">
              {settings.contact === "Phone or email"
                ? "Email or mobile number"
                : "Email address"}
              <i />
            </div>
            {settings.phone === "Required" ? (
              <div className="checkout-preview-input">
                {"Phone number "}
                <em>Required</em>
              </div>
            ) : null}
            {settings.marketing === "Enabled" ? (
              <label className="checkout-preview-check">
                <span>✓</span>Email me about new products and offers
              </label>
            ) : null}
          </div>
          <div className="checkout-preview-section">
            <div className="checkout-preview-heading">
              <div>
                <small>DELIVERY</small>
                <h3>Shipping address</h3>
              </div>
              <span>United States</span>
            </div>
            <div className="checkout-preview-two">
              <div className="checkout-preview-input">First name</div>
              <div className="checkout-preview-input">Last name</div>
            </div>
            {settings.company === "Hidden" ? null : (
              <div className="checkout-preview-input">
                {"Company "}
                <em>{settings.company}</em>
              </div>
            )}
            <div className="checkout-preview-input">Address</div>
            {settings.deliveryInstructions === "Enabled" ? (
              <div className="checkout-preview-note">
                + Add delivery instructions
              </div>
            ) : null}
          </div>
          <div className="checkout-preview-section">
            <div className="checkout-preview-heading">
              <div>
                <small>PAYMENT</small>
                <h3>Payment method</h3>
              </div>
              <span>
                {r.length}
                {" available"}
              </span>
            </div>
            {r.length ? (
              r.slice(0, 3).map((e, n) => (
                <label key={e.id} className="checkout-preview-method">
                  <input
                    type="radio"
                    name={
                      expanded ? "preview-payment-expanded" : "preview-payment"
                    }
                    defaultChecked={n === 0}
                  />
                  <span>
                    <Icon
                      name={
                        e.type === "Wallet" || e.type === "Card"
                          ? "wallet"
                          : "package"
                      }
                    />
                    <span>
                      <strong>{e.name}</strong>
                      <small>
                        {e.type}
                        {" · "}
                        {e.capture || "Manual"}
                      </small>
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <div className="checkout-preview-empty">
                No enabled payment method matches this currency and order
                amount.
              </div>
            )}
          </div>
          {settings.terms === "Enabled" ? (
            <label className="checkout-preview-check">
              <span>✓</span>I agree to the store terms and return policy
            </label>
          ) : null}
          <button className="checkout-preview-pay" type="button">
            {"Pay "}
            {settings.currency} {n.total.toFixed(2)}
          </button>
        </div>
        <aside className="checkout-preview-summary">
          <div className="checkout-preview-product">
            <span>
              <Icon name="shopping-bag" />
            </span>
            <div>
              <strong>Sample basket</strong>
              <small>Preview order · 2 items</small>
            </div>
            <b>
              {settings.currency} {n.subtotal.toFixed(2)}
            </b>
          </div>
          {settings.coupon === "Enabled" || settings.giftCard === "Enabled" ? (
            <div className="checkout-preview-code">
              <span>
                {settings.coupon === "Enabled" &&
                settings.giftCard === "Enabled"
                  ? "Coupon or gift card"
                  : settings.coupon === "Enabled"
                    ? "Coupon code"
                    : "Gift card code"}
              </span>
              <button type="button">Apply</button>
            </div>
          ) : null}
          <dl className="checkout-preview-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>
                {settings.currency} {n.subtotal.toFixed(2)}
              </dd>
            </div>
            {n.discount > 0 ? (
              <div className="saving">
                <dt>{n.offer?.name || "Automatic discount"}</dt>
                <dd>
                  −{settings.currency} {n.discount.toFixed(2)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Shipping</dt>
              <dd>
                {n.shipping
                  ? `${settings.currency} ${n.shipping.toFixed(2)}`
                  : "Free"}
              </dd>
            </div>
            <div>
              <dt>Estimated tax</dt>
              <dd>
                {settings.currency} {n.tax.toFixed(2)}
              </dd>
            </div>
            <div className="total">
              <dt>Total</dt>
              <dd>
                {settings.currency} {n.total.toFixed(2)}
              </dd>
            </div>
          </dl>
          <div className="checkout-preview-confidence">
            <Icon name="check-circle" />
            <span>
              <strong>Checkout ready</strong>
              <small>
                {i}
                {" active coupon"}
                {i === 1 ? "" : "s"}
                {" · encrypted payment handoff"}
              </small>
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
