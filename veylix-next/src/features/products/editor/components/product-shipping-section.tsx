// @ts-nocheck
import { Fragment } from "react";
import { ProductEditorSection } from "@/features/products/editor/components/product-editor-section";
import { ProductToggle } from "@/features/products/editor/components/product-toggle";

function ProductMeasurementField({ name: e, label, value, onChange }) {
  return (
    <label className="c-field" htmlFor={`product-${e}`}>
      <span>{label}</span>
      <input
        id={`product-${e}`}
        name={e}
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function ProductShippingSection({ values, setField, hidden }) {
  const r = values.productType !== "Digital";
  return (
    <ProductEditorSection
      id="shipping"
      icon="truck"
      title={"Shipping, delivery & tax"}
      description="Capture physical dimensions, delivery overrides, customs and tax treatment."
      panel
      hidden={hidden}
    >
      {r ? (
        <Fragment>
          <section className="product-editor-block" data-physical-shipping>
            <div className="product-editor-block-heading">
              <div>
                <h3>Package dimensions</h3>
                <p>
                  Use packed dimensions and weight so shipping rules can
                  estimate service and cost correctly.
                </p>
              </div>
              <span className="product-block-badge">cm / kg</span>
            </div>
            <div className="product-shipping-dimensions">
              <ProductMeasurementField
                name="width"
                label="Width (cm)"
                value={values.width}
                onChange={(e) => setField("width", e)}
              />
              <ProductMeasurementField
                name="height"
                label="Height (cm)"
                value={values.height}
                onChange={(e) => setField("height", e)}
              />
              <ProductMeasurementField
                name="depth"
                label="Depth (cm)"
                value={values.depth}
                onChange={(e) => setField("depth", e)}
              />
              <ProductMeasurementField
                name="weight"
                label="Weight (kg)"
                value={values.weight}
                onChange={(e) => setField("weight", e)}
              />
            </div>
            <div className="c-form-grid product-customs-grid">
              <label className="c-field" htmlFor="product-origin">
                <span>Country of origin</span>
                <input
                  id="product-origin"
                  name="origin"
                  type="text"
                  value={values.origin}
                  placeholder="e.g. United States"
                  onChange={(e) => setField("origin", e.target.value)}
                />
              </label>
              <label className="c-field" htmlFor="product-hsCode">
                <span>HS code</span>
                <input
                  id="product-hsCode"
                  name="hsCode"
                  type="text"
                  value={values.hsCode}
                  onChange={(e) => setField("hsCode", e.target.value)}
                />
              </label>
            </div>
          </section>
          <section className="product-editor-block" data-physical-shipping>
            <div className="product-editor-block-heading">
              <div>
                <h3>{"Delivery & shipping charges"}</h3>
                <p>
                  Keep optional product-level delivery overrides separate from
                  your global shipping zones and rates.
                </p>
              </div>
            </div>
            <div className="c-form-grid">
              <ProductMeasurementField
                name="domesticDeliveryCharge"
                label="Domestic delivery charge"
                value={values.domesticDeliveryCharge}
                onChange={(e) => setField("domesticDeliveryCharge", e)}
              />
              <ProductMeasurementField
                name="internationalDeliveryCharge"
                label="International delivery charge"
                value={values.internationalDeliveryCharge}
                onChange={(e) => setField("internationalDeliveryCharge", e)}
              />
              <label
                className="c-field span-full"
                htmlFor="product-deliveryTimeMode"
              >
                <span>Delivery time</span>
                <select
                  id="product-deliveryTimeMode"
                  name="deliveryTimeMode"
                  value={values.deliveryTimeMode}
                  onChange={(e) => setField("deliveryTimeMode", e.target.value)}
                >
                  {[
                    "Use store default",
                    "1–2 business days",
                    "3–5 business days",
                    "5–7 business days",
                    "Custom quote",
                  ].map((e) => (
                    <option key={e}>{e}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        </Fragment>
      ) : null}
      <section className="product-editor-block">
        <div className="product-editor-block-heading">
          <div>
            <h3>Tax treatment</h3>
            <p>
              Apply your configured tax rules without tying demo content to any
              specific region.
            </p>
          </div>
        </div>
        <div className="c-form-grid">
          <label className="c-field" htmlFor="product-taxClass">
            <span>Tax class</span>
            <select
              id="product-taxClass"
              name="taxClass"
              value={values.taxClass}
              onChange={(e) => setField("taxClass", e.target.value)}
            >
              {["Standard", "Reduced", "Zero-rated", "Exempt"].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
        <ProductToggle
          name="taxable"
          title="Taxable product"
          description="Apply matching tax rules at checkout."
          checked={values.taxable}
          onChange={(e) => setField("taxable", e)}
        />
      </section>
    </ProductEditorSection>
  );
}
