"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { TextField } from "@/components/ui/form-field";
import { toast } from "@/lib/events";
import { delay } from "@/mocks/delay";
import { useDispatch, useSelector } from "@/store";
import { promoteNextOtpRequest, setOtpSubmitting } from "@/store/otp-prompt-slice";

// Mirrors the Snapdeal script's poll budget (15 s × 4 = 60 s).
const OTP_POLL_WINDOW_SECONDS = 60;

/** TrackVid `OtpPromptModal`: cannot be dismissed; submit sends the OTP (mocked). */
export function OtpPromptModal() {
  const dispatch = useDispatch();
  const { current, submitting } = useSelector((s) => s.otpPrompt);
  const [otp, setOtp] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const jobId = current?.jobId;

  // Reset the input whenever a new request becomes current.
  const [seenJob, setSeenJob] = useState(jobId);
  if (seenJob !== jobId) {
    setSeenJob(jobId);
    setOtp("");
  }

  useEffect(() => {
    if (!jobId) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [jobId]);

  const requestedMs = current?.requestedAt ? new Date(current.requestedAt).getTime() : Number.NaN;
  const secondsRemaining = Number.isNaN(requestedMs) ? null : Math.max(0, OTP_POLL_WINDOW_SECONDS - Math.floor((now - requestedMs) / 1000));

  if (!current) return null;

  const submit = async () => {
    if (!otp.trim()) {
      toast.error("Please enter the OTP before submitting");
      return;
    }
    dispatch(setOtpSubmitting(true));
    await delay(500);
    toast.success("OTP submitted");
    dispatch(promoteNextOtpRequest());
  };

  return (
    <AppDialog
      title={
        <span className="tv-row">
          <Icon name="lock" /> Snapdeal OTP required
        </span>
      }
      onClose={() => undefined}
      size="sm"
      locked
      footer={
        <button type="button" className="primary-button" disabled={submitting} onClick={() => void submit()}>
          {submitting ? <span className="tv-spinner small" aria-hidden="true" /> : null}
          Submit OTP
        </button>
      }
    >
      <form
        className="tv-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!submitting) void submit();
        }}
      >
        <p className="tv-muted">
          Snapdeal is asking for an OTP to complete login for account <strong>{current.username}</strong>. Enter the OTP your team received on the
          registered phone / email so the script can continue.
        </p>
        <TextField label="Enter OTP" value={otp} onChange={(e) => setOtp(e.currentTarget.value)} disabled={submitting} inputMode="numeric" autoFocus maxLength={8} />
        {secondsRemaining !== null ? (
          <span className={`tv-small ${secondsRemaining > 0 ? "tv-muted" : ""}`} style={secondsRemaining > 0 ? undefined : { color: "var(--tv-red)" }}>
            {secondsRemaining > 0
              ? `Time remaining: ${String(Math.floor(secondsRemaining / 60)).padStart(2, "0")}:${String(secondsRemaining % 60).padStart(2, "0")}`
              : "Time expired — the script may have already given up."}
          </span>
        ) : null}
      </form>
    </AppDialog>
  );
}
