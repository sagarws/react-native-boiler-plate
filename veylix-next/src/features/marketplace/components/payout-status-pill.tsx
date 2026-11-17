// @ts-nocheck

function getPayoutStatusTone(e) {
  const t = String(e || "");
  return /paid|ready|processing/i.test(t)
    ? "green"
    : /draft|hold/i.test(t)
      ? "amber"
      : /failed|cancel/i.test(t)
        ? "red"
        : "blue";
}

export function PayoutStatusPill({ value }) {
  return (
    <span className={`commission-pill ${getPayoutStatusTone(value)}`}>
      <i />
      {String(value || "—")}
    </span>
  );
}
