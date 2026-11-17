"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { LoadingState } from "@/components/ui/states";
import { copyText } from "@/lib/download";
import { errorMessage, toast } from "@/lib/events";
import { MasterData } from "@/services/masterData-service";

interface ScanReturnParcelDialogProps {
  type: "good" | "bad";
  /** Set when opened from a "Return scan finished" notification: read-only results of that scan session. */
  notificationId: string;
  onClose: () => void;
  /** Notification mode: drop `?id=` from the URL when the dialog closes. */
  onLeaveNotification: () => void;
}

/** TrackVid `ScanReturnParcel`: scan (or type) parcel AWBs one by one and mark them Good / Bad. */
export function ScanReturnParcelDialog({ type, notificationId, onClose, onLeaveNotification }: ScanReturnParcelDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState<{ message: string; status: "success" | "failed" } | null>(null);
  const [failedResponses, setFailedResponses] = useState<string[]>([]);
  const [successResponses, setSuccessResponses] = useState<string[]>([]);
  const [condition, setCondition] = useState<"good" | "bad">(type);
  const [loadingResults, setLoadingResults] = useState(Boolean(notificationId));
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  });

  // Notification mode: load the saved results of that scan session.
  useEffect(() => {
    if (!notificationId) return;
    let active = true;
    MasterData.scanReturnParcelOrders({ notificationId })
      .then((data) => {
        if (!active) return;
        setFailedResponses(data.failedOrders);
        setSuccessResponses(data.successfulOrders);
        setCondition(data.parcelCondition);
      })
      .catch(() => {
        if (!active) return;
        toast.error("Failed to fetch scanned parcel");
        setFailedResponses([]);
        setSuccessResponses([]);
        closeRef.current();
      })
      .finally(() => {
        if (active) setLoadingResults(false);
      });
    return () => {
      active = false;
    };
  }, [notificationId]);

  // Keep the scanner input focused between scans (barcode guns type + Enter).
  useEffect(() => {
    if (!isLoading && !notificationId) inputRef.current?.focus();
  }, [isLoading, notificationId]);

  const handleSubmit = async () => {
    const value = inputValue.trim();
    if (!value) {
      toast.error("Please enter a value");
      return;
    }
    setIsLoading(true);
    try {
      const { isSuccess, message, data } = await MasterData.scanReturnParcel({ awbNumber: value, parcelCondition: type === "good" ? 1 : 2 });
      if (isSuccess) {
        setCurrentResponse({ message: value, status: "success" });
        setSuccessResponses((prev) => [...prev, value]);
        if (data?.staged) toast.success("Scan recorded. It will be applied when the return file is imported.");
      } else {
        setCurrentResponse({ message: value, status: "failed" });
        setFailedResponses((prev) => [...prev, value]);
        if (message) toast.error(message);
      }
    } catch (err) {
      setCurrentResponse({ message: value, status: "failed" });
      setFailedResponses((prev) => [...prev, value]);
      toast.error(errorMessage(err));
    } finally {
      setIsLoading(false);
      setInputValue("");
    }
  };

  const handleCopyAll = async () => {
    if (await copyText(failedResponses.join("\n"))) toast.success("All failed orders copied to clipboard");
    else toast.error("Could not copy to the clipboard");
  };

  const handleCopyIndividual = async (message: string) => {
    if (await copyText(message)) toast.success("Order number copied to clipboard");
    else toast.error("Could not copy to the clipboard");
  };

  // Closing a live scan session saves its summary as a notification (TrackVid `scannedParcel-notification`).
  const handleCloseModal = async () => {
    if (notificationId) {
      onLeaveNotification();
      onClose();
      return;
    }
    if (failedResponses.length === 0 && successResponses.length === 0) {
      onClose();
      return;
    }
    setClosing(true);
    try {
      await MasterData.scanReturnParcelNotification({ failedParcels: failedResponses, successParcels: successResponses, parcelCondition: type });
    } catch (err) {
      // Saving the summary is best effort (TrackVid only logs it); the scans themselves are already applied.
      console.error(err);
    }
    onClose();
  };

  return (
    <AppDialog
      title={`Scan Return Parcel - ${condition === "good" ? "Good" : "Bad"}`}
      onClose={() => void handleCloseModal()}
      size="sm"
      locked={closing}
      className="tv-scan-dialog"
    >
      {loadingResults ? (
        <LoadingState label="Loading scanned parcels…" />
      ) : (
        <div className="tv-stack">
          {!notificationId ? (
            <div className="c-field">
              <label htmlFor={inputId}>Enter Parcel ID</label>
              <input
                id={inputId}
                ref={inputRef}
                value={inputValue}
                autoComplete="off"
                disabled={isLoading}
                placeholder="Scan or type the AWB, then press Enter"
                onChange={(e) => setInputValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
              />
            </div>
          ) : null}

          {!notificationId ? (
            <div className="tv-row tv-small tv-muted">
              <span className={`tv-scan-chip ${type === "good" ? "is-good" : "is-bad"}`}>{type === "good" ? "Good parcel" : "Bad parcel"}</span>
              <span>
                {successResponses.length} scanned · {failedResponses.length} failed
              </span>
              {isLoading ? <span className="tv-spinner small" aria-label="Checking parcel" /> : null}
            </div>
          ) : null}

          {currentResponse ? (
            <div className={`tv-scan-current ${currentResponse.status === "success" ? "is-good" : "is-bad"}`} role="status" aria-live="polite">
              <Icon name={currentResponse.status === "success" ? "check-circle" : "x-circle"} />
              <strong className="tv-mono">{currentResponse.message}</strong>
            </div>
          ) : null}

          {failedResponses.length > 0 ? (
            <section className="tv-scan-section">
              <div className="tv-row">
                <strong>Failed Scans</strong>
                <button type="button" className="secondary-button compact-button" onClick={() => void handleCopyAll()}>
                  <Icon name="copy" /> Copy All
                </button>
              </div>
              <ul className="tv-scan-list">
                {failedResponses.map((r, i) => (
                  <li key={`${r}-${i}`}>
                    <Icon name="x-circle" className="is-bad" />
                    <span className="tv-mono">{r}</span>
                    <button type="button" className="icon-button" title="Copy order number" aria-label={`Copy ${r}`} onClick={() => void handleCopyIndividual(r)}>
                      <Icon name="copy" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {notificationId && successResponses.length > 0 ? (
            <section className="tv-scan-section">
              <strong>Successful Scans ({successResponses.length})</strong>
              <ul className="tv-scan-list">
                {successResponses.map((r, i) => (
                  <li key={`${r}-${i}`}>
                    <Icon name="check-circle" className="is-good" />
                    <span className="tv-mono">{r}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {notificationId && !failedResponses.length && !successResponses.length ? <p className="tv-muted">No parcels were scanned in this session.</p> : null}
        </div>
      )}
    </AppDialog>
  );
}
