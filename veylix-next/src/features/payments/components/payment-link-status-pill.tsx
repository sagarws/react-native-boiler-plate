// @ts-nocheck

export function PaymentLinkStatusPill({ value }) {
  return (
    <span
      className={`payment-status ${value === "Succeeded" || value === "Paid" ? "green" : value === "Refunded" ? "blue" : value === "Failed" || value === "Cancelled" || value === "Expired" ? "red" : value === "Requires action" || value === "On hold" ? "amber" : "neutral"}`}
    >
      <i />
      {value}
    </span>
  );
}
