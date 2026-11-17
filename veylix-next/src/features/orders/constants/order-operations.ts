// @ts-nocheck

export const orderOpsNumberFormatter = new Intl.NumberFormat("en-US");

export const orderOpsDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export const orderOperationStatusOptions = {
  refunds: [
    "Requested",
    "Under review",
    "Approved for processing",
    "Processing",
    "Completed",
    "Rejected",
  ],
  cancellations: ["Requested", "Under review", "Approved", "Rejected"],
  abandoned: ["Open", "In recovery", "Recovered", "Expired"],
};
