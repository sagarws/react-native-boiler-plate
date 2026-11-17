// @ts-nocheck
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { ProductEditorSection } from "@/features/products/editor/components/product-editor-section";
import { ProductToggle } from "@/features/products/editor/components/product-toggle";
import { VariantInventoryTable } from "@/features/products/editor/components/variant-inventory-table";
import { VariantOptionBuilder } from "@/features/products/editor/components/variant-option-builder";
import { buildVariantsFromOptions } from "@/lib/product-options";

function ProductStockNumberField({
  name: e,
  label,
  value,
  step = "1",
  onChange,
}) {
  return (
    <label className="c-field" htmlFor={`product-${e}`}>
      <span>{label}</span>
      <input
        id={`product-${e}`}
        name={e}
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function ProductInventorySection({
  values,
  setField,
  groups,
  variants,
  generatedOptions,
  onGroupsChange,
  onGeneratedOptionsChange,
  onVariantsChange,
  hidden,
}) {
  const [u, d] = useState();
  const [f, p] = useState("");
  const m = Math.max(
    0,
    Number(values.stock || 0) - Number(values.reservedStock || 0),
  );
  return (
    <ProductEditorSection
      id="inventory"
      icon="warehouse"
      title={"Inventory & variants"}
      description="Manage product stock, selling units and every sellable variant combination."
      panel
      hidden={hidden}
    >
      <section className="product-editor-block">
        <div className="product-editor-block-heading">
          <div>
            <h3>{"Inventory & availability"}</h3>
            <p>
              Track stock, reserved quantity, replenishment thresholds and the
              selling unit.
            </p>
          </div>
          <span className="product-block-badge">
            {m} {values.unit || "units"}
            {" available"}
          </span>
        </div>
        <div className="product-inventory-grid">
          <ProductStockNumberField
            name="stock"
            label="Current stock"
            value={values.stock}
            onChange={(e) => setField("stock", e)}
          />
          <ProductStockNumberField
            name="reservedStock"
            label="Reserved stock"
            value={values.reservedStock}
            onChange={(e) => setField("reservedStock", e)}
          />
          <ProductStockNumberField
            name="threshold"
            label="Low stock alert"
            value={values.threshold}
            onChange={(e) => setField("threshold", e)}
          />
          <ProductStockNumberField
            name="reorderLevel"
            label="Reorder level"
            value={values.reorderLevel}
            onChange={(e) => setField("reorderLevel", e)}
          />
          <label className="c-field" htmlFor="product-unit">
            <span>Selling unit</span>
            <select
              id="product-unit"
              name="unit"
              value={values.unit}
              onChange={(e) => setField("unit", e.target.value)}
            >
              {[
                "pcs",
                "kg",
                "g",
                "set",
                "pair",
                "box",
                "pack",
                "liter",
                "ml",
                "meter",
                "cm",
              ].map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="c-field" htmlFor="product-barcode">
            <span>Barcode / GTIN</span>
            <input
              id="product-barcode"
              name="barcode"
              type="text"
              value={values.barcode}
              placeholder="EAN, UPC or internal barcode"
              onChange={(e) => setField("barcode", e.target.value)}
            />
          </label>
        </div>
        <div className="product-toggle-grid">
          <ProductToggle
            name="trackInventory"
            title="Track inventory"
            description="Count product and variant availability."
            checked={values.trackInventory}
            onChange={(e) => setField("trackInventory", e)}
          />
          <ProductToggle
            name="allowBackorder"
            title="Continue selling when out of stock"
            description="Allow customers to order after stock reaches zero."
            checked={values.allowBackorder}
            onChange={(e) => setField("allowBackorder", e)}
          />
        </div>
      </section>
      <section className="product-editor-block product-editor-variants">
        <div className="product-editor-block-heading product-editor-block-heading-actions">
          <div>
            <h3>Product variants</h3>
            <p>Manage SKU, stock and price for each option combination.</p>
          </div>
          <Link className="secondary-button" href="/commerce/attributes">
            <Icon name="gear" />
            {" Manage attributes"}
          </Link>
        </div>
        <div data-product-options>
          <VariantOptionBuilder
            groups={groups}
            onChange={(e) =>
              onGroupsChange(e, JSON.stringify(e) !== generatedOptions)
            }
          />
        </div>
        <div className="product-variant-toolbar">
          <div>
            <strong>
              {variants.length}
              {" variant"}
              {variants.length === 1 ? "" : "s"}
            </strong>
            <p className="product-help">
              Existing variants keep their price, SKU and stock.
            </p>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              p("");
              try {
                const t = buildVariantsFromOptions(
                  groups,
                  values.sku,
                  values.price,
                  variants,
                );
                const i = new Set(t.map((e) => e.name));
                onVariantsChange([
                  ...t,
                  ...variants.filter((e) => e.id && !i.has(e.name)),
                ]);
                d(i);
                onGeneratedOptionsChange(JSON.stringify(groups));
                onGroupsChange(groups, false);
              } catch (e) {
                p(
                  e instanceof Error
                    ? e.message
                    : "Variants could not be generated.",
                );
              }
            }}
          >
            <Icon name="sparkle" />
            {" Generate variants"}
          </button>
        </div>
        <p className="c-form-error" role="alert">
          {f}
        </p>
        <div data-product-variants>
          <VariantInventoryTable
            rows={variants}
            selectedNames={u}
            onChange={(e, t, n) =>
              onVariantsChange(
                variants.map((r, i) =>
                  i === e
                    ? {
                        ...r,
                        [t]: n,
                      }
                    : r,
                ),
              )
            }
          />
        </div>
      </section>
    </ProductEditorSection>
  );
}
