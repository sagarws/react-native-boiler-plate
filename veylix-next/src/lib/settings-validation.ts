// @ts-nocheck

export function validateSettingsSection(e, t) {
  if (e === "general") {
    if (!String(t.storeName || "").trim())
      throw Error("Store name is required.");
    if (!String(t.browserTitle || "").trim())
      throw Error("Browser / tab title is required.");
    if (String(t.storeName).length > 80 || String(t.browserTitle).length > 80)
      throw Error("Keep the store name and browser title under 80 characters.");
  }
  if (e === "maintenance") {
    if (t.mode === "Scheduled maintenance" && (!t.startsAt || !t.endsAt))
      throw Error("Set both the start and end of scheduled maintenance.");
    if (t.startsAt && !Number.isFinite(Date.parse(t.startsAt)))
      throw Error("Enter a valid maintenance start time.");
    if (t.endsAt && !Number.isFinite(Date.parse(t.endsAt)))
      throw Error("Enter a valid maintenance end time.");
    if (
      t.startsAt &&
      t.endsAt &&
      Date.parse(t.endsAt) <= Date.parse(t.startsAt)
    )
      throw Error("Maintenance must end after it starts.");
  }
  if (e === "marketplace") {
    const e = Number(t.commission || 0);
    const n = Number(t.minimumPayout || 0);
    const r = Number(t.hold || 0);
    const i = Number(t.reserve || 0);
    const a = Number(t.disputeSla || 0);
    if (!Number.isFinite(e) || e < 0 || e > 100)
      throw Error(
        "Default marketplace commission must be between 0% and 100%.",
      );
    if (!Number.isFinite(n) || n < 0)
      throw Error("Minimum payout amount cannot be negative.");
    if (!Number.isFinite(r) || r < 0 || r > 180)
      throw Error("Settlement hold must be between 0 and 180 days.");
    if (!Number.isFinite(i) || i < 0 || i > 100)
      throw Error("Rolling reserve must be between 0% and 100%.");
    if (!Number.isFinite(a) || a < 1 || a > 60)
      throw Error("Dispute response SLA must be between 1 and 60 days.");
  }
  return t;
}
