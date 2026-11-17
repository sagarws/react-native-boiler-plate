"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "@/lib/events";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { OAuthService } from "@/services/oauth-service";
import type { ZohoCallbackParams } from "@/types/auth";

const ZOHO_ERROR_TEXT: Record<string, string> = {
  access_denied: "Access was denied in Zoho.",
  authorization_code_missing: "Zoho did not return an authorization code.",
  zoho_oauth_not_configured: "The Zoho connection could not be matched to your account. Start the connection again.",
};

type Phase = { state: "loading" } | { state: "success"; mailbox: string | null } | { state: "error"; reason: string };

/**
 * TrackVid `pages/ZohoOAuthCallback.tsx`. Zoho redirects here with `?code=&state=` (or `?error=`).
 * TrackVid strips the params from the URL bar at once and hands them to the backend, which redirects to
 * the page that started the connection with `connected=1` or `connected=0&error=…`. Here the mock service
 * makes that decision, a toast reports it, and the page redirects the same way.
 */
export function ZohoCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Captured once: the URL is cleared below, and later renders must still use the original values.
  const [params] = useState<ZohoCallbackParams>(() => ({
    code: searchParams.get("code"),
    state: searchParams.get("state"),
    error: searchParams.get("error"),
    location: searchParams.get("location"),
  }));
  const [phase, setPhase] = useState<Phase>({ state: "loading" });

  useEffect(() => {
    // Keep the OAuth code out of the URL bar (third-party scripts read location.href on mount).
    try {
      window.history.replaceState(null, "", "/oauth/zoho/callback");
    } catch {
      // Non-blocking: at worst the params stay visible until the redirect below.
    }

    let cancelled = false;
    let redirectTimer: number | undefined;
    void OAuthService.zohoCallback(params).then((result) => {
      if (cancelled) return;
      if (result.connected) {
        setPhase({ state: "success", mailbox: result.mailbox });
        toast.success("Mailbox connected successfully.");
      } else {
        const reason = ZOHO_ERROR_TEXT[result.error ?? ""] ?? `Zoho connection failed (${result.error ?? "unknown error"}).`;
        setPhase({ state: "error", reason });
        toast.error(reason);
      }
      // Short pause so the result is readable before the page changes.
      redirectTimer = window.setTimeout(() => router.replace(result.redirectTo), 1200);
    });
    return () => {
      cancelled = true;
      if (redirectTimer !== undefined) window.clearTimeout(redirectTimer);
    };
  }, [params, router]);

  if (phase.state === "success") {
    return (
      <AuthStatusCard
        state="success"
        title="Zoho mailbox connected"
        message={phase.mailbox ? `${phase.mailbox} is connected. Taking you back…` : "Taking you back…"}
      />
    );
  }
  if (phase.state === "error") {
    return <AuthStatusCard state="error" title="Could not connect Zoho" message={`${phase.reason} Taking you back…`} />;
  }
  return <AuthStatusCard state="loading" title="Finishing Zoho connection…" />;
}
