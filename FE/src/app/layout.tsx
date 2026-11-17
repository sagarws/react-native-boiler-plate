import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/layout/app-providers";
import "@/styles/index.css";

export const metadata: Metadata = {
  title: { template: "%s | TrackVid", default: "TrackVid" },
  description: "TrackVid: packing and return videos, SPF claims and returns in one workspace.",
  icons: { icon: { url: "/assets/brand/logo.svg", type: "image/svg+xml" } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#eee7da",
};

/** Applies the saved theme before paint so dark mode does not flash (static script, no user data). */
const themeBootstrap = `try{var m=JSON.parse(localStorage.getItem("trackvid-ui:theme")||'"light"');var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
        <div id="app">
          <AppProviders>{children}</AppProviders>
        </div>
        <div id="overlay-root" />
        <div id="toast-region" role="status" aria-live="polite" />
        <noscript>TrackVid requires JavaScript.</noscript>
      </body>
    </html>
  );
}
