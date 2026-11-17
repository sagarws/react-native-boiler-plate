"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { StoreProvider } from "@/store/provider";

const ToastHost = dynamic(() => import("@/components/layout/toast-host").then((m) => m.ToastHost), { ssr: false });

/** One Redux store and one toast host for the whole app, so state and toasts survive auth → dashboard navigation. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      {children}
      <ToastHost />
    </StoreProvider>
  );
}
