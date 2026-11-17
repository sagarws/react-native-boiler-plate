// @ts-nocheck
import { productEditorSections } from "@/features/products/editor/data";

export function ProductEditorNavigation({ active, onChange, readiness }) {
  const r = productEditorSections.filter((e) => readiness[e.id].complete).length;
  return (
    <section className="glass-card product-section product-editor-navigation">
      <header className="product-navigation-heading">
        <div>
          <span className="product-navigation-eyebrow">PRODUCT SETUP</span>
          <h2>Product details</h2>
          <p>Move between sections without leaving this page.</p>
        </div>
        <strong data-product-progress>
          {r}/{productEditorSections.length}
        </strong>
      </header>
      <div className="product-progress-track" aria-hidden="true">
        <span
          data-product-progress-bar
          style={{
            width: `${Math.round((r / productEditorSections.length) * 100)}%`,
          }}
        />
      </div>
      <div
        className="product-editor-tabs"
        role="tablist"
        aria-label="Product editor sections"
      >
        {productEditorSections.map((r, i) => {
          const a = active === r.id;
          const o = readiness[r.id];
          return (
            <button
              key={r.id}
              type="button"
              id={`product-tab-${r.id}`}
              className={`product-editor-tab${a ? " is-active" : ""}${o.complete ? " is-complete" : ""}`}
              role="tab"
              aria-selected={a}
              aria-controls={`product-${r.id}`}
              tabIndex={a ? 0 : -1}
              disabled={o.disabled}
              data-product-tab={r.id}
              onClick={() => onChange(r.id)}
              onKeyDown={(e) => {
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const i = productEditorSections.filter(
                  (e) => !readiness[e.id].disabled,
                );
                const a = i.findIndex((e) => e.id === r.id);
                const o =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? i.length - 1
                      : e.key === "ArrowDown"
                        ? (a + 1) % i.length
                        : (a - 1 + i.length) % i.length;
                onChange(i[o].id);
                requestAnimationFrame(() =>
                  document.getElementById(`product-tab-${i[o].id}`)?.focus(),
                );
              }}
            >
              <span className="product-editor-tab-index">{i + 1}</span>
              <span className="product-editor-tab-copy">
                <strong>{r.label}</strong>
                <small>{r.description}</small>
              </span>
              <span
                className="product-editor-tab-state"
                data-product-tab-state={r.id}
              >
                {o.complete ? "Ready" : o.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
