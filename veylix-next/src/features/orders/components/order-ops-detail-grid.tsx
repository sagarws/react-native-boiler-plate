// @ts-nocheck

export function OrderOpsDetailGrid({ items }) {
  return (
    <dl className="ops-detail-grid">
      {items.map(([e, t]) => (
        <div key={e}>
          <dt>{e}</dt>
          <dd>{t}</dd>
        </div>
      ))}
    </dl>
  );
}
