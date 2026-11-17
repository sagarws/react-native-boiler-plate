// @ts-nocheck

export const defaultCheckoutSettings = {
  guest: "Allowed",
  account: "Optional",
  contact: "Email",
  phone: "Optional",
  company: "Optional",
  address2: "Optional",
  note: "Enabled",
  coupon: "Enabled",
  giftCard: "Enabled",
  marketing: "Enabled",
  terms: "Enabled",
  deliveryInstructions: "Enabled",
  express: "Enabled",
  orderReview: "Enabled",
  taxDisplay: "Calculated at checkout",
  recovery: "Enabled",
  recoveryDelay: "1 hour",
  warranty: "Enabled",
  recommendations: "Enabled",
  thankYouUpsell: "Enabled",
  currency: "USD",
  orderValue: 129,
  shippingPreview: 8,
  taxRate: 8.25,
};

export const checkoutSettingFields = [
  {
    key: "guest",
    label: "Guest checkout",
    type: "select",
    options: ["Allowed", "Account required"],
  },
  {
    key: "account",
    label: "Account creation",
    type: "select",
    options: ["Optional", "Required", "Disabled"],
  },
  {
    key: "contact",
    label: "Primary contact",
    type: "select",
    options: ["Email", "Phone or email"],
  },
  {
    key: "phone",
    label: "Phone number",
    type: "select",
    options: ["Optional", "Required"],
  },
  {
    key: "company",
    label: "Company field",
    type: "select",
    options: ["Optional", "Required", "Hidden"],
  },
  {
    key: "address2",
    label: "Address line 2",
    type: "select",
    options: ["Optional", "Hidden"],
  },
  {
    key: "taxDisplay",
    label: "Tax display",
    type: "select",
    options: [
      "Calculated at checkout",
      "Included in prices",
      "Shown after address",
    ],
  },
  {
    key: "recoveryDelay",
    label: "Recovery reminder",
    type: "select",
    options: ["30 minutes", "1 hour", "4 hours", "12 hours", "24 hours"],
  },
];

export const checkoutPreviewFields = [
  {
    key: "currency",
    label: "Preview currency",
    type: "select",
    options: ["USD", "EUR", "GBP", "CAD"],
  },
  {
    key: "orderValue",
    label: "Preview subtotal",
    type: "money",
    min: 0,
  },
  {
    key: "shippingPreview",
    label: "Preview shipping",
    type: "money",
    min: 0,
  },
  {
    key: "taxRate",
    label: "Preview tax rate (%)",
    type: "number",
    min: 0,
    max: 100,
  },
];

export const checkoutExperienceToggles = [
  ["marketing", "Marketing opt-in", "Show an email marketing consent option."],
  [
    "deliveryInstructions",
    "Delivery instructions",
    "Let shoppers leave courier or drop-off notes.",
  ],
  ["note", "Order notes", "Let shoppers add a note to the merchant."],
  [
    "terms",
    "Terms confirmation",
    "Require policy confirmation before the final payment action.",
  ],
  [
    "orderReview",
    "Order review step",
    "Show a final order review before payment.",
  ],
];

export const checkoutPaymentToggles = [
  ["coupon", "Coupon field", "Allow shoppers to apply valid coupon codes."],
  ["giftCard", "Gift card field", "Allow gift card balances to be redeemed."],
  [
    "express",
    "Express checkout",
    "Reserve space for accelerated wallet checkout.",
  ],
  [
    "recovery",
    "Abandoned checkout recovery",
    "Keep incomplete checkout sessions available for recovery.",
  ],
  [
    "warranty",
    "Warranty order bump",
    "Offer an optional protection add-on before payment.",
  ],
  [
    "recommendations",
    "Related-item order bump",
    "Show a compact complementary-product suggestion.",
  ],
  [
    "thankYouUpsell",
    "Thank-you page upsell",
    "Allow one post-purchase recommendation after the order.",
  ],
];

export const checkoutWorkspaceNavItems = [
  ["checkout", "Checkout", "cart"],
  ["methods", "Payment methods", "wallet"],
  ["coupons", "Coupons", "tag"],
  ["discounts", "Automatic discounts", "seal-percent"],
  ["promotions", "Promotions", "megaphone"],
  ["gift-cards", "Gift cards", "gift"],
  ["campaigns", "Campaigns", "paper-plane"],
];
