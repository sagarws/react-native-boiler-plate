// @ts-nocheck

export const applicationNumberFormat = new Intl.NumberFormat("en-US");

export function formatApplicationDate(e) {
  return e
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(String(e)))
    : "—";
}

export function getApplicantInitials(e) {
  return String(e.name || "V")
    .split(/\s+/)
    .slice(0, 2)
    .map((e) => e[0])
    .join("")
    .toUpperCase();
}
