// @ts-nocheck
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { buildCsv, downloadFile } from "@/lib/csv";
import { showToast } from "@/lib/events";
import { importProductsFromCsv } from "@/lib/store/products";

export function ProductImportDialog({ onClose, onImported }) {
  const [n, r] = useState("");
  return (
    <AppDialog
      title="Import products"
      onClose={onClose}
      wide
      className="product-import-dialog"
    >
      <form
        className="c-form product-import-form"
        data-c-form="product-import"
        onSubmit={async (n) => {
          n.preventDefault();
          r("");
          try {
            const r = n.currentTarget.elements.namedItem("file")?.files?.[0];
            if (!r) throw Error("Choose a CSV file to import.");
            if (r.size > 2097152) throw Error("Keep the CSV file under 2 MB.");
            const i = importProductsFromCsv(await r.text());
            onImported();
            onClose();
            showToast(`${i} product${i === 1 ? "" : "s"} imported.`);
          } catch (e) {
            r(
              e instanceof Error
                ? e.message
                : "Products could not be imported.",
            );
          }
        }}
      >
        <div className="product-import-intro">
          <Icon name="upload" />
          <div>
            <strong>Upload a product CSV</strong>
            <p>
              Import up to 500 products. Name and SKU are required; category,
              brand, price, stock and status are supported.
            </p>
          </div>
        </div>
        <label className="product-import-drop">
          <span>
            <Icon name="upload" />
            {" Choose CSV file"}
          </span>
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <div className="product-import-columns">
          <span>Name</span>
          <span>SKU</span>
          <span>Category</span>
          <span>Brand</span>
          <span>Price</span>
          <span>Stock</span>
          <span>Status</span>
        </div>
        <p className="c-form-error" role="alert">
          {n}
        </p>
        <div className="c-form-footer">
          <button
            type="button"
            className="secondary-button"
            data-c-action="product-import-template"
            onClick={() => {
              downloadFile(
                "veylix-product-import-template.csv",
                "﻿" +
                  buildCsv(
                    [
                      {
                        name: "Example Product",
                        sku: "VX-2001",
                        category: "Home",
                        brand: "Veylix Studio",
                        price: 39,
                        stock: 24,
                        status: "Draft",
                      },
                    ],
                    [
                      "name",
                      "sku",
                      "category",
                      "brand",
                      "price",
                      "stock",
                      "status",
                    ],
                    [
                      "Name",
                      "SKU",
                      "Category",
                      "Brand",
                      "Price",
                      "Stock",
                      "Status",
                    ],
                  ),
              );
              showToast("CSV template downloaded.");
            }}
          >
            Download CSV template
          </button>
          <button type="submit" className="primary-button">
            Import products
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
