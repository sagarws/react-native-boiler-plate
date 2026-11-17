"use client";

import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Banner } from "@/components/ui/banner";
import { TextField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/states";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { EmailAutomationService } from "@/services/email-automation-service";
import type { AwbPreview, ManualFixContext, ManualFixSendResult } from "@/types/emails";
import { isGoogleDriveLink } from "./email-helpers";

/** TrackVid `ManualFixDialogs.tsx`: Add AWB / Add video link for failed AJIO replies. Mount only while open. */

interface DialogProps {
  emailId: string;
  onClose: () => void;
  /** Called after the fix was saved (sent or not) so the list can refresh. */
  onDone: (result: ManualFixSendResult) => void;
}

const notifySendResult = (result: ManualFixSendResult, what: string) => {
  if (result.sent) toast.success("Reply sent to AJIO");
  else toast.error(`${what} saved, but the reply could not be sent: ${result.error?.message ?? "unknown error"}. Use Retry once that is fixed.`);
};

function useManualFixContext(emailId: string): { context: ManualFixContext | null; error: string | null; loading: boolean } {
  const res = useAsync(() => EmailAutomationService.getManualFixContext(emailId), [emailId]);
  const data = res.data;
  return {
    loading: res.loading,
    context: data?.ok ? data.data : null,
    error: res.error ?? (data && !data.ok ? (data.body.displayMessage ?? data.body.error) : null),
  };
}

function OrderNoLine({ value }: { value: string | null }) {
  return (
    <div className="tv-emails-orderno">
      <span>Customer Order No (from AJIO email)</span>
      <strong>{value ?? "Not found in email"}</strong>
    </div>
  );
}

function DialogFooter({ onClose, onSend, canSend, sending }: { onClose: () => void; onSend: () => void; canSend: boolean; sending: boolean }) {
  return (
    <>
      <button type="button" className="secondary-button" onClick={onClose} disabled={sending}>
        Cancel
      </button>
      <button type="button" className="primary-button" onClick={onSend} disabled={!canSend || sending}>
        {sending ? <span className="tv-spinner small" aria-hidden="true" /> : null}
        Save &amp; Send
      </button>
    </>
  );
}

// ─── Add AWB ────────────────────────────────────────────────────────────────

export function AddAwbDialog({ emailId, onClose, onDone }: DialogProps) {
  const { context, error: contextError, loading: contextLoading } = useManualFixContext(emailId);
  const [awb, setAwb] = useState("");
  const [typedOrderNo, setTypedOrderNo] = useState("");
  const [preview, setPreview] = useState<AwbPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  // Sync guard against double submit (Enter + click before state settles).
  const inFlightRef = useRef(false);

  const needsTypedOrderNo = context !== null && !context.customerOrderNoFromEmail;
  const orderNoForRequest = needsTypedOrderNo ? typedOrderNo.trim() : undefined;
  const trimmedAwb = awb.trim();

  /** Any input change drops the old preview; the effect below checks the new value after a pause. */
  const resetPreview = (nextAwb: string) => {
    setPreview(null);
    setPreviewError(null);
    setConfirmed(false);
    setChecking(nextAwb.trim().length >= 3);
  };

  useEffect(() => {
    if (trimmedAwb.length < 3) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      EmailAutomationService.previewAwbLink(emailId, trimmedAwb, orderNoForRequest)
        .then((res) => {
          if (cancelled) return;
          if (res.ok) setPreview(res.data);
          else setPreviewError(res.body.displayMessage ?? res.body.error);
        })
        .catch((err: unknown) => {
          if (!cancelled) setPreviewError(errorMessage(err));
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmedAwb, orderNoForRequest, emailId]);

  const warnings = preview?.evaluation.warnings ?? [];
  const blockers = preview?.evaluation.blockers ?? [];
  const canSend = !!preview && preview.evaluation.canLink && (warnings.length === 0 || confirmed) && !sending && !checking;

  const handleSend = async () => {
    if (!preview || !canSend || inFlightRef.current) return;
    inFlightRef.current = true;
    setSending(true);
    try {
      const res = await EmailAutomationService.linkAwbAndSend(emailId, {
        awb: preview.awb,
        customerOrderNo: orderNoForRequest,
        confirmReplace: warnings.length > 0 && confirmed,
      });
      if (res.ok) {
        notifySendResult(res.data, "AWB link");
        onDone(res.data);
        onClose();
        return;
      }
      // 409/422 carry a fresh preview — data may have changed since the check.
      if (res.body.preview) {
        setPreview(res.body.preview);
        setConfirmed(false);
      }
      toast.error(res.body.displayMessage ?? res.body.error);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      inFlightRef.current = false;
      setSending(false);
    }
  };

  return (
    <AppDialog
      title="Add AWB"
      size="sm"
      onClose={onClose}
      locked={sending}
      footer={<DialogFooter onClose={onClose} onSend={() => void handleSend()} canSend={canSend} sending={sending} />}
    >
      <div className="tv-stack">
        <p className="tv-muted tv-small">
          Enter the AWB this order was packed and recorded with. It will be linked to the customer order no below and the reply sent to AJIO right away.
        </p>
        {contextLoading ? <Spinner label="Loading email" /> : null}
        {contextError ? <Banner tone="error">{contextError}</Banner> : null}
        {context ? <OrderNoLine value={context.customerOrderNo} /> : null}
        {needsTypedOrderNo ? (
          <TextField
            label="Customer Order No"
            placeholder="e.g. FN7283804270"
            value={typedOrderNo}
            onChange={(e) => {
              setTypedOrderNo(e.currentTarget.value);
              resetPreview(awb);
            }}
            hint="Not found in the email — enter it from the AJIO ticket."
          />
        ) : null}
        <div className="tv-emails-adorn-field">
          <TextField
            label="AWB Number"
            placeholder="e.g. FN7123804342"
            value={awb}
            autoFocus
            disabled={!context}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setAwb(next);
              resetPreview(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSend();
              }
            }}
            hint="Try FN7123804342 (video found), 1490325567781 (no video) or XB9928114650 (already linked)."
          />
          {checking ? <Spinner label="Checking AWB" /> : null}
        </div>

        {previewError ? <Banner tone="error">{previewError}</Banner> : null}

        {preview ? (
          <div className="tv-stack tv-emails-preview">
            {preview.order ? (
              <Banner tone="success">
                Order found · AWB {preview.order.trackingId}
                {preview.order.orderNo ? ` · currently linked to ${preview.order.orderNo}` : " · no order no linked yet"}
              </Banner>
            ) : null}
            {preview.order && preview.hasVideo ? (
              <Banner tone="success">
                Video found
                {preview.videoUrl ? (
                  <>
                    {" · "}
                    <a className="tv-link" href={preview.videoUrl} target="_blank" rel="noopener noreferrer">
                      Play video
                    </a>
                  </>
                ) : null}
              </Banner>
            ) : null}
            {blockers.map((b) => (
              <Banner key={b.code} tone="error">
                {b.message}
              </Banner>
            ))}
            {warnings.map((w) => (
              <Banner key={w.code} tone="warning">
                {w.message}
              </Banner>
            ))}
            {warnings.length > 0 && preview.evaluation.canLink ? (
              <label className="tv-check">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.currentTarget.checked)} />
                Yes, link it and replace the existing value
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}

// ─── Add video link ─────────────────────────────────────────────────────────

export function AddVideoLinkDialog({ emailId, onClose, onDone }: DialogProps) {
  const { context, error: contextError, loading: contextLoading } = useManualFixContext(emailId);
  const [link, setLink] = useState("");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlightRef = useRef(false);

  const valid = isGoogleDriveLink(link);
  const showInvalid = touched && link.trim().length > 0 && !valid;
  const canSend = valid && !!context && !sending;

  const handleSend = async () => {
    if (!canSend || inFlightRef.current) return;
    inFlightRef.current = true;
    setSending(true);
    try {
      const res = await EmailAutomationService.addVideoLinkAndSend(emailId, link.trim());
      if (res.ok) {
        notifySendResult(res.data, "Video link");
        onDone(res.data);
        onClose();
        return;
      }
      toast.error(res.body.displayMessage ?? res.body.error);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      inFlightRef.current = false;
      setSending(false);
    }
  };

  return (
    <AppDialog
      title="Add video link"
      size="sm"
      onClose={onClose}
      locked={sending}
      footer={<DialogFooter onClose={onClose} onSend={() => void handleSend()} canSend={canSend} sending={sending} />}
    >
      <div className="tv-stack">
        <p className="tv-muted tv-small">
          For a video recorded outside TrackVid. AJIO only accepts Google Drive links — make sure the file is shared so AJIO can open it.
        </p>
        {contextLoading ? <Spinner label="Loading email" /> : null}
        {contextError ? <Banner tone="error">{contextError}</Banner> : null}
        {context ? <OrderNoLine value={context.customerOrderNo} /> : null}
        <TextField
          label="Google Drive link"
          placeholder="https://drive.google.com/file/d/…"
          value={link}
          autoFocus
          disabled={!context}
          onChange={(e) => setLink(e.currentTarget.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setTouched(true);
              void handleSend();
            }
          }}
          error={showInvalid ? "Enter a Google Drive link (https://drive.google.com/…)" : null}
        />
      </div>
    </AppDialog>
  );
}
