// @ts-nocheck
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { StorePreviewBrand } from "@/features/online-store/components/store-preview-brand";
import { showToast } from "@/lib/events";
import { findRecord } from "@/lib/store/core";
import { saveRecord } from "@/lib/store/records";

const pageBlockTypes = [
  "Hero",
  "Text",
  "Features",
  "Image",
  "FAQ",
  "Call to action",
];

function readStorePage(e) {
  return findRecord("pages", e);
}

export function PageBuilderDialog({ pageId, onClose, onChanged }) {
  const [r, i] = useState("builder");
  const [a, o] = useState("Hero");
  const [s, c] = useState(null);
  const [u, d] = useState("");
  const [f, p] = useState(0);
  const m = readStorePage(pageId);
  if (!m) return null;
  const h = Array.isArray(m.blocks) ? m.blocks : [];
  const g = (e) => {
    saveRecord(
      "pages",
      {
        ...m,
        blocks: e,
      },
      m.id,
    );
    p((e) => e + 1);
    onChanged();
  };
  const _ = (e, t) => {
    const n = [...h];
    if (e === "remove") {
      n.splice(t, 1);
    } else if (t > 0) {
      [n[t - 1], n[t]] = [n[t], n[t - 1]];
    }
    g(n);
  };
  const v = (e) => {
    if ((e.preventDefault(), s)) {
      d("");
      try {
        const t = Object.fromEntries(new FormData(e.currentTarget));
        const n = String(t.title || "").trim();
        const r = String(t.body || "");
        const a = String(t.image || "").trim();
        const o = String(t.url || "").trim();
        if (!n) throw Error("Heading is required.");
        if (a && !a.startsWith("https://"))
          throw Error("Use an HTTPS image URL.");
        if (o && !/^\/(?!\/)/.test(o))
          throw Error("Use a store path starting with /.");
        const l = [...h];
        const u = {
          type: s.type,
          title: n,
          body: r,
        };
        if (s.type === "Image") {
          u.image = a;
        }
        if (s.type === "Call to action") {
          u.url = o;
        }
        if (s.index == null) {
          l.push(u);
        } else {
          l[s.index] = u;
        }
        g(l);
        c(null);
        i("builder");
        showToast("Changes saved in this browser.");
      } catch (e) {
        d(e instanceof Error ? e.message : "This block could not be saved.");
      }
    }
  };
  if (r === "preview")
    return (
      <AppDialog
        title={`Preview · ${String(m.name || "")}`}
        onClose={onClose}
        wide
      >
        <div className="c-page-preview">
          <StorePreviewBrand />
          {h.map((e, t) => {
            const n = `preview-${e.type.toLowerCase().replaceAll(" ", "-")}`;
            return (
              <section key={`${e.type}-${t}`} className={n}>
                {e.type === "Image" && e.image?.startsWith("https://") ? (
                  <img src={e.image} alt={e.title || ""} loading="lazy" />
                ) : null}
                <h2>{e.title}</h2>
                {e.type === "Features" ? (
                  <ul>
                    {String(e.body || "")
                      .split("\n")
                      .filter(Boolean)
                      .map((e, t) => (
                        <li key={`${t}-${e}`}>
                          <Icon name="check-circle" />
                          {e}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p>{e.body}</p>
                )}
                {e.type === "Call to action" ? (
                  <span className="primary-button">Explore the collection</span>
                ) : null}
              </section>
            );
          })}
        </div>
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            data-c-action="page-builder"
            data-id={pageId}
            onClick={() => i("builder")}
          >
            Back to builder
          </button>
        </div>
      </AppDialog>
    );
  if (r === "block" && s) {
    const n = s.index == null ? void 0 : h[s.index];
    return (
      <AppDialog title={`Edit ${s.type} block`} onClose={onClose}>
        <form
          className="c-form"
          data-c-form="block"
          data-id={pageId}
          data-index={s.index ?? ""}
          data-type={s.type}
          onSubmit={v}
        >
          <label className="c-field">
            <span>
              {"Heading "}
              <small>*</small>
            </span>
            <input
              name="title"
              type="text"
              required
              defaultValue={n?.title || ""}
            />
          </label>
          <label className="c-field span-full">
            <span>
              {s.type === "Features" ? "Features (one per line)" : "Content"}
            </span>
            <textarea
              name="body"
              rows={4}
              maxLength={2e4}
              defaultValue={n?.body || ""}
            />
          </label>
          {s.type === "Image" ? (
            <label className="c-field">
              <span>
                {"Image URL (HTTPS) "}
                <small>*</small>
              </span>
              <input
                name="image"
                type="url"
                required
                defaultValue={n?.image || ""}
              />
            </label>
          ) : null}
          {s.type === "Call to action" ? (
            <label className="c-field">
              <span>
                {"Destination path "}
                <small>*</small>
              </span>
              <input
                name="url"
                type="text"
                required
                defaultValue={n?.url || "/"}
              />
            </label>
          ) : null}
          <p className="c-form-error" role="alert">
            {u}
          </p>
          <button type="submit" className="primary-button">
            Save block
          </button>
        </form>
      </AppDialog>
    );
  }
  return (
    <AppDialog
      title={`Page builder · ${String(m.name || "")}`}
      onClose={onClose}
      wide
    >
      <div className="c-page-builder" data-page-id={pageId}>
        <div className="c-toolbar">
          <p>Add blocks, edit the content, then preview your page.</p>
          <select
            id="block-type"
            aria-label="Block type"
            value={a}
            onChange={(e) => o(e.target.value)}
          >
            {pageBlockTypes.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
          <button
            type="button"
            className="secondary-button"
            data-c-action="block-add"
            data-id={pageId}
            onClick={() => {
              d("");
              c({
                type: a,
              });
              i("block");
            }}
          >
            Add block
          </button>
        </div>
        <div className="c-block-list">
          {h.length ? (
            h.map((t, n) => (
              <div key={`${t.type}-${n}`} className="c-block-row">
                <span className="c-block-index">{n + 1}</span>
                <div>
                  <small>{t.type}</small>
                  <strong>{t.title || "Untitled block"}</strong>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  data-c-action="block-up"
                  data-id={pageId}
                  data-index={n}
                  disabled={n === 0}
                  aria-label={`Move block ${n + 1} up`}
                  onClick={() => _("up", n)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  data-c-action="block-edit"
                  data-id={pageId}
                  data-index={n}
                  onClick={() => {
                    d("");
                    c({
                      index: n,
                      type: t.type,
                    });
                    i("block");
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  data-c-action="block-remove"
                  data-id={pageId}
                  data-index={n}
                  onClick={() => _("remove", n)}
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <p className="c-section-copy">Add your first block to begin.</p>
          )}
        </div>
        <div className="c-form-footer">
          <span>
            {String(m.status || "")}
            {" · local store content"}
          </span>
          <button
            type="button"
            className="primary-button"
            data-c-action="page-preview"
            data-id={pageId}
            onClick={() => i("preview")}
          >
            Preview page
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
