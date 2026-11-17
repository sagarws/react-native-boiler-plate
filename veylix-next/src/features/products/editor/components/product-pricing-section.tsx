// @ts-nocheck
import { Fragment } from "react";
import { ProductEditorSection } from "@/features/products/editor/components/product-editor-section";
import { formatCurrency } from "@/lib/format";

function ProductPricingField({
  name: e,
  label,
  value,
  onChange,
  required = false,
}) {
  return (
    <label className="c-field" htmlFor={`product-${e}`}>
      <span>
        {label}
        {required ? (
          <Fragment>
            {" "}
            <small>*</small>
          </Fragment>
        ) : null}
      </span>
      <input
        id={`product-${e}`}
        name={e}
        type="number"
        min="0"
        step="0.01"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function ProductPricingSection({ values, setField, hidden = false }) {
  const r =
    Number(values.purchasePrice || 0) + Number(values.additionalCost || 0);
  const i = Number(values.comparePrice || 0);
  const a = Number(values.price || 0);
  const o = Number(values.minimumSellingPrice || 0);
  const s = i > a ? i - a : 0;
  const c = i > 0 ? (s / i) * 100 : 0;
  const l = a - r;
  const u = a > 0 ? (l / a) * 100 : 0;
  const d =
    o > 0 && a < o
      ? `Selling price is below the minimum selling price by ${formatCurrency(o - a, 2)}.`
      : s > 0
        ? `${c.toFixed(1)}% discount · ${formatCurrency(s, 2)} off the regular price.`
        : "No active price discount.";
  return (
    <ProductEditorSection
      id="pricing"
      icon="tag"
      title="Pricing"
      description="Control purchase cost, retail pricing, discounts, profit and margin in one place."
      panel
      hidden={hidden}
    >
      <section className="product-editor-block product-pricing-fields">
        <div className="product-editor-block-heading">
          <div>
            <h3>Product pricing</h3>
            <p>
              Manage purchase cost, regular price, sale price and minimum margin
              controls.
            </p>
          </div>
        </div>
        <div className="product-pricing-grid">
          <ProductPricingField
            name="purchasePrice"
            label="Purchase price"
            value={values.purchasePrice}
            onChange={(e) => setField("purchasePrice", e)}
          />
          <ProductPricingField
            name="additionalCost"
            label="Additional cost"
            value={values.additionalCost}
            onChange={(e) => setField("additionalCost", e)}
          />
          <ProductPricingField
            name="wholesalePrice"
            label="Wholesale price"
            value={values.wholesalePrice}
            onChange={(e) => setField("wholesalePrice", e)}
          />
          <ProductPricingField
            name="minimumSellingPrice"
            label="Minimum selling price"
            value={values.minimumSellingPrice}
            onChange={(e) => setField("minimumSellingPrice", e)}
          />
          <ProductPricingField
            name="regularPrice"
            label="Regular price"
            value={values.comparePrice}
            required
            onChange={(e) => setField("comparePrice", e)}
          />
          <ProductPricingField
            name="price"
            label="Sale / selling price"
            value={values.price}
            required
            onChange={(e) => setField("price", e)}
          />
          <label className="c-field">
            <span>Discount percentage</span>
            <input
              name="discountPercentage"
              type="number"
              value={c.toFixed(2)}
              readOnly
            />
          </label>
          <label className="c-field">
            <span>Discount amount</span>
            <input
              name="discountAmount"
              type="number"
              value={s.toFixed(2)}
              readOnly
            />
          </label>
        </div>
        <p className="product-pricing-message" role="status">
          {d}
        </p>
      </section>
      <section className="product-editor-block product-pricing-summary">
        <div className="product-editor-block-heading">
          <div>
            <h3>Pricing summary</h3>
            <p>Live profitability preview based on the values above.</p>
          </div>
        </div>
        <div className="product-pricing-summary-grid">
          <div>
            <span>Total cost</span>
            <strong>{formatCurrency(r, 2)}</strong>
            <small>Purchase + additional cost</small>
          </div>
          <div>
            <span>Regular price</span>
            <strong>{formatCurrency(i, 2)}</strong>
            <small>Before sale discount</small>
          </div>
          <div className="positive">
            <span>Profit per unit</span>
            <strong>{formatCurrency(l, 2)}</strong>
            <small>Before tax and provider fees</small>
          </div>
          <div className="info">
            <span>Margin rate</span>
            <strong>{u.toFixed(1)}%</strong>
            <small>Profit ÷ selling price</small>
          </div>
        </div>
      </section>
    </ProductEditorSection>
  );
}
