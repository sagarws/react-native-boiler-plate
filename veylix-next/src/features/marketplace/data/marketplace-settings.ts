// @ts-nocheck
import { settingsSections } from "@/config/modules/settings-sections";

export const marketplaceSettingsConfig = settingsSections.marketplace;

export const marketplaceSettingsSections = [
  [
    "COMMERCIAL FRAMEWORK",
    "Commercial & onboarding",
    "Define the default marketplace economics and how new vendors and products earn access.",
    ["commission", "approval", "onboarding", "branding"],
  ],
  [
    "SETTLEMENT & RISK",
    "Payout protection",
    "Set cadence, minimum balance, reserve and the controls that protect settlements when risk changes.",
    ["payout", "minimumPayout", "hold", "reserve", "suspension"],
  ],
  [
    "ORDER OWNERSHIP",
    "Returns, shipping & tax",
    "Make responsibility explicit so vendors know who owns fulfillment, refunds and tax handling.",
    ["returns", "refundLiability", "shippingOwnership", "taxHandling"],
  ],
  [
    "VENDOR PERMISSIONS",
    "Data & operating guardrails",
    "Control what partners can change, what customer data they can see and how fast disputes must be answered.",
    ["discountPermission", "orderEditing", "customerData", "disputeSla"],
  ],
];
