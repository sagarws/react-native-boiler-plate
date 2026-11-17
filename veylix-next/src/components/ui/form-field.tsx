// @ts-nocheck
import { Fragment } from "react";
import { ContentImageField } from "@/components/ui/content-image-field";
import { listRecords } from "@/lib/store/core";

function getRelationOptions(e) {
  return listRecords(e).map((e) => [
    String(e.id),
    String(e.name || e.number || e.code || e.id),
  ]);
}

export function FormField({
  field,
  value = "",
  prefix = "field",
  onChange,
  mediaFolder,
}) {
  if (field.type === "image" || field.type === "content-image")
    return (
      <ContentImageField
        field={field}
        value={value}
        prefix={prefix}
        folder={mediaFolder}
      />
    );
  const a = `${prefix}-${field.key}`;
  const o = value == null ? "" : String(value);
  const s = field.relation ? getRelationOptions(field.relation) : [];
  const c =
    (field.relation &&
      o &&
      !s.some(([e]) => e === o) &&
      s.find(([, e]) => e === o)?.[0]) ||
    o;
  const l = {
    id: a,
    name: field.key,
    required: field.required,
    min: field.min,
    max: field.max,
    pattern: field.pattern,
  };
  let u;
  if (field.relation || field.type === "select") {
    const t = field.relation ? s : (field.options || []).map((e) => [e, e]);
    u = (
      <select
        {...l}
        {...(onChange
          ? {
              value: c,
              onChange: (e) => onChange(e.target.value),
            }
          : {
              defaultValue: c,
            })}
      >
        <option value="">
          {"Choose "}
          {field.label.toLowerCase()}
        </option>
        {t.map(([e, t]) => (
          <option key={e} value={e}>
            {t}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "textarea")
    u = (
      <textarea
        {...l}
        rows={4}
        maxLength={2e4}
        placeholder={field.placeholder || ""}
        {...(onChange
          ? {
              value: c,
              onChange: (e) => onChange(e.target.value),
            }
          : {
              defaultValue: c,
            })}
      />
    );
  else {
    const t = field.type === "money" || field.type === "number";
    const n = field.type === "money" ? "number" : field.type;
    u = (
      <input
        {...l}
        type={n}
        step={t ? (field.integer ? 1 : 0.01) : void 0}
        maxLength={
          !t && !["date", "datetime-local"].includes(field.type)
            ? field.maxLength || 1e3
            : void 0
        }
        placeholder={
          ["date", "datetime-local"].includes(field.type)
            ? void 0
            : field.placeholder || ""
        }
        {...(onChange
          ? {
              value: c,
              onChange: (e) => onChange(e.target.value),
            }
          : {
              defaultValue: c,
            })}
      />
    );
  }
  return (
    <label
      className={`c-field ${field.type === "textarea" ? "span-full" : ""}`}
      htmlFor={a}
    >
      <span>
        {field.label}
        {field.required ? (
          <Fragment>
            {" "}
            <small>*</small>
          </Fragment>
        ) : null}
      </span>
      {u}
    </label>
  );
}
