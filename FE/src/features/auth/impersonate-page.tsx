"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ROUTE_URLS from "@/config/route";
import { AuthStatusCard } from "@/features/auth/auth-frame";
import { errorMessage, toast } from "@/lib/events";
import { AuthService } from "@/services/auth-service";
import { SessionStore } from "@/services/session";
import { useDispatch } from "@/store";
import { setUserProfile } from "@/store/profile-slice";

type Status = { state: "loading" } | { state: "success" } | { state: "error"; message: string };

/**
 * TrackVid `pages/Impersonate.tsx`: a system admin opens `/impersonate/:userId`, the server returns the
 * customer's token + user, the session is replaced and the dashboard opens. Errors stay on this page.
 */
export function ImpersonatePage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const router = useRouter();
  const dispatch = useDispatch();
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    AuthService.impersonate(userId)
      .then((data) => {
        if (cancelled) return;
        // TrackVid `LocalStorageService.loginUser(accessToken, user)`; the impersonator flag drives the
        // "Viewing as" / "Exit impersonation" header in the shell.
        SessionStore.setToken(data.accessToken);
        SessionStore.setImpersonator("System admin");
        dispatch(setUserProfile(data.user));
        setStatus({ state: "success" });
        toast.success(data.message || "Login Successfully");
        router.replace(ROUTE_URLS.DASHBOARD);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus({ state: "error", message: errorMessage(error, "Unable to sign in as this user.") });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, router, dispatch]);

  if (status.state === "error") {
    return (
      <AuthStatusCard
        state="error"
        title={status.message}
        message="Check the user id and try again from System admin."
        action={
          <Link href={ROUTE_URLS.SYSTEM_ADMIN} className="secondary-button">
            Back to System admin
          </Link>
        }
      />
    );
  }
  if (status.state === "success") return <AuthStatusCard state="success" title="Redirecting..." />;
  return <AuthStatusCard state="loading" title="Signing in as this user…" message="Getting a session for this account." />;
}
