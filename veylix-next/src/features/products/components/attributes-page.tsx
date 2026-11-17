// @ts-nocheck
import { Fragment, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { FormField } from "@/components/ui/form-field";
import { modulesById } from "@/config/modules/registry";
import { VariantOptionBuilder } from "@/features/products/editor/components/variant-option-builder";
import { showToast } from "@/lib/events";
import {
  colorForOptionValue,
  validateOptionGroups,
} from "@/lib/product-options";
import { listRecords } from "@/lib/store/core";
import { archiveRecords, saveRecord } from "@/lib/store/records";

const attributesModuleConfig = modulesById.attributes;

function attributeToEditorGroup(e) {
  if (!e)
    return {
      name: "",
      type: "Text",
      values: [
        {
          label: "",
        },
      ],
    };
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

export function AttributesPage() {
  const e = useRef(null);
  const [t, n] = useState(false);
  const [r, i] = useState("");
  const [a, o] = useState(0);
  const s = useMemo(
    () =>
      listRecords("attributes", {
        archived: t,
      }),
    [t, a],
  );
  const c = s.find((e) => e.id === r);
  const [u, d] = useState([attributeToEditorGroup()]);
  const [f, p] = useState("Variants and filters");
  const [m, h] = useState("Active");
  const [g, _] = useState("");
  const v = (e) => {
    d([attributeToEditorGroup(e)]);
    p(e?.purpose || "Variants and filters");
    h(e?.status || "Active");
    _("");
  };
  const y = (t) => {
    const n = s.find((e) => e.id === t);
    i(t);
    v(n);
    requestAnimationFrame(() =>
      e.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  };
  const b = () => {
    n(false);
    i("");
    v();
    requestAnimationFrame(() =>
      e.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  };
  const x = (e) => {
    n(e);
    i("");
    v();
  };
  const S = (e) => {
    e.preventDefault();
    _("");
    try {
      const e = validateOptionGroups(u)[0];
      if (
        listRecords("attributes").some(
          (t) => t.id !== r && t.name.toLowerCase() === e.name.toLowerCase(),
        )
      )
        throw Error(
          "An attribute with this name already exists. Edit it from the library.",
        );
      const t = saveRecord(
        "attributes",
        {
          name: e.name,
          displayType: e.type,
          optionValues: e.values,
          values: e.values.map((e) => e.label).join(", "),
          purpose: f,
          status: m,
        },
        r || void 0,
      );
      i(t.id);
      o((e) => e + 1);
      v(t);
      showToast("Attribute saved. It is ready to use in the product editor.");
    } catch (e) {
      _(e instanceof Error ? e.message : "This attribute could not be saved.");
    }
  };
  const C = () => {
    if (r)
      try {
        archiveRecords("attributes", [r], t);
        i("");
        o((e) => e + 1);
        v();
        showToast(t ? "Attribute restored." : "Attribute archived.");
      } catch (e) {
        _(
          e instanceof Error
            ? e.message
            : "This attribute could not be updated.",
        );
      }
  };
  const w = attributesModuleConfig.fields.find((e) => e.key === "purpose");
  const T = attributesModuleConfig.fields.find((e) => e.key === "status");
  return (
    <Fragment>
      <CommercePageHeading title={attributesModuleConfig.title} />
      <div className="attribute-layout">
        <section className="glass-card product-section">
          <div className="product-section-heading">
            <div>
              <h2>Your attribute library</h2>
              <p>Reusable choices for every product.</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              data-attribute-new
              onClick={b}
            >
              <Icon name="plus" />
              {" New"}
            </button>
          </div>
          <label className="c-archive-toggle">
            <input
              type="checkbox"
              data-attribute-archived
              checked={t}
              onChange={(e) => x(e.currentTarget.checked)}
            />
            {" Archived attributes"}
          </label>
          <div className="attribute-list">
            {s.map((e) => {
              const t = attributeToEditorGroup(e);
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`attribute-card ${e.id === r ? "is-selected" : ""}`}
                  data-attribute-edit={e.id}
                  onClick={() => y(e.id)}
                >
                  <span className="attribute-card-title">
                    <strong>{e.name}</strong>
                    <span>{e.status}</span>
                  </span>
                  <span className="attribute-chips">
                    {t.values.map((e, n) => (
                      <span key={`${e.label}-${n}`}>
                        {t.type === "Color" ? (
                          <i
                            style={{
                              "--swatch": /^#[a-f\d]{6}$/i.test(e.color || "")
                                ? e.color
                                : "#c8b68e",
                            }}
                          />
                        ) : null}
                        {e.label}
                      </span>
                    ))}
                  </span>
                  <span className="product-help">
                    {e.purpose}
                    {" · Edit "}
                    <Icon name="arrow-right" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <form
          className="glass-card product-section c-form"
          id="attribute-editor"
          ref={e}
          onSubmit={S}
        >
          <div className="product-section-heading">
            <div>
              <h2>{c ? "Edit attribute" : "Create an attribute"}</h2>
              <p>
                Name each value. Choose Color swatches to select actual colors.
              </p>
            </div>
          </div>
          <div data-attribute-options>
            <VariantOptionBuilder
              groups={u}
              onChange={d}
              single
              library={false}
            />
          </div>
          <div className="c-form-grid">
            <FormField field={w} value={f} prefix="attribute" onChange={p} />
            <FormField field={T} value={m} prefix="attribute" onChange={h} />
          </div>
          <p className="c-form-error" data-attribute-error role="alert">
            {g}
          </p>
          <p className="product-help">
            Updates apply when this attribute is next added to a product.
            Existing product choices stay unchanged.
          </p>
          <div className="button-row">
            <button type="submit" className="primary-button" disabled={t}>
              <Icon name="check" />
              {" Save attribute"}
            </button>
            {c ? (
              <button
                type="button"
                className="secondary-button"
                data-attribute-archive
                onClick={C}
              >
                {t ? "Restore attribute" : "Archive attribute"}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </Fragment>
  );
}
