import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/icon";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="tv-state" role="status" aria-live="polite">
      <span className="tv-spinner large" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({
  title = "Nothing here yet",
  message,
  icon = "basket",
  action,
}: {
  title?: string;
  message?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="tv-state">
      <Icon name={icon} />
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry, title = "Could not load this" }: { message?: string | null; onRetry?: () => void; title?: string }) {
  return (
    <div className="tv-state is-error" role="alert">
      <Icon name="warning" />
      <h3>{title}</h3>
      <p>{message || "Something went wrong. Try again."}</p>
      {onRetry ? (
        <button type="button" className="secondary-button" onClick={onRetry}>
          <Icon name="refresh" /> Try again
        </button>
      ) : null}
    </div>
  );
}

export function Spinner({ size = "small", label }: { size?: "small" | "medium" | "large"; label?: string }) {
  return (
    <span role={label ? "status" : undefined} aria-label={label} style={{ display: "inline-flex" }}>
      <span className={`tv-spinner ${size === "medium" ? "" : size}`} aria-hidden="true" />
    </span>
  );
}
