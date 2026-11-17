// @ts-nocheck

export function SummaryList({ items }) {
  return (
    <div className="c-summary">
      {items.map(([e, t, n]) => (
        <div key={e}>
          <span>{e}</span>
          <strong>{t}</strong>
          <small>{n || ""}</small>
        </div>
      ))}
    </div>
  );
}
