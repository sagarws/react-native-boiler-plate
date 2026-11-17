// @ts-nocheck
import { Fragment, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { StorePreviewBrand } from "@/features/online-store/components/store-preview-brand";
import { defaultStoreMenu } from "@/features/online-store/data";
import { showToast } from "@/lib/events";
import { listRecords } from "@/lib/store/core";
import { readPreference, savePreference } from "@/lib/store/preferences";

function readStoreMenu() {
  return readPreference("store-menu", defaultStoreMenu);
}

function buildMenuLinkSuggestions() {
  const e = (e, t) =>
    listRecords(e).map((e) => ({
      label: String(e.name || ""),
      url: `${t}/${String(e.slug || "")}`,
    }));
  return [
    ...e("pages", "/pages"),
    ...e("products", "/products"),
    ...e("categories", "/categories"),
    ...e("blog", "/blog"),
  ];
}

export function MenusPage() {
  const [e, t] = useState(() => readStoreMenu());
  const [n, r] = useState({
    open: false,
  });
  const [i, a] = useState("");
  const o = useMemo(() => buildMenuLinkSuggestions(), []);
  const s = n.id ? e.items.find((e) => e.id === n.id) : void 0;
  const c = (e) => {
    savePreference("store-menu", e);
    t(e);
  };
  const u = (t, n) => {
    const r = structuredClone(e);
    const i = r.items.findIndex((e) => e.id === n);
    if (!(i < 0)) {
      if (t === "remove") {
        r.items.splice(i, 1);
      }
      if (t === "indent") {
        r.items[i].depth = Math.min(
          2,
          r.items[i].depth + 1,
          (r.items[i - 1]?.depth ?? -1) + 1,
        );
      }
      if (t === "outdent") {
        r.items[i].depth = Math.max(0, r.items[i].depth - 1);
      }
      if (t === "up" && i > 0) {
        [r.items[i - 1], r.items[i]] = [r.items[i], r.items[i - 1]];
      }
      if (t === "down" && i < r.items.length - 1) {
        [r.items[i + 1], r.items[i]] = [r.items[i], r.items[i + 1]];
      }
      r.items.forEach((e, t) => {
        e.depth = t === 0 ? 0 : Math.min(e.depth, r.items[t - 1].depth + 1);
      });
      c(r);
    }
  };
  return (
    <Fragment>
      <CommercePageHeading
        title={"Menus & mega menus"}
        actions={
          <button
            type="button"
            className="primary-button"
            data-c-action="menu-add"
            onClick={() => {
              a("");
              r({
                open: true,
              });
            }}
          >
            <Icon name="plus" />
            {" Add menu item"}
          </button>
        }
      />
      <div className="c-builder-layout">
        <section className="glass-card">
          <div className="card-heading">
            <h2>Main navigation</h2>
            <span className="c-status amber">Local draft</span>
          </div>
          <p className="c-section-copy">
            Move items up or down. Indent to create a submenu; up to three
            levels are supported.
          </p>
          <div className="c-menu-items">
            {e.items.map((t, n) => (
              <div
                key={t.id}
                className="c-menu-row"
                style={{
                  "--depth": t.depth,
                }}
              >
                <div>
                  <strong>{t.label}</strong>
                  <small>{t.url}</small>
                </div>
                <div>
                  <button
                    type="button"
                    className="secondary-button"
                    data-c-action="menu-up"
                    data-id={t.id}
                    aria-label={`Move ${t.label} up`}
                    disabled={n === 0}
                    onClick={() => u("up", t.id)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-c-action="menu-down"
                    data-id={t.id}
                    aria-label={`Move ${t.label} down`}
                    disabled={n === e.items.length - 1}
                    onClick={() => u("down", t.id)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-c-action="menu-outdent"
                    data-id={t.id}
                    aria-label={`Outdent ${t.label}`}
                    disabled={t.depth === 0}
                    onClick={() => u("outdent", t.id)}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-c-action="menu-indent"
                    data-id={t.id}
                    aria-label={`Indent ${t.label}`}
                    disabled={
                      n === 0 || t.depth === 2 || t.depth > e.items[n - 1].depth
                    }
                    onClick={() => u("indent", t.id)}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-c-action="menu-edit"
                    data-id={t.id}
                    onClick={() => {
                      a("");
                      r({
                        open: true,
                        id: t.id,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    data-c-action="menu-remove"
                    data-id={t.id}
                    onClick={() => u("remove", t.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="glass-card">
          <div className="card-heading">
            <h2>Mega menu preview</h2>
            <label>
              {"Columns "}
              <select
                data-menu-columns
                value={e.columns}
                onChange={(t) =>
                  c({
                    ...e,
                    columns: Number(t.target.value),
                  })
                }
              >
                {[2, 3, 4, 5, 6].map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="c-store-preview">
            <StorePreviewBrand />
            <div className="c-preview-nav">
              {e.items
                .filter((e) => e.depth === 0)
                .map((e) => (
                  <span key={e.id}>{e.label}</span>
                ))}
            </div>
            <div
              className="c-mega-preview"
              style={{
                "--columns": e.columns,
              }}
            >
              {e.items
                .filter((e) => e.depth > 0)
                .map((e) => (
                  <div key={e.id} className={e.depth === 2 ? "sub" : ""}>
                    {e.label}
                    <small>{e.url}</small>
                  </div>
                ))}
            </div>
            <p>A preview of your navigation content.</p>
          </div>
        </section>
      </div>
      {n.open ? (
        <AppDialog
          title={n.id ? "Edit menu item" : "Add menu item"}
          onClose={() =>
            r({
              open: false,
            })
          }
        >
          <form
            className="c-form"
            data-c-form="menu"
            data-id={n.id || ""}
            onSubmit={(t) => {
              t.preventDefault();
              a("");
              try {
                const i = Object.fromEntries(new FormData(t.currentTarget));
                const a = String(i.label || "").trim();
                const o = String(i.url || "").trim();
                const s = String(i.image || "").trim();
                if (!a) throw Error("Menu label is required.");
                if (!/^(\/[^/]|\/$|https:\/\/)/.test(o) || /[<>"\s]/.test(o))
                  throw Error(
                    "Use a store path starting with / or a valid HTTPS URL.",
                  );
                const l = structuredClone(e);
                if (n.id) {
                  l.items = l.items.map((e) =>
                    e.id === n.id
                      ? {
                          ...e,
                          label: a,
                          url: o,
                          image: s,
                        }
                      : e,
                  );
                } else {
                  l.items.push({
                    id: crypto.randomUUID(),
                    label: a,
                    url: o,
                    image: s,
                    depth: 0,
                  });
                }
                c(l);
                r({
                  open: false,
                });
                showToast("Menu item saved.");
              } catch (e) {
                a(
                  e instanceof Error
                    ? e.message
                    : "This menu item could not be saved.",
                );
              }
            }}
          >
            <label className="c-field">
              <span>Link to existing content</span>
              <select
                data-menu-source
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const t = e.target.form;
                  const n = e.target.selectedOptions[0];
                  if (!t || !n) return;
                  const r = t.elements.namedItem("label");
                  const i = t.elements.namedItem("url");
                  if (r instanceof HTMLInputElement) {
                    r.value = n.dataset.label || "";
                  }
                  if (i instanceof HTMLInputElement) {
                    i.value = e.target.value;
                  }
                }}
              >
                <option value="">Custom link</option>
                {o.map((e) => (
                  <option
                    key={`${e.url}-${e.label}`}
                    value={e.url}
                    data-label={e.label}
                  >
                    {e.label}
                    {" · "}
                    {e.url}
                  </option>
                ))}
              </select>
            </label>
            <label className="c-field">
              <span>
                {"Menu label "}
                <small>*</small>
              </span>
              <input
                name="label"
                type="text"
                required
                defaultValue={s?.label || ""}
              />
            </label>
            <label className="c-field">
              <span>
                {"Destination path or HTTPS URL "}
                <small>*</small>
              </span>
              <input
                name="url"
                type="text"
                required
                defaultValue={s?.url || "/"}
              />
            </label>
            <label className="c-field">
              <span>Optional image URL (HTTPS)</span>
              <input name="image" type="url" defaultValue={s?.image || ""} />
            </label>
            <p className="c-form-error" role="alert">
              {i}
            </p>
            <button type="submit" className="primary-button">
              Save menu item
            </button>
          </form>
        </AppDialog>
      ) : null}
    </Fragment>
  );
}
