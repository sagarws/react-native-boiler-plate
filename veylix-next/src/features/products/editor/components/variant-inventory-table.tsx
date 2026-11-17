// @ts-nocheck

export function VariantInventoryTable({ rows, selectedNames, onChange }) {
  return rows.length ? (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Variant inventory"
    >
      <table className="c-table product-variant-table">
        <thead>
          <tr>
            <th scope="col">Combination</th>
            <th scope="col">SKU</th>
            <th scope="col">Price</th>
            <th scope="col">Stock</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, r) => (
            <tr key={e.id || `${e.name}-${r}`} data-variant-row={r}>
              <th scope="row">
                {e.name}
                {selectedNames && !selectedNames.has(e.name) ? (
                  <small>Retained · disable if no longer sold</small>
                ) : null}
              </th>
              <td>
                <input
                  type="text"
                  data-variant-key="sku"
                  value={e.sku}
                  aria-label={`SKU for ${e.name}`}
                  required
                  maxLength={100}
                  onChange={(e) => onChange(r, "sku", e.target.value)}
                />
              </td>
              <td>
                <input
                  data-variant-key="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={e.price}
                  aria-label={`Price for ${e.name}`}
                  required
                  onChange={(e) => onChange(r, "price", e.target.value)}
                />
              </td>
              <td>
                <input
                  data-variant-key="stock"
                  type="number"
                  min="0"
                  step="1"
                  value={e.stock}
                  aria-label={`Stock for ${e.name}`}
                  required
                  onChange={(e) => onChange(r, "stock", e.target.value)}
                />
              </td>
              <td>
                <select
                  data-variant-key="status"
                  value={e.status}
                  aria-label={`Status for ${e.name}`}
                  onChange={(e) => onChange(r, "status", e.target.value)}
                >
                  <option value="Active">Active</option>
                  <option value="Disabled">Disabled</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="product-empty-options">
      This product has no variants. It uses the price and stock entered above.
    </div>
  );
}
