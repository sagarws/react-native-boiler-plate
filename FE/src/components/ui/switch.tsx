import type { ReactNode } from "react";

/** Toggle switch styled like the template's checkout toggle rows. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  hideLabel = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  return (
    <label className="tv-switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span className="tv-switch-track" aria-hidden="true" />
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
    </label>
  );
}

/** A settings row: title + description on the left, switch on the right. */
export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tv-toggle-row">
      <div>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} hideLabel disabled={disabled} />
    </div>
  );
}
