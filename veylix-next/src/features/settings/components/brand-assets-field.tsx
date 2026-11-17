// @ts-nocheck
import { useRef, useState } from "react";
import { brandAssets } from "@/config/branding";
import {
  BRAND_ASSET_ACCEPT,
  brandAssetFields,
} from "@/features/settings/constants";
import { readBrandImageFile } from "@/lib/branding";

function resolveBrandAssetPreview(e, t) {
  return t || (e === "sidebarLogo" ? brandAssets.favicon : brandAssets[e]);
}

export function BrandAssetsField({ values, onChange, onError, onClearError }) {
  const i = useRef({});
  const [a, o] = useState(null);
  const s = async (e, i, a) => {
    const s = a.currentTarget.files?.[0];
    if (s) {
      o(e);
      try {
        onChange(e, await readBrandImageFile(s, i));
        onClearError();
      } catch (e) {
        onError(e instanceof Error ? e.message : `${i} could not be read.`);
      } finally {
        o(null);
      }
    }
  };
  const c = (e) => {
    onChange(e, "");
    const n = i.current[e];
    if (n) {
      n.value = "";
    }
  };
  return (
    <section
      className="c-brand-assets span-full"
      aria-labelledby="brand-assets-title"
    >
      <div className="c-brand-assets-head">
        <div>
          <h3 id="brand-assets-title">Brand assets</h3>
          <p>
            Veylix includes a default favicon and logos. Upload your own
            whenever you want; removing a custom image restores the default.
          </p>
        </div>
      </div>
      <div className="c-brand-assets-grid">
        {brandAssetFields.map((t) => {
          const n = String(values[t.key] || "");
          const r = !!n;
          return (
            <article
              key={t.key}
              className="c-brand-card"
              data-brand-asset={t.key}
            >
              <div className="c-brand-card-head">
                <div>
                  <strong>{t.label}</strong>
                  <small>{t.help}</small>
                </div>
                <span className="c-brand-status" data-brand-status={t.key}>
                  {r ? "Custom" : "Default"}
                </span>
              </div>
              <input
                type="hidden"
                name={t.key}
                value={n}
                data-brand-value
                readOnly
              />
              <div className="c-brand-preview" data-brand-preview={t.key}>
                <img
                  className={`c-brand-image${t.key === "siteLogo" ? " is-wordmark" : ""}`}
                  src={resolveBrandAssetPreview(t.key, n)}
                  alt={`${t.label} preview`}
                />
              </div>
              <div className="c-brand-actions">
                <label className="secondary-button">
                  {t.upload}
                  <input
                    ref={(e) => {
                      i.current[t.key] = e;
                    }}
                    type="file"
                    className="sr-only"
                    accept={BRAND_ASSET_ACCEPT}
                    data-brand-upload={t.key}
                    disabled={a === t.key}
                    onChange={(e) => s(t.key, t.label, e)}
                  />
                </label>
                <button
                  type="button"
                  className="text-link c-brand-remove"
                  data-c-action="remove-brand-asset"
                  data-brand-key={t.key}
                  disabled={!r}
                  onClick={() => c(t.key)}
                >
                  Remove custom
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
