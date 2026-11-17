"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { FieldShell, type SelectOption } from "@/components/ui/form-field";
import { useDismiss } from "@/components/ui/use-dismiss";

interface ComboboxBase {
  label: string;
  options: readonly SelectOption[];
  placeholder?: string;
  error?: string | false | null;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  full?: boolean;
  /** Allow typing a value that is not in the list (freeSolo). */
  freeText?: boolean;
}

/** Autocomplete in the template's global-search dropdown style. Single value. */
export function Combobox({ value, onChange, ...p }: ComboboxBase & { value: string; onChange: (value: string) => void }) {
  return <ComboboxImpl {...p} values={value ? [value] : []} onValues={(v) => onChange(v[v.length - 1] ?? "")} multiple={false} />;
}

/** Multi-select autocomplete with chips. */
export function MultiCombobox({ values, onChange, ...p }: ComboboxBase & { values: readonly string[]; onChange: (values: string[]) => void }) {
  return <ComboboxImpl {...p} values={values} onValues={onChange} multiple />;
}

function ComboboxImpl({
  label,
  options,
  placeholder,
  error,
  hint,
  required,
  disabled,
  full,
  freeText,
  values,
  onValues,
  multiple,
}: ComboboxBase & { values: readonly string[]; onValues: (v: string[]) => void; multiple: boolean }) {
  const id = useId();
  const listId = `${id}-list`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  useDismiss(open, wrapRef, close);

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => !o.disabled && (!q || o.label.toLowerCase().includes(q)));
  }, [options, query]);

  const choose = (v: string) => {
    if (multiple) onValues(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
    else {
      onValues([v]);
      close();
    }
    setQuery("");
  };

  const inputValue = open || multiple ? query : values[0] ? labelOf(values[0]) : "";

  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint} full={full}>
      <div className="tv-combobox" ref={wrapRef}>
        {multiple && values.length ? (
          <div className="tv-chips" style={{ marginBottom: 6 }}>
            {values.map((v) => (
              <span key={v} className="tv-chip">
                {labelOf(v)}
                <button type="button" aria-label={`Remove ${labelOf(v)}`} onClick={() => onValues(values.filter((x) => x !== v))} disabled={disabled}>
                  <Icon name="x" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder ?? (multiple ? "Type to search…" : "Choose…")}
          value={inputValue}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(filtered.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const opt = filtered[active];
              if (opt) choose(opt.value);
              else if (freeText && query.trim()) choose(query.trim());
            } else if (e.key === "Escape") {
              close();
            } else if (e.key === "Backspace" && multiple && !query && values.length) {
              onValues(values.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (!multiple && freeText && query.trim()) onValues([query.trim()]);
          }}
        />
        {open ? (
          <div className="tv-combobox-list" role="listbox" id={listId} aria-multiselectable={multiple}>
            {filtered.length ? (
              filtered.map((o, i) => (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={values.includes(o.value)}
                  className={i === active ? "is-active" : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.value)}
                >
                  {o.label}
                </div>
              ))
            ) : (
              <div className="tv-combobox-empty">{freeText && query.trim() ? `Press Enter to use "${query.trim()}"` : "No options"}</div>
            )}
          </div>
        ) : null}
      </div>
    </FieldShell>
  );
}
