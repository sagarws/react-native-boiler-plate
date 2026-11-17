import type { ReactNode } from "react";

/** Template summary tiles (`c-summary`): [label, value, caption]. */
export function SummaryList({ items }: { items: readonly (readonly [string, ReactNode, ReactNode?])[] }) {
  return (
    <div className="c-summary">
      {items.map(([label, value, caption]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{caption ?? ""}</small>
        </div>
      ))}
    </div>
  );
}
