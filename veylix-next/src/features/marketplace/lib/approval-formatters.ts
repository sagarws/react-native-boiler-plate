// @ts-nocheck

export const approvalNumberFormat = new Intl.NumberFormat("en-US");

export function formatApprovalDate(e) {
  return e
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(String(e)))
    : "—";
}

export const approvalProductIconAliases = {
  tee: "t-shirt",
  mug: "coffee",
  bottle: "thermometer",
};
