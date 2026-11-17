// @ts-nocheck

export function CheckoutToggleRow({
  settingKey,
  title,
  description,
  value,
  onChange,
}) {
  return (
    <label className="checkout-toggle-row">
      <span className="checkout-toggle-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="checkout-switch">
        <input type="hidden" name={settingKey} value="Disabled" />
        <input
          type="checkbox"
          name={settingKey}
          value="Enabled"
          checked={value === "Enabled"}
          aria-label={title}
          onChange={(t) =>
            onChange(
              settingKey,
              t.currentTarget.checked ? "Enabled" : "Disabled",
            )
          }
        />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}
