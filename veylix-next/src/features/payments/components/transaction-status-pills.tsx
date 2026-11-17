// @ts-nocheck
import { Icon } from "@/components/icons/icon";

export function TransactionStatusPill({ value }) {
  return (
    <span
      className={`payment-status ${value === "Succeeded" || value === "Paid" ? "green" : value === "Refunded" ? "blue" : value === "Failed" || value === "Cancelled" || value === "Expired" ? "red" : value === "Requires action" || value === "On hold" ? "amber" : "neutral"}`}
    >
      <i />
      {value}
    </span>
  );
}

export function TransactionSettlementPill({ value }) {
  return (
    <span
      className={`payment-settlement ${value === "Settled" || value === "Paid" ? "green" : value === "In transit" ? "blue" : value === "On hold" ? "amber" : "neutral"}`}
    >
      {value}
    </span>
  );
}

export function TransactionRiskPill({ value }) {
  return (
    <span
      className={`payment-risk ${value === "High" ? "red" : value === "Review" ? "amber" : "green"}`}
    >
      <Icon name={value === "Normal" ? "check-circle" : "info"} />
      {value}
    </span>
  );
}
