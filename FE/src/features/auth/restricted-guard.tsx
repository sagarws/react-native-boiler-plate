"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { safeRedirect } from "@/features/auth/auth-helpers";
import { SessionStore } from "@/services/session";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
const hasTokenSnapshot = () => Boolean(SessionStore.getToken());
const serverSnapshot = () => false;

/** True when a session token exists. False on the server and during hydration. */
export function useHasToken(): boolean {
  return useSyncExternalStore(subscribe, hasTokenSnapshot, serverSnapshot);
}

/**
 * TrackVid `RouteAuthGuardRestricted`: a signed-in user who opens login / register / forgot / reset is sent
 * to the dashboard (or to `?redirect=` when present, which is where login itself goes).
 * Uses `useSearchParams`, so the page must render it inside `<Suspense>`.
 */
export function RestrictedGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasToken = useHasToken();
  const target = safeRedirect(searchParams.get("redirect"));

  useEffect(() => {
    if (hasToken) router.replace(target);
  }, [hasToken, router, target]);

  if (hasToken) return <AuthStatusCard state="loading" title="Redirecting…" />;
  return <>{children}</>;
}
