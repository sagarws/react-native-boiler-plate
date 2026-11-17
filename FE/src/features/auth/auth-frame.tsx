import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/icon";

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: "video-camera", label: "Auto-capture parcel & return videos" },
  { icon: "seal-percent", label: "Resolve marketplace claims with proof" },
  { icon: "chart-line-up", label: "Track returns with one-click analytics" },
];

/** TrackVid `Slider` (left panel of the auth layout `Main`), in the template look. Hidden on small screens. */
function AuthHero() {
  return (
    <aside className="tv-auth-hero" aria-label="About TrackVid">
      <div className="tv-auth-hero-logo">
        <img src="/assets/brand/logo_name.svg" alt="TrackVid" />
      </div>
      <div className="tv-auth-hero-copy">
        <h2>Protect every order with verifiable video proof.</h2>
        <p>Capture, track, and resolve marketplace returns in one place — built for online sellers who want to win every claim.</p>
      </div>
      <ul className="tv-auth-hero-features">
        {FEATURES.map((f) => (
          <li key={f.label}>
            <span className="tv-auth-hero-icon">
              <Icon name={f.icon} />
            </span>
            {f.label}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Auth layout (TrackVid `Main`: slider + form). Veylix-style centred glass card next to the hero panel.
 */
export function AuthFrame({
  title,
  subtitle,
  wide,
  heading,
  footer,
  legal,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  wide?: boolean;
  /** Replaces the plain title row (e.g. a back button next to the title). */
  heading?: ReactNode;
  footer?: ReactNode;
  legal?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="tv-auth tv-auth-split">
      <AuthHero />
      <div className="tv-auth-main">
        <section className={`glass-card tv-auth-card${wide ? " is-wide" : ""}`}>
          <div className="tv-auth-brand">
            <img src="/assets/brand/logo_name.svg" alt="TrackVid" />
          </div>
          {heading ?? <h1>{title}</h1>}
          {subtitle ? <p className="tv-auth-sub">{subtitle}</p> : <div className="tv-auth-gap" />}
          {children}
          {footer ? <div className="tv-auth-foot">{footer}</div> : null}
        </section>
        {legal ? <p className="tv-auth-legal">{legal}</p> : null}
      </div>
    </div>
  );
}

/** Small centred card for redirect-only pages (impersonate, OAuth callback, guard redirects). */
export function AuthStatusCard({
  state,
  title,
  message,
  action,
}: {
  state: "loading" | "success" | "error";
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="tv-auth">
      <section className={`glass-card tv-auth-card tv-auth-status is-${state}`} aria-live="polite" role={state === "error" ? "alert" : "status"}>
        <div className="tv-auth-brand">
          <img src="/assets/brand/logo.svg" alt="TrackVid" className="tv-auth-mark" />
        </div>
        <div className="tv-auth-status-icon">
          {state === "loading" ? (
            <span className="tv-spinner large" aria-hidden="true" />
          ) : (
            <Icon name={state === "success" ? "check-circle" : "warning"} />
          )}
        </div>
        <h1>{title}</h1>
        {message ? <p className="tv-auth-sub">{message}</p> : null}
        {action ? <div className="tv-auth-status-action">{action}</div> : null}
      </section>
    </div>
  );
}
