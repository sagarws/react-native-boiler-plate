"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Icon } from "@/components/icons/icon";

interface FieldShellProps {
  id: string;
  label: ReactNode;
  required?: boolean;
  error?: string | false | null;
  hint?: ReactNode;
  full?: boolean;
  className?: string;
  children: ReactNode;
}

/** Template `c-field` wrapper: label, control, then error or hint. */
export function FieldShell({ id, label, required, error, hint, full, className = "", children }: FieldShellProps) {
  return (
    <div className={`c-field ${full ? "span-full" : ""} ${error ? "has-error" : ""} ${className}`.replace(/\s+/g, " ").trim()}>
      <label htmlFor={id}>
        {label}
        {required ? (
          <>
            {" "}
            <small>*</small>
          </>
        ) : null}
      </label>
      {children}
      {error ? (
        <span className="tv-field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="tv-field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

type BaseProps = { label: ReactNode; error?: string | false | null; hint?: ReactNode; full?: boolean; fieldClassName?: string };

export function TextField({ label, error, hint, full, fieldClassName, id, required, ...rest }: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell id={fid} label={label} required={required} error={error} hint={hint} full={full} className={fieldClassName}>
      <input id={fid} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? `${fid}-error` : undefined} {...rest} />
    </FieldShell>
  );
}

export function PasswordField({ label, error, hint, full, fieldClassName, id, required, ...rest }: BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const autoId = useId();
  const fid = id ?? autoId;
  const [show, setShow] = useState(false);
  return (
    <FieldShell id={fid} label={label} required={required} error={error} hint={hint} full={full} className={fieldClassName}>
      <div className="tv-input-adorn">
        <input
          id={fid}
          type={show ? "text" : "password"}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${fid}-error` : undefined}
          {...rest}
        />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
          <Icon name={show ? "eye-slash" : "eye"} />
        </button>
      </div>
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  error,
  hint,
  full,
  fieldClassName,
  id,
  required,
  options,
  placeholder,
  ...rest
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement> & { options: readonly SelectOption[]; placeholder?: string }) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell id={fid} label={label} required={required} error={error} hint={hint} full={full} className={fieldClassName}>
      <select id={fid} required={required} aria-invalid={Boolean(error)} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TextareaField({ label, error, hint, full = true, fieldClassName, id, required, rows = 4, ...rest }: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <FieldShell id={fid} label={label} required={required} error={error} hint={hint} full={full} className={fieldClassName}>
      <textarea id={fid} rows={rows} required={required} aria-invalid={Boolean(error)} {...rest} />
    </FieldShell>
  );
}

/** Template search box (`c-search`). */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  label = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="c-search">
      <Icon name="search" />
      <input type="search" placeholder={placeholder} value={value} aria-label={label} onChange={(e) => onChange(e.currentTarget.value)} />
    </label>
  );
}

/** Template status filter select (`c-filter`). */
export function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  allLabel?: string;
  label: string;
}) {
  return (
    <label className="c-filter">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label={label}>
        {allLabel !== undefined ? <option value="">{allLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
