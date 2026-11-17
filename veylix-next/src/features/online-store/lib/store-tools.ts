// @ts-nocheck
import { listRecords } from "@/lib/store/core";
import { readPreference } from "@/lib/store/preferences";

function readMaintenanceSettings() {
  return readPreference("settings-maintenance", {
    mode: "Online",
    headline: "A little refresh is on its way",
    message: "We are making a few improvements. Please check back soon.",
    startsAt: "",
    endsAt: "",
    support: "support@example.com",
  });
}

export function getStoreToolSummary(e) {
  if (e.id === "store-settings")
    return String(
      readPreference("settings-general", e.defaults || {}).storeName ||
        "Veylix",
    );
  if (e.id === "homepage-builder") {
    const t = readPreference(e.preference || e.id, e.defaults || {});
    return `${Object.values(t).filter((e) => e === "Visible").length} of ${(e.fields || []).length} sections visible`;
  }
  if (e.id === "theme-customizer")
    return String(
      readPreference(e.preference || e.id, e.defaults || {}).layout || "Wide",
    );
  if (e.id === "navigation-menu") return "Header, footer & mega menus";
  if (e.id === "announcement-bar" || e.id === "hero-sliders")
    return String(
      readPreference(e.preference || e.id, e.defaults || {}).status || "Paused",
    );
  if (e.id === "landing-pages")
    return `${listRecords("pages").length} store pages`;
  if (e.id === "seo-settings")
    return String(
      readPreference("settings-seo", e.defaults || {}).indexing ||
        "Search settings",
    );
  if (e.id === "domain-settings")
    return String(
      readPreference(e.preference || e.id, e.defaults || {}).domain ||
        "Domain not connected",
    );
  if (e.id === "store-languages")
    return String(
      readPreference(e.preference || e.id, e.defaults || {}).enabled ||
        "1 language",
    );
  if (e.id === "currencies")
    return `${String(readPreference(e.preference || e.id, e.defaults || {}).default || "USD")} default`;
  if (e.id === "tax-settings")
    return `${listRecords("taxes").filter((e) => e.status === "Active").length} active tax rule`;
  if (e.id === "shipping-zones")
    return `${listRecords("shipping-rules").filter((e) => e.status === "Active").length} active zones`;
  if (e.id === "payment-methods")
    return `${listRecords("methods").filter((e) => e.status === "Enabled").length} active methods`;
  if (e.id === "checkout-customization") {
    const e = readPreference("checkout", {
      guest: "Allowed",
      phone: "Optional",
    });
    return `Guest ${String(e.guest || "Allowed").toLowerCase()}`;
  }
  return e.id === "email-templates"
    ? `${listRecords("email-templates").length} templates`
    : e.id === "notification-settings"
      ? String(
          readPreference("settings-notifications", e.defaults || {}).digest ||
            "Digest configured",
        )
      : e.id === "media-library"
        ? "Images, video & documents"
        : e.id === "maintenance-mode"
          ? String(
              readPreference("settings-maintenance", e.defaults || {}).mode ||
                "Online",
            )
          : "Ready to configure";
}

export function getStorefrontSnapshot() {
  return {
    general: readPreference("settings-general", {
      storeName: "Veylix",
      email: "hello@example.com",
    }),
    domain: readPreference("storefront-domain-settings", {
      domain: "store.veylix.com",
      ssl: "Secured",
      status: "Connected",
    }),
    maintenance: readMaintenanceSettings(),
    activeProducts: listRecords("products").filter((e) => e.status === "Active")
      .length,
    pendingOrders: listRecords("orders").filter(
      (e) => !["Delivered", "Cancelled"].includes(String(e.status || "")),
    ).length,
    publishedContent:
      listRecords("pages").filter((e) => e.status === "Published").length +
      listRecords("blog").filter((e) => e.status === "Published").length,
  };
}

export function normalizeStoreToolValues(e, t) {
  const n = {};
  for (const r of e) {
    const e = t[r.key] ?? "";
    if (r.type === "money" || r.type === "number") {
      n[r.key] = e === "" ? "" : Number(e);
    } else {
      n[r.key] = typeof e == "string" ? e.trim() : e;
    }
  }
  return n;
}

export function readStoreToolValues(e) {
  if (!e.preference)
    return {
      ...(e.defaults || {}),
    };
  const t = readPreference(e.preference, e.defaults || {});
  return {
    ...(e.defaults || {}),
    ...(t && typeof t == "object" ? t : {}),
  };
}
