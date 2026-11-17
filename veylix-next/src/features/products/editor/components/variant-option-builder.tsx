// @ts-nocheck
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { colorForOptionValue } from "@/lib/product-options";
import { listRecords } from "@/lib/store/core";

function cloneOptionGroups(e) {
  return structuredClone(e);
}

function attributeToOptionGroup(e) {
  const t =
    e.displayType === "Color" || (!e.displayType && /colou?r/i.test(e.name))
      ? "Color"
      : "Text";
  const n =
    e.optionValues ||
    (e.values || "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => ({
        label: e,
        ...(t === "Color"
          ? {
              color: colorForOptionValue(e),
            }
          : {}),
      }));
  return {
    name: e.name,
    type: t,
    values: n,
  };
}

export function VariantOptionBuilder({
  groups,
  onChange,
  single = false,
  library = true,
}) {
  const [i, a] = useState("");
  const [o, s] = useState("");
  const c = useMemo(
    () => listRecords("attributes").filter((e) => e.status === "Active"),
    [],
  );
  const u = single ? 1 : 3;
  const d = (n) => {
    const r = cloneOptionGroups(groups);
    n(r);
    onChange(r);
  };
  const f = () => {
    s("");
    if (groups.length >= u) {
      s("Use up to 3 option groups.");
    } else {
      d((e) =>
        e.push({
          name: "",
          type: "Text",
          values: [
            {
              label: "",
            },
          ],
        }),
      );
    }
  };
  const p = () => {
    if ((s(""), groups.length >= u)) {
      s("Use up to 3 option groups.");
      return;
    }
    const t = c.find((e) => e.id === i);
    if (t) {
      if (groups.some((e) => e.name.toLowerCase() === t.name.toLowerCase())) {
        s("This attribute has already been added.");
      } else {
        d((e) => e.push(attributeToOptionGroup(t)));
      }
    } else {
      s("Choose an attribute first.");
    }
  };
  const m = (e) => {
    s("");
    if (single) {
      s("An attribute needs one option group.");
    } else {
      d((t) => t.splice(e, 1));
    }
  };
  const h = (t) => {
    s("");
    if (groups[t].values.length >= 30) {
      s("Use up to 30 values per option.");
    } else {
      d((e) =>
        e[t].values.push({
          label: "",
          color: "#c8b68e",
        }),
      );
      requestAnimationFrame(() => {
        document
          .querySelectorAll(
            `[data-option-index="${t}"] [data-value-key="label"]`,
          )
          .item(groups[t].values.length)
          ?.focus();
      });
    }
  };
  const g = (e, t) => {
    s("");
    d((n) => n[e].values.splice(t, 1));
  };
  const _ = (e, t, n) => {
    d((r) => {
      if (t === "name") {
        r[e].name = n;
      } else {
        r[e].type = n;
        r[e].values.forEach((e) => {
          e.color ||= colorForOptionValue(e.label);
        });
      }
    });
  };
  const v = (e, t, n, r) => {
    d((i) => {
      i[e].values[t][n] = r;
    });
  };
  return (
    <div className="option-builder">
      {library ? (
        <div className="option-builder-toolbar">
          <label className="c-field">
            <span>Use a saved attribute</span>
            <select
              data-option-library
              value={i}
              onChange={(e) => a(e.target.value)}
            >
              <option value="">Choose an attribute</option>
              {c.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            data-option-action="library"
            onClick={p}
          >
            <Icon name="plus" />
            {" Add attribute"}
          </button>
          <button
            type="button"
            className="secondary-button"
            data-option-action="group"
            onClick={f}
          >
            Custom option
          </button>
        </div>
      ) : null}
      <div data-option-groups>
        {groups.length ? (
          groups.map((e, t) => (
            <section key={t} className="option-group" data-option-index={t}>
              <div className="option-group-heading">
                <label className="c-field">
                  <span>Option name</span>
                  <input
                    type="text"
                    data-group-key="name"
                    value={e.name}
                    maxLength={60}
                    placeholder="e.g. Color or Size"
                    required
                    onChange={(e) => _(t, "name", e.target.value)}
                  />
                </label>
                <label className="c-field">
                  <span>Display as</span>
                  <select
                    data-group-key="type"
                    value={e.type}
                    onChange={(e) => _(t, "type", e.target.value)}
                  >
                    <option value="Text">Text / size</option>
                    <option value="Color">Color swatches</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="icon-button"
                  data-option-action="remove-group"
                  aria-label={`Remove option ${t + 1}`}
                  onClick={() => m(t)}
                >
                  <Icon name="trash" />
                </button>
              </div>
              <div className="option-values">
                {e.values.map((n, r) => {
                  const i = /^#[a-f\d]{6}$/i.test(n.color || "")
                    ? n.color
                    : colorForOptionValue(n.label);
                  return (
                    <div key={r} className="option-value" data-value-index={r}>
                      {e.type === "Color" ? (
                        <input
                          type="color"
                          value={i}
                          data-value-key="color"
                          aria-label={`Color swatch ${t + 1}-${r + 1}`}
                          onChange={(e) => v(t, r, "color", e.target.value)}
                        />
                      ) : (
                        <span className="option-text-mark">
                          <Icon name="tag" />
                        </span>
                      )}
                      <label
                        className="sr-only"
                        htmlFor={`option-value-${t}-${r}`}
                      >
                        {"Value "}
                        {t + 1}-{r + 1}
                      </label>
                      <input
                        type="text"
                        id={`option-value-${t}-${r}`}
                        data-value-key="label"
                        value={n.label}
                        placeholder={
                          e.type === "Color" ? "Color name" : "e.g. Small"
                        }
                        maxLength={60}
                        required
                        onChange={(e) => v(t, r, "label", e.target.value)}
                      />
                      {e.type === "Color" ? (
                        <input
                          type="text"
                          className="option-hex"
                          data-value-key="hex"
                          value={n.color || colorForOptionValue(n.label)}
                          pattern={"#[a-fA-F0-9]{6}"}
                          maxLength={7}
                          aria-label={`Hex color ${t + 1}-${r + 1}`}
                          required
                          onChange={(e) => v(t, r, "color", e.target.value)}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="icon-button"
                        data-option-action="remove-value"
                        aria-label={`Remove value ${t + 1}-${r + 1}`}
                        onClick={() => g(t, r)}
                      >
                        <Icon name="x" />
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="secondary-button option-add-value"
                  data-option-action="value"
                  onClick={() => h(t)}
                >
                  <Icon name="plus" />
                  {" Add value"}
                </button>
              </div>
            </section>
          ))
        ) : (
          <div className="product-empty-options">
            No options yet. Add Color, Size or another attribute to offer
            different versions of this product.
          </div>
        )}
      </div>
      <p className="c-form-error" data-option-error role="alert">
        {o}
      </p>
    </div>
  );
}
