"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import ROUTE_URLS from "@/config/route";
import { AuthFrame } from "@/features/auth/auth-frame";
import { errorMessage, toast } from "@/lib/events";
import { AuthService } from "@/services/auth-service";

type Outcome = { tone: "pending" | "success" | "error"; text: string };

/**
 * TrackVid `pages/Invitation.tsx`: verifies `?token=&email=` one second after opening, then
 * admin → login, sub-user → `/auth/subuser-register?email=&token=`. "Token expired" shows Resend Email;
 * "User already verified" goes to login after one second; any other failure shows the message.
 */
export function InvitationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const invitedEmail = searchParams.get("email");

  const [outcome, setOutcome] = useState<Outcome>({ tone: "pending", text: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isTokenExpired, setIsTokenExpired] = useState(false);
  const [isEmailSending, setIsEmailSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let redirectTimer: number | undefined;

    const handleJoin = async () => {
      setIsLoading(true);
      setOutcome({ tone: "pending", text: "Verifying" });
      try {
        const data = await AuthService.verifyUser({ token, email: invitedEmail });
        if (cancelled) return;
        setIsLoading(false);
        toast.success(data.message);
        setOutcome({ tone: "success", text: data.message });
        setIsTokenExpired(false);
        if (data.isAdmin) {
          router.push(ROUTE_URLS.LOGIN);
        } else {
          const query = new URLSearchParams({ email: invitedEmail ?? "", token: token ?? "" });
          router.push(`${ROUTE_URLS.SUBUSERREGISTER}?${query.toString()}`);
        }
      } catch (error) {
        if (cancelled) return;
        const message = errorMessage(error);
        setIsLoading(false);
        setOutcome({ tone: "error", text: message });
        if (message === "Token expired") {
          setIsTokenExpired(true);
          return;
        }
        if (message === "User already verified") {
          redirectTimer = window.setTimeout(() => router.push(ROUTE_URLS.LOGIN), 1000);
          return;
        }
        toast.error(message);
      }
    };

    const startTimer = window.setTimeout(() => void handleJoin(), 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (redirectTimer !== undefined) window.clearTimeout(redirectTimer);
    };
  }, [token, invitedEmail, router]);

  const handleResendEmail = async () => {
    setIsEmailSending(true);
    try {
      const response = await AuthService.reSendInvitation({ email: invitedEmail });
      toast.success(response.message);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsEmailSending(false);
    }
  };

  return (
    <AuthFrame title={token ? "Invitation Confirmation" : "Confirmation"}>
      <div className="tv-auth-invite">
        <p className="tv-auth-invite-text">
          You have been invited to join the company. Please fill in the details below to join, and use this{" "}
          <strong>{invitedEmail}</strong> email to join the company.
        </p>
        {outcome.text ? (
          <div className={`tv-auth-invite-status is-${outcome.tone}`} role={outcome.tone === "error" ? "alert" : "status"}>
            {outcome.tone === "pending" ? (
              <span className="tv-spinner small" aria-hidden="true" />
            ) : (
              <Icon name={outcome.tone === "success" ? "check-circle" : "warning"} />
            )}
            <span>{outcome.text}</span>
          </div>
        ) : (
          <div className="tv-auth-invite-status is-pending" role="status">
            <span className="tv-spinner small" aria-hidden="true" />
            <span>Preparing your invitation…</span>
          </div>
        )}
        {isTokenExpired ? (
          <button
            type="button"
            className="primary-button tv-auth-wide-button"
            onClick={() => void handleResendEmail()}
            disabled={isLoading || isEmailSending}
          >
            {isEmailSending ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="paper-plane" />}
            {isEmailSending ? "Resending Email..." : "Resend Email"}
          </button>
        ) : null}
      </div>
    </AuthFrame>
  );
}
