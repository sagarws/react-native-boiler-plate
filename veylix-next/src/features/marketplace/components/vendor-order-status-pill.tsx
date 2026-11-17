// @ts-nocheck

function getVendorOrderStatusTone(e) {
  const t = String(e || "");
  return /accepted|fulfilled|paid|ready/i.test(t)
    ? "green"
    : /pending|scheduled|hold/i.test(t)
      ? "amber"
      : /cancel/i.test(t)
        ? "red"
        : "blue";
}

export function VendorOrderStatusPill({ value }) {
  return (
    <span className={`commission-pill ${getVendorOrderStatusTone(value)}`}>
      <i />
      {String(value || "—")}
    </span>
  );
}
