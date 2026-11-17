// @ts-nocheck

export function ProductToggle({
  name: e,
  title,
  description,
  checked,
  onChange,
}) {
  return (
    <label className="product-toggle">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        name={e}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
