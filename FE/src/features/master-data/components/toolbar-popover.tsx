"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { useDismiss } from "@/components/ui/use-dismiss";

/** Toolbar button + template popover (`tv-popover`), closed on outside click / Escape. */
export function ToolbarPopover({
  label,
  icon,
  badge,
  disabled,
  busy,
  primary = false,
  wide = false,
  children,
}: {
  label: string;
  icon: IconName;
  badge?: number;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  return (
    <div className="tv-popover-wrap" ref={ref}>
      <button
        type="button"
        className={primary ? "primary-button" : "secondary-button"}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name={icon} />}
        {label}
        {badge ? <span className="tv-tab-count">{badge}</span> : null}
        <Icon name="caret-down" />
      </button>
      {open ? <div className={`tv-popover ${wide ? "tv-master-popover-wide" : ""}`.trim()}>{children(close)}</div> : null}
    </div>
  );
}
