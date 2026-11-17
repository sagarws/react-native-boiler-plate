// @ts-nocheck

function getCommissionTone(e) {
  const t = String(e || "");
  return /active|default|specific|historical/i.test(t)
    ? "green"
    : /category|tier|paused/i.test(t)
      ? "amber"
      : /cancel|error/i.test(t)
        ? "red"
        : "blue";
}

export function CommissionStatusPill({ value }) {
  return (
    <span className={`commission-pill ${getCommissionTone(value)}`}>
      <i />
      {String(value || "—")}
    </span>
  );
}
