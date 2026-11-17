import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/styles/index.css";

export const metadata: Metadata = {
  title: { template: "%s | Veylix", default: "Overview | Veylix" },
  description:
    "Veylix: a thoughtfully crafted ecommerce operations dashboard. Sales, fulfillment, inventory and AI insights in one workspace.",
  icons: { icon: { url: "/assets/images/favicon.svg", type: "image/svg+xml" } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#eee7da",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Same mount points as the original index.html. */}
        <div id="app">{children}</div>
        <div id="overlay-root" />
        <div id="toast-region" role="status" aria-live="polite" />
        <noscript>Veylix requires JavaScript. Enable it to view this interactive dashboard.</noscript>
      </body>
    </html>
  );
}
