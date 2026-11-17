import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/icon";

export type BannerTone = "info" | "warning" | "error" | "success";

const toneIcon: Record<BannerTone, IconName> = { info: "info", warning: "warning", error: "x-circle", success: "check-circle" };

export function Banner({
  tone = "info",
  title,
  children,
  actions,
  onDismiss,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`tv-banner ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={toneIcon[tone]} />
      <div className="tv-banner-body">
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
      {actions || onDismiss ? (
        <div className="tv-banner-actions">
          {actions}
          {onDismiss ? (
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={onDismiss}>
              <Icon name="x" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
