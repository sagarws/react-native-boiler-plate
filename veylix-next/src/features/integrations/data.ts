// @ts-nocheck

export const integrationProviders = [
  {
    id: "openai",
    name: "OpenAI",
    icon: "sparkle",
    category: "AI assistance",
    description:
      "Product writing, support drafts, image understanding and voice transcription.",
    env: "OPENAI_API_KEY",
    guide: "documentation/INTEGRATIONS.md",
    available: true,
  },
  {
    id: "stripe",
    name: "Stripe",
    icon: "wallet",
    category: "Payments",
    description:
      "Card payments, checkout sessions and verified payment events.",
    env: "STRIPE_SECRET_KEY",
    webhookEnv: "STRIPE_WEBHOOK_SECRET",
  },
  {
    id: "paypal",
    name: "PayPal",
    icon: "wallet",
    category: "Payments",
    description: "Wallet checkout, payment captures and settlement events.",
    env: "PAYPAL_CLIENT_SECRET",
    webhookEnv: "PAYPAL_WEBHOOK_SECRET",
  },
  {
    id: "adyen",
    name: "Adyen",
    icon: "wallet",
    category: "Payments",
    description: "Global payment methods and marketplace payment processing.",
    env: "ADYEN_API_KEY",
    webhookEnv: "ADYEN_HMAC_KEY",
  },
  {
    id: "email",
    name: "Email delivery",
    icon: "paper-plane",
    category: "Communication",
    description:
      "Transactional email and approved customer messages through your backend.",
    env: "EMAIL_API_KEY",
  },
  {
    id: "chat",
    name: "Live chat gateway",
    icon: "chats-circle",
    category: "Communication",
    description:
      "Connect a messaging transport to your customer inbox and AI reply rules.",
    env: "CHAT_GATEWAY_TOKEN",
  },
  {
    id: "storage",
    name: "Media storage",
    icon: "notebook",
    category: "Storage",
    description:
      "Secure uploads, signed asset URLs and a persistent media library.",
    env: "MEDIA_STORAGE_SECRET",
  },
];
