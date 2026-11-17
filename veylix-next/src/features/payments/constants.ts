// @ts-nocheck

export const paymentWorkspaceTabs = [
  ["transactions", "Transactions", "wallet"],
  ["providers", "Providers", "globe"],
  ["settlements", "Settlements", "wallet"],
  ["payment-links", "Payment links", "share"],
];

export const transactionDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export const transactionProviderOptions = [
  "Stripe",
  "PayPal",
  "Adyen",
  "Offline",
];

export const transactionStatusOptions = [
  "Succeeded",
  "Pending",
  "Failed",
  "Requires action",
  "Refunded",
];

export const transactionTypeOptions = [
  "Charge",
  "Authorization",
  "Refund",
  "Adjustment",
];

export const transactionSettlementOptions = [
  "Settled",
  "Pending",
  "In transit",
  "On hold",
  "Not applicable",
];

export const settlementProviderOptions = [
  "Stripe",
  "PayPal",
  "Adyen",
  "Offline",
];

export const settlementStatusOptions = [
  "Pending",
  "In transit",
  "Paid",
  "On hold",
];

export const paymentLinkStatusOptions = [
  "Draft",
  "Active",
  "Paid",
  "Expired",
  "Cancelled",
];
