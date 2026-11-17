"use client";

import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { useDispatch, useSelector } from "@/store";
import { closeScriptProgress, setScriptProgressManuallyClosed, setScriptProgressMinimized } from "@/store/script-progress-slice";

/** TrackVid `CmsScriptProgressModal`: full dialog or a minimized corner widget. Driven by the scriptProgress slice. */
export function CmsScriptProgress() {
  const dispatch = useDispatch();
  const { open, isMinimized, isCompleted, progress } = useSelector((s) => s.scriptProgress);
  if (!open) return null;

  const pct = progress.total ? Math.round(((progress.success + progress.failed) / progress.total) * 100) : 0;
  const queued = progress.status === "QUEUED";
  const close = () => {
    dispatch(setScriptProgressManuallyClosed(true));
    dispatch(closeScriptProgress());
  };

  if (isMinimized) {
    return (
      <div
        className="glass-card"
        role="status"
        style={{ position: "fixed", right: 20, bottom: 20, zIndex: 60, width: 300, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}
      >
        <div className="tv-row-between">
          <strong className="tv-small">
            {queued
              ? `Queued: ${progress.queuePosition ? `${progress.queuePosition}/${progress.totalInQueue}` : "Waiting"}`
              : isCompleted
                ? "Claims processed"
                : `Processing claims ${progress.success + progress.failed}/${progress.total}`}
          </strong>
          <span className="tv-row" style={{ gap: 2 }}>
            <button type="button" className="icon-button" style={{ width: 30, height: 30 }} title="Expand" aria-label="Expand" onClick={() => dispatch(setScriptProgressMinimized(false))}>
              <Icon name="arrows-out" />
            </button>
            <button type="button" className="icon-button" style={{ width: 30, height: 30 }} title="Close" aria-label="Close" onClick={close}>
              <Icon name="x" />
            </button>
          </span>
        </div>
        <div className="tv-progress">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  return (
    <AppDialog title={isCompleted ? "Claims processed" : "Processing Claims"} onClose={close} size="sm">
      <div className="tv-stack">
        {!isCompleted ? (
          <div className="tv-row" style={{ justifyContent: "flex-end", marginTop: -8 }}>
            <button type="button" className="secondary-button compact-button" onClick={() => dispatch(setScriptProgressMinimized(true))}>
              <Icon name="minus" /> Minimize
            </button>
          </div>
        ) : null}
        {queued ? (
          <div className="tv-banner info">
            <Icon name="clock" />
            <div className="tv-banner-body">
              <strong>Your request is in the queue</strong>
              {progress.queuePosition && progress.totalInQueue
                ? `Position in queue: ${progress.queuePosition} of ${progress.totalInQueue}`
                : "Waiting for an available worker…"}
            </div>
          </div>
        ) : null}
        <strong>
          {progress.success + progress.failed} of {progress.total} processed ({pct}%)
        </strong>
        <div className="tv-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="tv-row">
          {progress.queued ? <span className="c-status blue">Queued: {progress.queued}</span> : null}
          <span className="c-status amber">Running: {progress.running}</span>
          <span className="c-status green">Success: {progress.success} ✓</span>
          <span className="c-status red">Failed: {progress.failed} ✗</span>
        </div>
        {progress.errors.length ? (
          <div className="tv-stack" style={{ gap: 6 }}>
            <strong className="tv-small">Errors</strong>
            <ul className="tv-stack" style={{ gap: 4, maxHeight: 180, overflowY: "auto" }}>
              {progress.errors.map((e) => (
                <li key={e.awbNumber} className="tv-small">
                  <span className="tv-mono">{e.awbNumber}</span>: {e.error}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {progress.skippedAwbNumbers.length ? (
          <p className="tv-small tv-muted">Skipped: {progress.skippedAwbNumbers.join(", ")}</p>
        ) : null}
        {isCompleted ? (
          <div className="tv-dialog-footer" style={{ marginTop: 6 }}>
            <button type="button" className="primary-button" onClick={close}>
              Done
            </button>
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
