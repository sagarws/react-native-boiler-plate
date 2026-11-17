import type { NextConfig } from "next";

/**
 * Short URLs the original app accepted, mapped to their module pages.
 * Keep in sync with `legacyPathAliases` in src/config/navigation.ts.
 */
const legacyPathAliases: Record<string, string> = {
  "/products": "products",
  "/orders": "orders",
  "/inventory": "stock",
  "/shipping": "fulfillment",
  "/fulfillment": "fulfillment",
  "/customers": "customers",
  "/store-channels": "store",
  "/marketplace": "marketplace",
  "/pricing": "checkout",
  "/promotions": "promotions",
  "/analytics": "report-sales",
  "/marketing": "campaigns",
  "/ai-assistant": "ai-studio",
  "/finances": "transactions",
};

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/", destination: "/overview", permanent: false },
      ...Object.entries(legacyPathAliases).map(([source, moduleId]) => ({
        source,
        destination: `/commerce/${moduleId}`,
        permanent: false,
      })),
    ];
  },
};

export default nextConfig;
