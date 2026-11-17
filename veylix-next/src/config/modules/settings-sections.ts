// @ts-nocheck
import {
  createField,
  numberField,
  selectField,
  textField,
} from "@/config/modules/fields";

export const settingsSections = {
  seo: {
    title: "Store SEO",
    description: "Search and sharing defaults for your storefront integration.",
    fields: [
      textField("title", "Default page title", {
        required: true,
      }),
      createField("description", "Meta description", "textarea"),
      textField("canonical", "Canonical storefront URL", {
        type: "url",
      }),
      textField("socialImage", "Social image URL", {
        type: "url",
      }),
      selectField("indexing", "Search visibility", [
        "Allow indexing",
        "Request no indexing",
      ]),
      selectField("sitemap", "Sitemap preference", [
        "Include published pages",
        "Disabled",
      ]),
    ],
    defaults: {
      title: "Veylix — Thoughtful everyday essentials",
      description: "Shop considered essentials for your everyday.",
      canonical: "https://example.com",
      socialImage: "",
      indexing: "Allow indexing",
      sitemap: "Include published pages",
    },
  },
  maintenance: {
    title: "Maintenance mode",
    description:
      "Prepare a storefront maintenance plan. Your backend controls the live storefront.",
    fields: [
      selectField("mode", "Storefront availability", [
        "Online",
        "Scheduled maintenance",
        "Maintenance requested",
      ]),
      textField("headline", "Maintenance headline"),
      createField("message", "Customer message", "textarea"),
      createField("startsAt", "Starts at", "datetime-local"),
      createField("endsAt", "Ends at", "datetime-local"),
      textField("support", "Support email", {
        type: "email",
      }),
    ],
    defaults: {
      mode: "Online",
      headline: "A little refresh is on its way",
      message: "We are making a few improvements. Please check back soon.",
      startsAt: "",
      endsAt: "",
      support: "support@example.com",
    },
  },
  marketing: {
    title: "Marketing connections",
    description:
      "Keep measurement identifiers together for your consent-aware storefront integration.",
    fields: [
      textField("analytics", "Google Analytics measurement ID"),
      textField("pixel", "Meta pixel ID"),
      textField("tagManager", "Tag Manager container ID"),
      selectField("consent", "Analytics consent default", [
        "Wait for consent",
        "Disabled",
      ]),
      selectField("status", "Integration status", [
        "Not connected",
        "Configuration drafted",
      ]),
    ],
    defaults: {
      analytics: "",
      pixel: "",
      tagManager: "",
      consent: "Wait for consent",
      status: "Not connected",
    },
  },
  storage: {
    title: "Storage settings",
    description:
      "Choose the storage preferences for your production media adapter.",
    fields: [
      selectField("provider", "Storage provider", [
        "Local browser demo",
        "Amazon S3",
        "Cloudinary",
        "Custom server",
      ]),
      textField("bucket", "Bucket / cloud name"),
      numberField("maxFileSize", "Maximum file size (MB)", {
        min: 1,
        max: 20,
      }),
      textField("secretRef", "Server secret reference"),
    ],
    defaults: {
      provider: "Local browser demo",
      bucket: "",
      maxFileSize: 20,
      secretRef: "MEDIA_STORAGE_SECRET",
    },
  },
  general: {
    title: "General settings",
    description:
      "Your store identity, browser title, logos, contact details and preferences.",
    fields: [
      textField("storeName", "Store name", {
        required: true,
        maxLength: 80,
      }),
      textField("browserTitle", "Browser / tab title", {
        required: true,
        maxLength: 80,
      }),
      textField("email", "Customer support email", {
        type: "email",
        required: true,
      }),
      textField("phone", "Support phone"),
      textField("address", "Business address"),
      textField("tagline", "Tagline"),
    ],
    defaults: {
      storeName: "Veylix",
      browserTitle: "Veylix",
      email: "hello@example.com",
      phone: "+1 202 555 0100",
      address: "Brooklyn, New York",
      tagline: "Commerce, in harmony.",
      favicon: "",
      sidebarLogo: "",
      siteLogo: "",
    },
  },
  localization: {
    title: "Language & currency",
    description: "Choose the defaults your storefront should use.",
    fields: [
      selectField("language", "Language", [
        "English",
        "French",
        "German",
        "Spanish",
      ]),
      selectField("currency", "Currency", [
        "USD",
        "EUR",
        "GBP",
        "CAD",
        "AUD",
        "JPY",
      ]),
      textField("timezone", "Time zone"),
      selectField("units", "Weight unit", ["kg", "lb"]),
      selectField("format", "Date format", [
        "MMM DD, YYYY",
        "DD/MM/YYYY",
        "YYYY-MM-DD",
      ]),
    ],
    defaults: {
      language: "English",
      currency: "USD",
      timezone: "America/New_York",
      units: "kg",
      format: "MMM DD, YYYY",
    },
  },
  branding: {
    title: "Branding",
    description:
      "Storefront presentation settings, ready for your integration.",
    fields: [
      textField("displayName", "Display name"),
      textField("accent", "Accent color", {
        pattern: "#[0-9a-fA-F]{6}",
      }),
      textField("logoText", "Logo text"),
      textField("footer", "Footer text"),
      selectField("density", "Storefront density", ["Comfortable", "Compact"]),
    ],
    defaults: {
      displayName: "Veylix",
      accent: "#f5b921",
      logoText: "Veylix",
      footer: "Thoughtfully made. Happily delivered.",
      density: "Comfortable",
    },
  },
  notifications: {
    title: "Notification preferences",
    description: "Decide which events your team needs to hear about.",
    fields: [
      selectField("orders", "New orders", [
        "Email and in-app",
        "In-app only",
        "Off",
      ]),
      selectField("stock", "Low stock", [
        "Email and in-app",
        "In-app only",
        "Off",
      ]),
      selectField("payments", "Payment issues", [
        "Email and in-app",
        "In-app only",
      ]),
      selectField("digest", "Digest frequency", ["Daily", "Weekly", "Off"]),
    ],
    defaults: {
      orders: "Email and in-app",
      stock: "In-app only",
      payments: "Email and in-app",
      digest: "Daily",
    },
  },
  email: {
    title: "Email delivery",
    description:
      "Configure delivery preferences without putting secrets in the browser.",
    fields: [
      textField("sender", "Sender name"),
      textField("from", "From email", {
        type: "email",
      }),
      textField("replyTo", "Reply-to email", {
        type: "email",
      }),
      selectField("provider", "Provider", [
        "Not configured",
        "SMTP",
        "Resend",
        "SendGrid",
        "Amazon SES",
      ]),
      textField("secretRef", "Server secret reference", {
        placeholder: "SMTP_PASSWORD (environment variable name only)",
      }),
    ],
    defaults: {
      sender: "Veylix",
      from: "hello@example.com",
      replyTo: "support@example.com",
      provider: "Not configured",
      secretRef: "SMTP_PASSWORD",
    },
  },
  security: {
    title: "Security",
    description:
      "Define the access policy your production backend should enforce.",
    fields: [
      selectField("mfa", "Require multi-factor authentication", [
        "Administrators",
        "All staff",
        "Optional",
      ]),
      numberField("timeout", "Session timeout (minutes)", {
        min: 5,
        max: 1440,
      }),
      selectField("password", "Password policy", [
        "12 characters minimum",
        "16 characters minimum",
      ]),
      selectField("audit", "Audit retention", [
        "90 days",
        "180 days",
        "365 days",
      ]),
    ],
    defaults: {
      mfa: "Administrators",
      timeout: 60,
      password: "12 characters minimum",
      audit: "180 days",
    },
  },
  marketplace: {
    title: "Marketplace policy",
    description:
      "Control partner onboarding, catalog governance, settlement risk and ownership rules across your multi-vendor marketplace.",
    fields: [
      numberField("commission", "Default commission (%)", {
        max: 100,
      }),
      selectField("approval", "Product listing approval", [
        "Manual review",
        "Trusted vendors only",
        "Auto-approve verified vendors",
      ]),
      selectField("onboarding", "Vendor onboarding", [
        "Manual approval",
        "Verification required",
        "Invite only",
      ]),
      selectField("payout", "Settlement schedule", [
        "Weekly",
        "Biweekly",
        "Monthly",
        "Manual",
      ]),
      numberField("minimumPayout", "Minimum payout amount", {
        min: 0,
      }),
      numberField("hold", "Settlement hold (days)", {
        integer: true,
        min: 0,
      }),
      numberField("reserve", "Rolling reserve (%)", {
        max: 100,
      }),
      selectField("returns", "Returns handled by", [
        "Store team",
        "Vendor",
        "Shared responsibility",
      ]),
      selectField("refundLiability", "Refund liability", [
        "Vendor by default",
        "Marketplace by default",
        "Case by case",
      ]),
      selectField("shippingOwnership", "Shipping ownership", [
        "Vendor fulfilled",
        "Marketplace fulfilled",
        "Hybrid",
      ]),
      selectField("taxHandling", "Marketplace tax handling", [
        "Marketplace collects",
        "Vendor responsible",
        "Depends on region",
      ]),
      selectField("discountPermission", "Vendor discount permission", [
        "Allowed within guardrails",
        "Approval required",
        "Disabled",
      ]),
      selectField("orderEditing", "Vendor order editing", [
        "Fulfillment fields only",
        "Address changes with approval",
        "No vendor edits",
      ]),
      selectField("customerData", "Customer data access", [
        "Order-only details",
        "Masked contact details",
        "Full order contact details",
      ]),
      numberField("disputeSla", "Dispute response SLA (days)", {
        integer: true,
        min: 1,
        max: 60,
      }),
      selectField("suspension", "Automatic vendor protection", [
        "Hold payouts on high-risk dispute",
        "Suspend selling on repeated issues",
        "Manual actions only",
      ]),
      selectField("branding", "Marketplace branding", [
        "Marketplace + vendor brand",
        "Marketplace brand first",
        "Vendor brand first",
      ]),
    ],
    defaults: {
      commission: 12,
      approval: "Manual review",
      onboarding: "Verification required",
      payout: "Weekly",
      minimumPayout: 50,
      hold: 7,
      reserve: 5,
      returns: "Shared responsibility",
      refundLiability: "Case by case",
      shippingOwnership: "Hybrid",
      taxHandling: "Marketplace collects",
      discountPermission: "Allowed within guardrails",
      orderEditing: "Fulfillment fields only",
      customerData: "Order-only details",
      disputeSla: 7,
      suspension: "Hold payouts on high-risk dispute",
      branding: "Marketplace + vendor brand",
    },
  },
};
