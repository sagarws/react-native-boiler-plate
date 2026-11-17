"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import type { IntegrationStatus } from "@/types/integrations";

const STATUS: Record<IntegrationStatus | "active", { label: string; className: string }> = {
  active: { label: "Active", className: "green" },
  connected: { label: "Connected", className: "green" },
  enabled: { label: "Enabled", className: "blue" },
  available: { label: "Available", className: "tv-int-status-neutral" },
};

/** Logo image with an icon fallback when the file is missing or fails to load. */
function BrandLogo({ src, alt, fallback }: { src?: string; alt: string; fallback: IconName }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <Icon name={fallback} />;
  return <img src={src} alt={alt} onError={() => setFailedSrc(src)} />;
}

/** One integration card (template `c-connection` card; TrackVid `IntegrationCard`). */
export function IntegrationCard({
  icon,
  logoSrc,
  title,
  description,
  buttonText,
  primary,
  onClick,
  status = "available",
  isActive = false,
  whatsapp = false,
}: {
  icon: IconName;
  logoSrc?: string;
  title: string;
  description: string;
  buttonText: string;
  /** Filled button (TrackVid "contained") vs outlined. */
  primary: boolean;
  onClick: () => void;
  status?: IntegrationStatus;
  isActive?: boolean;
  whatsapp?: boolean;
}) {
  const tone = isActive ? STATUS.active : STATUS[status];
  return (
    <article className={`glass-card c-connection tv-int-card ${isActive ? "is-active" : ""}`.trim()}>
      <div className="card-heading">
        <span className={`icon-tile tv-int-logo ${logoSrc ? "has-logo" : ""} ${whatsapp ? "is-whatsapp" : ""}`.replace(/\s+/g, " ").trim()}>
          <BrandLogo src={logoSrc} alt={`${title} logo`} fallback={icon} />
        </span>
        <span className={`c-status ${tone.className}`}>
          {isActive ? <Icon name="check-circle" /> : null}
          {tone.label}
        </span>
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="c-toolbar tv-int-card-actions">
        <button type="button" className={primary ? "primary-button" : "secondary-button"} onClick={onClick}>
          {buttonText}
          <Icon name="arrow-right" />
        </button>
      </div>
    </article>
  );
}
